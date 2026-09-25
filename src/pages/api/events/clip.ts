// Termin-Clipper v5 (2026-09-26): ADMIN-ONLY. The bookmarklet ships the
// event page's visible TEXT (never a URL — the server fetches nothing, no
// SSRF surface); OpenAI answers a strict JSON schema; nothing is stored.
// Fail-safe: any OpenAI problem answers 200 { ok:false } and captures ONE
// static Sentry message with the reason in extra (createFailSafeResult
// pattern, src/lib/moderation.ts) — the clip page then falls back to the
// markup hints and finally to an honest "date not recognised".
import type { APIRoute } from 'astro';
import { z } from 'zod';
import * as Sentry from '@sentry/astro';
import { requireAdminSession } from '../../../lib/auth';
import {
  buildClipMessages, parseClipJson, normalizeClipResult, mergeHint, berlinTodayISO, CLIP_JSON_SCHEMA,
  type ClipInput,
} from '../../../lib/clipper/extract';

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const BodySchema = z.object({
  title: z.string().max(300).default(''),
  url: z.string().max(2000).refine((u) => /^https?:\/\//i.test(u), 'http(s) url'),
  text: z.string().min(1).max(12_000),
  selection: z.string().max(3000).optional(),
  hint: z.object({
    from: z.string().regex(YMD).optional(),
    to: z.string().regex(YMD).optional(),
    startTime: z.string().regex(HHMM).optional(),
    endTime: z.string().regex(HHMM).optional(),
    allDay: z.boolean().optional(),
    location: z.string().max(200).optional(),
  }).partial().optional(),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function failSafe(reason: string, extra?: Record<string, unknown>) {
  console.error(`[Clipper] FAIL-SAFE: ${reason}`);
  Sentry.captureMessage('clipper: extraction failed', { level: 'warning', extra: { reason, ...extra } });
  await Sentry.flush(2000);
  return json({ ok: false, reason });
}

export const POST: APIRoute = async ({ request }) => {
  const guard = await requireAdminSession(request);
  if (!guard.ok) return guard.response;

  let input: ClipInput;
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: 'invalid_input' }, 400);
    input = parsed.data;
  } catch {
    return json({ error: 'invalid_input' }, 400);
  }

  const apiKey = import.meta.env.OPENAI_API_KEY;
  if (!apiKey) return failSafe('not_configured');

  const todayISO = berlinTodayISO();
  let content: string;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 500,
        response_format: { type: 'json_schema', json_schema: CLIP_JSON_SCHEMA },
        messages: buildClipMessages(input, todayISO),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return failSafe('llm_unavailable', { status: res.status });
    const data = await res.json();
    content = String(data?.choices?.[0]?.message?.content ?? '');
  } catch (e) {
    return failSafe('llm_unavailable', { error: e instanceof Error ? e.name : String(e) });
  }

  const raw = parseClipJson(content);
  if (raw === null) return failSafe('bad_json');

  const result = mergeHint(normalizeClipResult(raw, todayISO), input.hint);
  return json({ ok: true, result });
};
