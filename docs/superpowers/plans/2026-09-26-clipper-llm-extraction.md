# Termin-Clipper v5: LLM date/time extraction (admin-only) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Termin-Clipper bookmarklet stops depending on machine-readable markup: it sends the event page's visible text to an admin-only endpoint that asks OpenAI for title, date, times, location and a summary, and the composer opens prefilled — or says plainly that no date was recognised.

**Architecture:** Three pieces. (1) The bookmarklet (now a readable source file, injected into `/event-clipper` at build time via a Vite `?raw` import) collects title, URL, selection, visible text and the old markup hints, and opens `/events/clip#<url-encoded JSON>` — the fragment never reaches a server, has no practical length limit, and needs no cross-origin fetch or postMessage (the admin's session cookie rides the same-origin request the clip page makes). (2) `/events/clip` (gated page, admin check in frontmatter) reads the fragment, strips it from history, POSTs it to `POST /api/events/clip`, and redirects to the existing `/events/create?…` prefill with the answer, adding `clipMiss=1` when no date came back. (3) The endpoint (`requireAdminSession`, raw fetch to OpenAI like `moderation.ts`, `gpt-4o-mini`, strict JSON schema output, 20 s timeout, never-throw fail-safe with a static Sentry message) is thin; the prompt, schema, normalisation and compose-param mapping live in a pure, tested module `src/lib/clipper/extract.ts`.

**Tech Stack:** Astro 5 SSR pages + API route, TypeScript, Zod (request body), OpenAI chat completions via `fetch` with `response_format: { type: 'json_schema' }`, `node:test` for the pure module, Playwright (`scratchpad/*.cjs`, `NODE_PATH` to the CLI's bundled playwright) for the bookmarklet and the end-to-end probe on the dev server `:4655`.

**Spec:** No separate spec file. The design was agreed in chat on 2026-09-25/26 (user: „why don't we add here an agent? e.g. from openai", „this event adder is just for me", „go now — subagent-driven, admin-only"). This plan is the spec; the "Design decisions" section below records the user's words where they bind.

## Design decisions (binding)

- **Admin-only.** The endpoint uses `requireAdminSession`; the clip page 302s non-admins to `/calendar`. No rate limit (user: „just for me"). Never expose the endpoint or page to members.
- **Text, not URL.** The server never fetches the event page. The bookmarklet ships the page's visible text (capped). No SSRF surface; works on pages behind a login the admin has.
- **Model:** `gpt-4o-mini`, `temperature: 0`, `max_tokens: 500`, `response_format` = strict JSON schema (below), `AbortSignal.timeout(20000)`. Same raw-`fetch` shape as `checkSpamWithGPT()` in `src/lib/moderation.ts:782-815`.
- **Fail-safe, never throw.** OpenAI error/timeout/garbage ⇒ the endpoint answers `200 { ok: false, reason }` and captures ONE static Sentry message (`clipper: extraction failed`) with the reason in `extra` + `await Sentry.flush(2000)` — copy of `createFailSafeResult` (`src/lib/moderation.ts:602-629`). The clip page then falls back to the bookmarklet's markup hints and, if those are empty too, opens the composer with `clipMiss=1`.
- **Nothing stored.** No collection, no log of page text. Sentry `extra` carries the reason only, never the text.
- **Honest miss.** The composer shows a one-line notice when `?clipMiss=1` is present. Copy is a DRAFT — the user words UI copy himself; ship the draft and flag it in the final report.
- **Bookmarklets freeze at drag time.** The user must re-drag from `/event-clipper` after this ships. Say so in the final report.
- **Compose contract stays.** `/events/create` keeps reading `title, body, location, from, to, startTime, endTime, allDay` exactly as today (`EventComposePageInner.svelte:80-140`); this plan only ADDS `clipMiss`.

## Global Constraints

- CI ratchet budgets: `pnpm type-check` errors ≤ 23, `npx -y svelte-check@4` errors ≤ 89 — both are EXACTLY at budget today. Every task re-counts from raw output (`grep -c "error TS"` on tsc; the `COMPLETED … N ERRORS` line of svelte-check). Zero new errors allowed. tsc never checks `.astro`/`.svelte`; `allowJs: true` is on, so the `.js` bookmarklet IS type-checked — keep it ES5-plain and error-free (add `// @ts-nocheck` on line 1).
- Secrets: read `OPENAI_API_KEY` via `import.meta.env` inside the route only. Never print any `.env` value. Never commit `scratchpad/` (gitignored; probes stay local). Only `git add` named files. The gitleaks pre-commit hook runs.
- Commits: one line, no attribution footer, no emoji signature. Push/merge only on the user's word — the orchestrator pushes, implementers never do.
- Tests: `node:test` + `node:assert/strict`, run with `npx tsx --test <file>` (no test script in package.json). Existing style: `src/lib/shortTextVerdict.test.ts`.
- Svelte 5 runes; no new Svelte component is planned. If one becomes necessary, use the annotated `$props()` form.
- i18n: keys live in `src/lib/kiosk-i18n.ts` in BOTH dictionaries (DE + EN). Compose keys are `cal.compose.*`.
- Middleware: `/events` (pages) and `/api/events` (APIs) are already gated (`src/middleware.ts:63-67`, GATED_APIS) — a logged-out call gets a 302/401 before the route runs. Do not touch the middleware.
- No new dependencies. The `openai` npm package is NOT installed and must not be added.
- Dev server for probes: the orchestrator's `:4655` (never the user's `:3000`). Dev admin account: `admin@mahalle-dev.test`, password read from `scratchpad/devpw.txt` straight into `page.fill` / the login fetch body — never echoed, never opened with Read, never screenshot while a password field is filled.

## Review Focus

Inputs the design implies but no task otherwise exercises; each gets a pinned test in the owning task:

1. **Relative dates** („Samstag", „morgen", „nächsten Freitag") — the model must resolve them against Berlin's today, which the prompt states; a wrong year is the classic failure. → Task 1: `buildClipMessages` embeds `todayISO` and the weekday; normaliser rejects a `startDate` more than 400 days from today (in either direction) as a hallucination → `startDate: null`.
2. **Times without dates** („19 Uhr" but the date only in an image) — must not fabricate a date. → Task 1: normaliser drops `startTime` when `startDate` is null; result reports `dateFound: false`.
3. **Ranges spanning midnight or several days** („Fr 20:00 – Sa 02:00", „3.–5. Oktober") — end before start on the same day must not become a negative range. → Task 1: `endDate` defaults to `startDate`; if `endDate < startDate` the end is dropped; if same day and `endTime <= startTime` the end time is dropped.
4. **Huge pages** (10 000-word listings) — the endpoint must cap, not 413/timeout. → Task 1 (bookmarklet cap 8 000 chars of text + 3 000 selection) and Task 2 (Zod caps 12 000 / 3 000; over-cap → 400, never a crash).
5. **The model returns prose or fenced JSON despite the schema** — parsing must not throw. → Task 1: `parseClipJson` strips ``` fences and returns `null` on any parse failure; Task 2 maps `null` to `ok:false, reason:'bad_json'`.

---

## File Structure

- Create `src/lib/clipper/extract.ts` — pure: types, `CLIP_JSON_SCHEMA`, `buildClipMessages()`, `parseClipJson()`, `normalizeClipResult()`, `toComposeParams()`. Dependency-free (imported by both the API route and the clip page's bundled script).
- Create `src/lib/clipper/extract.test.ts` — `node:test` suite for the module.
- Create `src/pages/api/events/clip.ts` — admin-gated endpoint; Zod body schema inline; calls OpenAI; returns `{ ok, result?, reason? }`.
- Create `src/lib/clipper/bookmarklet.js` — readable bookmarklet source (IIFE, ES5). Imported `?raw` by the clipper page.
- Modify `src/pages/event-clipper.astro` — inject the raw source via `define:vars`; update copy (reading step, admin note).
- Create `src/pages/events/clip.astro` — gated + admin check; bundled `<script>` does hash → API → redirect.
- Modify `src/components/calendar/kiosk/compose/EventComposePageInner.svelte` — read `clipMiss`, render the notice.
- Modify `src/lib/kiosk-i18n.ts` — two keys `cal.compose.clip.miss` (DE + EN).
- Modify `src/components/calendar/kiosk/CLAUDE.md` — clipper section v5.
- Scratchpad (local, never committed): `scratchpad/clipper-bookmarklet-probe.cjs`, `scratchpad/clipper-e2e-probe.cjs`, `scratchpad/clipper-fixture.html`.

---

### Task 1: Pure extraction module + tests

**Files:**
- Create: `src/lib/clipper/extract.ts`
- Test: `src/lib/clipper/extract.test.ts`

**Interfaces:**
- Produces (used by Tasks 2 and 4):
  ```ts
  export type ClipHint = { from?: string; to?: string; startTime?: string; endTime?: string; allDay?: boolean; location?: string };
  export type ClipInput = { title: string; url: string; text: string; selection?: string; hint?: ClipHint };
  export type ClipResult = {
    title: string | null; startDate: string | null; startTime: string | null;
    endDate: string | null; endTime: string | null; allDay: boolean;
    location: string | null; summary: string | null; confidence: 'high' | 'medium' | 'low';
  };
  export type NormalizedClip = ClipResult & { dateFound: boolean };
  export const CLIP_JSON_SCHEMA: Record<string, unknown>;
  export function berlinTodayISO(now?: Date): string;                       // 'YYYY-MM-DD' in Europe/Berlin
  export function buildClipMessages(input: ClipInput, todayISO: string): Array<{ role: 'system' | 'user'; content: string }>;
  export function parseClipJson(raw: string): unknown | null;
  export function normalizeClipResult(raw: unknown, todayISO: string): NormalizedClip;
  export function mergeHint(result: NormalizedClip, hint?: ClipHint): NormalizedClip;
  export function toComposeParams(result: NormalizedClip, page: { title: string; url: string; selection?: string }): URLSearchParams;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/clipper/extract.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  berlinTodayISO, buildClipMessages, parseClipJson, normalizeClipResult, mergeHint, toComposeParams,
  CLIP_JSON_SCHEMA,
} from './extract';

const today = '2026-09-26';

test('berlinTodayISO: Berlin date, not UTC — 23:30 UTC on the 25th is already the 26th in Berlin (CEST)', () => {
  assert.equal(berlinTodayISO(new Date('2026-09-25T23:30:00Z')), '2026-09-26');
  assert.equal(berlinTodayISO(new Date('2026-01-10T12:00:00Z')), '2026-01-10');
});

test('buildClipMessages: system prompt states today + weekday, user message carries title, url, selection, text and hints', () => {
  const msgs = buildClipMessages(
    { title: 'Kiezfest', url: 'https://example.org/e', text: 'Samstag 19 Uhr im Park', selection: 'Der Kiez feiert.', hint: { from: '2026-10-03', startTime: '19:00' } },
    today
  );
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /2026-09-26/);
  assert.match(msgs[0].content, /Saturday/);
  assert.match(msgs[0].content, /Europe\/Berlin/);
  assert.equal(msgs[1].role, 'user');
  assert.match(msgs[1].content, /Kiezfest/);
  assert.match(msgs[1].content, /https:\/\/example\.org\/e/);
  assert.match(msgs[1].content, /Der Kiez feiert\./);
  assert.match(msgs[1].content, /Samstag 19 Uhr im Park/);
  assert.match(msgs[1].content, /2026-10-03/);
});

test('CLIP_JSON_SCHEMA is strict and names every result field', () => {
  const s = CLIP_JSON_SCHEMA as any;
  assert.equal(s.strict, true);
  const props = Object.keys(s.schema.properties);
  for (const k of ['title', 'startDate', 'startTime', 'endDate', 'endTime', 'allDay', 'location', 'summary', 'confidence']) {
    assert.ok(props.includes(k), `missing ${k}`);
  }
  assert.deepEqual(s.schema.required.slice().sort(), props.slice().sort());
  assert.equal(s.schema.additionalProperties, false);
});

test('parseClipJson: plain JSON, fenced JSON, garbage', () => {
  assert.deepEqual(parseClipJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseClipJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(parseClipJson('Sorry, I cannot'), null);
  assert.equal(parseClipJson(''), null);
});

test('normalize: full valid answer passes through, dateFound true', () => {
  const r = normalizeClipResult({
    title: 'Kiezfest', startDate: '2026-10-03', startTime: '19:00', endDate: '2026-10-03', endTime: '22:00',
    allDay: false, location: 'Herrfurthplatz', summary: 'Ein Fest.', confidence: 'high',
  }, today);
  assert.equal(r.dateFound, true);
  assert.equal(r.startDate, '2026-10-03');
  assert.equal(r.endTime, '22:00');
  assert.equal(r.allDay, false);
});

test('normalize: time without date → no date, no time, dateFound false (Review Focus 2)', () => {
  const r = normalizeClipResult({ title: 'x', startDate: null, startTime: '19:00', endDate: null, endTime: null, allDay: false, location: null, summary: null, confidence: 'low' }, today);
  assert.equal(r.startDate, null);
  assert.equal(r.startTime, null);
  assert.equal(r.dateFound, false);
});

test('normalize: date without time → allDay true', () => {
  const r = normalizeClipResult({ title: 'x', startDate: '2026-10-03', startTime: null, endDate: null, endTime: null, allDay: false, location: null, summary: null, confidence: 'medium' }, today);
  assert.equal(r.allDay, true);
  assert.equal(r.endDate, '2026-10-03');
});

test('normalize: hallucinated far dates are dropped (Review Focus 1)', () => {
  const past = normalizeClipResult({ title: 'x', startDate: '2024-01-01', startTime: '10:00', endDate: null, endTime: null, allDay: false, location: null, summary: null, confidence: 'high' }, today);
  assert.equal(past.startDate, null);
  assert.equal(past.dateFound, false);
  const far = normalizeClipResult({ title: 'x', startDate: '2028-06-01', startTime: null, endDate: null, endTime: null, allDay: false, location: null, summary: null, confidence: 'high' }, today);
  assert.equal(far.startDate, null);
});

test('normalize: end before start is dropped; same-day end time not after start is dropped (Review Focus 3)', () => {
  const a = normalizeClipResult({ title: 'x', startDate: '2026-10-05', startTime: '20:00', endDate: '2026-10-03', endTime: '22:00', allDay: false, location: null, summary: null, confidence: 'high' }, today);
  assert.equal(a.endDate, '2026-10-05');
  assert.equal(a.endTime, null);
  const b = normalizeClipResult({ title: 'x', startDate: '2026-10-03', startTime: '20:00', endDate: '2026-10-03', endTime: '02:00', allDay: false, location: null, summary: null, confidence: 'high' }, today);
  assert.equal(b.endTime, null);
  const c = normalizeClipResult({ title: 'x', startDate: '2026-10-03', startTime: '20:00', endDate: '2026-10-04', endTime: '02:00', allDay: false, location: null, summary: null, confidence: 'high' }, today);
  assert.equal(c.endDate, '2026-10-04');
  assert.equal(c.endTime, '02:00');
});

test('normalize: malformed values and wrong types are nulled, strings clamped, unknown confidence → low', () => {
  const r = normalizeClipResult({ title: 'T'.repeat(300), startDate: '3.10.2026', startTime: '19 Uhr', endDate: 5, endTime: '25:00', allDay: 'yes', location: 'L'.repeat(300), summary: 'S'.repeat(1000), confidence: 'sure' }, today);
  assert.equal(r.title!.length, 200);
  assert.equal(r.startDate, null);
  assert.equal(r.startTime, null);
  assert.equal(r.endTime, null);
  assert.equal(r.allDay, false);
  assert.equal(r.location!.length, 200);
  assert.equal(r.summary!.length, 600);
  assert.equal(r.confidence, 'low');
  assert.equal(normalizeClipResult(null, today).dateFound, false);
  assert.equal(normalizeClipResult('x', today).title, null);
});

test('mergeHint: markup hint fills only what the model left empty', () => {
  const base = normalizeClipResult({ title: 'x', startDate: null, startTime: null, endDate: null, endTime: null, allDay: false, location: null, summary: null, confidence: 'low' }, today);
  const m = mergeHint(base, { from: '2026-10-03', startTime: '19:00', location: 'Park' });
  assert.equal(m.startDate, '2026-10-03');
  assert.equal(m.startTime, '19:00');
  assert.equal(m.location, 'Park');
  assert.equal(m.dateFound, true);
  const keep = mergeHint(normalizeClipResult({ title: 'x', startDate: '2026-10-04', startTime: '10:00', endDate: null, endTime: null, allDay: false, location: 'A', summary: null, confidence: 'high' }, today), { from: '2026-10-03', location: 'B' });
  assert.equal(keep.startDate, '2026-10-04');
  assert.equal(keep.location, 'A');
  assert.equal(mergeHint(base, { from: 'garbage' }).startDate, null);
});

test('toComposeParams: prefill contract of /events/create, selection wins over summary, source line appended, clipMiss on no date', () => {
  const found = normalizeClipResult({ title: 'Kiezfest', startDate: '2026-10-03', startTime: '19:00', endDate: '2026-10-04', endTime: '02:00', allDay: false, location: 'Park', summary: 'Ein Fest.', confidence: 'high' }, today);
  const p = toComposeParams(found, { title: 'Page title', url: 'https://example.org/e' });
  assert.equal(p.get('title'), 'Kiezfest');
  assert.equal(p.get('from'), '2026-10-03');
  assert.equal(p.get('to'), '2026-10-04');
  assert.equal(p.get('startTime'), '19:00');
  assert.equal(p.get('endTime'), '02:00');
  assert.equal(p.get('allDay'), null);
  assert.equal(p.get('location'), 'Park');
  assert.equal(p.get('body'), 'Ein Fest.\n\nQuelle: https://example.org/e');
  assert.equal(p.get('clipMiss'), null);

  const sel = toComposeParams(found, { title: 'Page title', url: 'https://example.org/e', selection: 'Markiert.' });
  assert.equal(sel.get('body'), 'Markiert.\n\nQuelle: https://example.org/e');

  const allDay = normalizeClipResult({ title: null, startDate: '2026-10-03', startTime: null, endDate: null, endTime: null, allDay: true, location: null, summary: null, confidence: 'medium' }, today);
  const q = toComposeParams(allDay, { title: 'Page title', url: 'https://example.org/e' });
  assert.equal(q.get('title'), 'Page title');
  assert.equal(q.get('allDay'), '1');
  assert.equal(q.get('to'), null);
  assert.equal(q.get('body'), 'Quelle: https://example.org/e');

  const miss = toComposeParams(normalizeClipResult(null, today), { title: 'Page title', url: 'https://example.org/e' });
  assert.equal(miss.get('clipMiss'), '1');
  assert.equal(miss.get('from'), null);
  assert.equal(miss.get('title'), 'Page title');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/lib/clipper/extract.test.ts`
Expected: FAIL — `Cannot find module './extract'`.

- [ ] **Step 3: Write the module**

```ts
// src/lib/clipper/extract.ts
// Termin-Clipper v5 (2026-09-26): pure helpers around the LLM extraction.
// Dependency-free — imported by the API route (server) AND the /events/clip
// page script (browser). Never import mongodb/Sentry/env here.

export type ClipHint = {
  from?: string; to?: string; startTime?: string; endTime?: string; allDay?: boolean; location?: string;
};
export type ClipInput = { title: string; url: string; text: string; selection?: string; hint?: ClipHint };
export type ClipResult = {
  title: string | null;
  startDate: string | null;   // YYYY-MM-DD
  startTime: string | null;   // HH:MM (24h)
  endDate: string | null;
  endTime: string | null;
  allDay: boolean;
  location: string | null;
  summary: string | null;
  confidence: 'high' | 'medium' | 'low';
};
export type NormalizedClip = ClipResult & { dateFound: boolean };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const MAX_TITLE = 200;      // EventBaseSchema title max
const MAX_LOCATION = 200;   // EventBaseSchema location max
const MAX_SUMMARY = 600;
const MAX_DAYS_AWAY = 400;  // beyond this a date is a hallucination, not an event

/** Strict structured-output schema for chat.completions `response_format`. */
export const CLIP_JSON_SCHEMA = {
  name: 'mahalle_event_clip',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: ['string', 'null'], description: 'Short event title, max 120 chars, in the page language' },
      startDate: { type: ['string', 'null'], description: 'YYYY-MM-DD or null if the page states no date' },
      startTime: { type: ['string', 'null'], description: 'HH:MM 24h or null' },
      endDate: { type: ['string', 'null'], description: 'YYYY-MM-DD or null (same day → repeat startDate)' },
      endTime: { type: ['string', 'null'], description: 'HH:MM 24h or null' },
      allDay: { type: 'boolean' },
      location: { type: ['string', 'null'], description: 'Venue name and street if present, max 200 chars' },
      summary: { type: ['string', 'null'], description: '2–3 neutral sentences in the page language, no marketing' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['title', 'startDate', 'startTime', 'endDate', 'endTime', 'allDay', 'location', 'summary', 'confidence'],
  },
} as const;

/** Today's date in Europe/Berlin as YYYY-MM-DD (en-CA formats ISO-like). */
export function berlinTodayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function weekdayOf(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${isoDate}T12:00:00Z`));
}

export function buildClipMessages(input: ClipInput, todayISO: string): Array<{ role: 'system' | 'user'; content: string }> {
  const system = [
    'You extract ONE event from the visible text of a web page for a Berlin neighbourhood calendar.',
    `Today is ${weekdayOf(todayISO)}, ${todayISO} (timezone Europe/Berlin). Resolve relative dates ("Samstag", "morgen", "nächsten Freitag") against today; never invent a date that the text does not support — answer null instead.`,
    'Dates as YYYY-MM-DD, times as 24h HH:MM. If the page names a date but no start time, set allDay true. If a single-day event ends after midnight, endDate is the next day.',
    'Prefer the event the page is ABOUT over other events mentioned in navigation, teasers or listings. If the text is a listing of many events, extract the first one that has a full date.',
    'title: short, no venue, no date. location: venue name plus street if given. summary: 2–3 neutral sentences in the language of the page (German or English), no marketing phrases, no URLs.',
    'confidence: high = date, time and title are explicit; medium = one of them inferred; low = date missing or guessed.',
    'Hints marked as "structured hints" come from the page markup; trust them unless the text clearly contradicts them.',
  ].join('\n');

  const parts: string[] = [];
  parts.push(`Page title: ${input.title}`);
  parts.push(`Page URL: ${input.url}`);
  if (input.hint && Object.keys(input.hint).length) parts.push(`Structured hints from the page markup: ${JSON.stringify(input.hint)}`);
  if (input.selection) parts.push(`Text the user selected on the page (most relevant):\n${input.selection}`);
  parts.push(`Visible page text:\n${input.text}`);
  return [
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/** Tolerant JSON reader: strips ``` fences, returns null on any failure. */
export function parseClipJson(raw: string): unknown | null {
  const s = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}
function ymd(v: unknown): string | null {
  return typeof v === 'string' && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null;
}
function hhmm(v: unknown): string | null {
  return typeof v === 'string' && HHMM.test(v) ? v : null;
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function normalizeClipResult(raw: unknown, todayISO: string): NormalizedClip {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let startDate = ymd(o.startDate);
  if (startDate && Math.abs(daysBetween(todayISO, startDate)) > MAX_DAYS_AWAY) startDate = null; // Review Focus 1
  let startTime = startDate ? hhmm(o.startTime) : null;                                          // Review Focus 2
  let endDate = startDate ? (ymd(o.endDate) ?? startDate) : null;
  let endTime = startDate ? hhmm(o.endTime) : null;
  if (startDate && endDate && endDate < startDate) { endDate = startDate; endTime = null; }       // Review Focus 3: a nonsense end date makes its end time suspect too
  if (startDate && endDate === startDate && startTime && endTime && endTime <= startTime) endTime = null;
  if (startDate && !startTime) endTime = null;
  const allDay = !!startDate && (!startTime || o.allDay === true);
  if (allDay) { startTime = null; endTime = null; }
  const conf = o.confidence;
  return {
    title: str(o.title, MAX_TITLE),
    startDate, startTime, endDate, endTime, allDay,
    location: str(o.location, MAX_LOCATION),
    summary: str(o.summary, MAX_SUMMARY),
    confidence: conf === 'high' || conf === 'medium' ? conf : 'low',
    dateFound: !!startDate,
  };
}

/** Markup hints (JSON-LD / <time datetime>) fill only what the model left empty. */
export function mergeHint(result: NormalizedClip, hint?: ClipHint): NormalizedClip {
  if (!hint) return result;
  const out = { ...result };
  if (!out.startDate && ymd(hint.from)) {
    out.startDate = ymd(hint.from);
    out.endDate = ymd(hint.to) && (hint.to as string) >= out.startDate! ? (hint.to as string) : out.startDate;
    out.startTime = hhmm(hint.startTime);
    out.endTime = out.startTime ? hhmm(hint.endTime) : null;
    out.allDay = hint.allDay === true || !out.startTime;
    if (out.allDay) { out.startTime = null; out.endTime = null; }
    out.dateFound = true;
  }
  if (!out.location && typeof hint.location === 'string') out.location = str(hint.location, MAX_LOCATION);
  return out;
}

/** The /events/create prefill contract (EventComposePageInner.computeInitialValues) + clipMiss. */
export function toComposeParams(result: NormalizedClip, page: { title: string; url: string; selection?: string }): URLSearchParams {
  const p = new URLSearchParams();
  const title = result.title ?? str(page.title, MAX_TITLE);
  if (title) p.set('title', title);
  const lead = page.selection?.trim() || result.summary || '';
  p.set('body', (lead ? `${lead}\n\n` : '') + `Quelle: ${page.url}`);
  if (result.startDate) {
    p.set('from', result.startDate);
    if (result.endDate && result.endDate !== result.startDate) p.set('to', result.endDate);
    if (result.allDay) p.set('allDay', '1');
    if (result.startTime) p.set('startTime', result.startTime);
    if (result.endTime) p.set('endTime', result.endTime);
  } else {
    p.set('clipMiss', '1');
  }
  if (result.location) p.set('location', result.location);
  return p;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/lib/clipper/extract.test.ts`
Expected: all tests PASS (12 tests). If `parseClipJson('```json\n{"a":1}\n```')` fails, check the fence regex handles the trailing newline before the closing fence.

- [ ] **Step 5: Gate count and commit**

Run: `pnpm type-check 2>&1 | grep -c "error TS"` → must print `23`.

```bash
git add src/lib/clipper/extract.ts src/lib/clipper/extract.test.ts
git commit -m "clipper: pure LLM-extraction helpers (prompt, strict schema, normaliser, compose params) + tests"
```

---

### Task 2: Admin-only extraction endpoint

**Files:**
- Create: `src/pages/api/events/clip.ts`

**Interfaces:**
- Consumes (Task 1): `buildClipMessages`, `parseClipJson`, `normalizeClipResult`, `mergeHint`, `berlinTodayISO`, `CLIP_JSON_SCHEMA`, types `ClipInput`, `NormalizedClip`.
- Consumes (existing): `requireAdminSession(request)` from `src/lib/auth.ts` (`{ ok: true; userId } | { ok: false; response }`), `import * as Sentry from '@sentry/astro'` (as `moderation.ts` does — copy its import line exactly).
- Produces (Task 4): `POST /api/events/clip`, JSON body `ClipInput`, response `200 { ok: true, result: NormalizedClip }` or `200 { ok: false, reason: 'not_configured' | 'llm_unavailable' | 'bad_json' }`; `400 { error: 'invalid_input' }`; 401/403 from the guard; always `Cache-Control: no-store`.

- [ ] **Step 1: Write the route**

```ts
// src/pages/api/events/clip.ts
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
```

- [ ] **Step 2: Type-check**

Run: `pnpm type-check 2>&1 | grep -c "error TS"` → must print `23`. If the Sentry import differs from `moderation.ts`, copy that file's exact import line.

- [ ] **Step 3: Probe the endpoint on the dev server (local scratchpad, not committed)**

The orchestrator's dev server runs on `:4655` (start with `pnpm dev --port 4655` if `curl -s -o /dev/null -w "%{http_code}" http://localhost:4655/login` is not `200`). Write `scratchpad/clipper-api-probe.cjs`:

```js
// Logs in as the dev admin (password from scratchpad/devpw.txt, never printed) and exercises POST /api/events/clip.
const fs = require('fs');
const BASE = process.env.PROBE_BASE || 'http://localhost:4655';
(async () => {
  const pw = fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim();
  // Auth.js credentials login by fetch — the recipe from scratchpad/e2e-admin-hint.mts (known to work here):
  // csrf → callback/credentials with redirect:'manual' → cookies collected via getSetCookie().
  const jar = {};
  const store = (res) => { for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const e = pair.indexOf('='); jar[pair.slice(0, e)] = pair.slice(e + 1); } };
  const ch = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const loginAs = async (email) => {
    for (const k of Object.keys(jar)) delete jar[k];
    const r = await fetch(`${BASE}/api/auth/csrf`); store(r); const { csrfToken } = await r.json();
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: ch() }, body: new URLSearchParams({ csrfToken, email, password: pw }) });
    store(res);
    const s = await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie: ch() } })).json();
    if (!s?.user) { console.log(`FAIL login as ${email}`); process.exit(1); }
    return ch();
  };
  const cookie = await loginAs('admin@mahalle-dev.test');
  let fails = 0; const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${x}`); if (!ok) fails++; };
  const post = (body, c = cookie) => fetch(`${BASE}/api/events/clip`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: c }, body: JSON.stringify(body) });

  const anon = await post({ url: 'https://x.org', text: 'x' }, '');
  check('logged-out → 401', anon.status === 401, String(anon.status));
  const bad = await post({ url: 'ftp://x', text: '' });
  check('invalid body → 400', bad.status === 400, String(bad.status));
  const text = 'Kiezfest am Herrfurthplatz\nSamstag, 3. Oktober 2026, 19 bis 22 Uhr\nOrt: Herrfurthplatz, 12049 Berlin\nMusik, Essen und Nachbarschaft. Eintritt frei.';
  const t0 = Date.now();
  const r = await post({ title: 'Kiezfest', url: 'https://example.org/kiezfest', text });
  const j = await r.json();
  check('real text → 200 ok', r.status === 200 && j.ok === true, JSON.stringify(j).slice(0, 200));
  check('date 2026-10-03, 19:00–22:00, not all-day', j.result?.startDate === '2026-10-03' && j.result?.startTime === '19:00' && j.result?.endTime === '22:00' && j.result?.allDay === false, `${j.result?.startDate} ${j.result?.startTime}-${j.result?.endTime} allDay=${j.result?.allDay}`);
  check('location mentions Herrfurthplatz', /Herrfurthplatz/.test(j.result?.location || ''), j.result?.location);
  check('summary present, no URL in it', !!j.result?.summary && !/https?:\/\//.test(j.result.summary), (j.result?.summary || '').slice(0, 80));
  check('answered under 20 s', Date.now() - t0 < 20000, `${Date.now() - t0} ms`);
  const noDate = await (await post({ title: 'Yoga', url: 'https://example.org/y', text: 'Yoga im Park. Jeden Abend um 19 Uhr treffen wir uns. Bring eine Matte mit.' })).json();
  check('time without date → dateFound false, no startDate', noDate.ok === true && noDate.result.dateFound === false && noDate.result.startDate === null, JSON.stringify(noDate.result).slice(0, 160));
  const hinted = await (await post({ title: 'Lesung', url: 'https://example.org/l', text: 'Lesung mit Musik. Eintritt frei.', hint: { from: '2026-10-10', startTime: '20:00' } })).json();
  check('hint fills a missing date', hinted.ok === true && hinted.result.startDate === '2026-10-10' && hinted.result.startTime === '20:00', JSON.stringify(hinted.result).slice(0, 160));
  const memberCookie = await loginAs('jonas@mahalle-dev.test');
  const nonAdmin = await post({ url: 'https://x.org', text: 'x' }, memberCookie);
  check('member (non-admin) → 403', nonAdmin.status === 403, String(nonAdmin.status));
  console.log(fails ? `${fails} FAILED` : 'all green'); process.exit(fails ? 1 : 0);
})();
```

Run: `node scratchpad/clipper-api-probe.cjs`
Expected: `all green` (9 checks). The login recipe is copied from `scratchpad/e2e-admin-hint.mts` (fetch-based Auth.js login that works on this dev server) — if it fails, read that file and compare. The model's wording of `location`/`summary` may vary; the date/time checks are the ones that must hold. If the dev seed's admin password differs from `devpw.txt`, run `grep -n "password" scripts/seed-dev-db.ts | head -3` to find where the seed reads it — never print the value.

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/events/clip.ts
git commit -m "clipper: admin-only POST /api/events/clip — OpenAI strict-JSON extraction, fail-safe, nothing stored"
```

---

### Task 3: Bookmarklet as a source file + clipper page injection

**Files:**
- Create: `src/lib/clipper/bookmarklet.js`
- Modify: `src/pages/event-clipper.astro` (frontmatter import, `<script is:inline define:vars>`, copy)
- Local probe: `scratchpad/clipper-bookmarklet-probe.cjs`, `scratchpad/clipper-fixture.html`

**Interfaces:**
- Produces (Task 4 reads it): the bookmarklet opens `__ORIGIN__/events/clip#` + `encodeURIComponent(JSON.stringify(payload))` where `payload = { v: 1, title, url, text, selection, hint }` — `hint` has the same keys as `ClipHint` (Task 1), only present keys set; `text` ≤ 8000 chars, `selection` ≤ 3000, `title` ≤ 300.

- [ ] **Step 1: Write the bookmarklet source**

```js
// @ts-nocheck
// src/lib/clipper/bookmarklet.js — Termin-Clipper v5 (2026-09-26).
// Runs INSIDE a foreign event page (bookmarklet). ES5 only, no template
// literals, no arrow functions, no external script (strict CSPs would block
// a loader; inline bookmarklet code is exempt). Injected into /event-clipper
// via a Vite `?raw` import; __ORIGIN__ is replaced there with the page origin.
// Collects: title, URL, user selection, visible text (capped), and the
// markup hints v2–v4 already found (JSON-LD Event, <time datetime>, venue
// label) — then opens /events/clip with everything in the URL FRAGMENT
// (never sent to a server; no length worries; no cross-origin fetch).
(function () {
  function meta(sel) { var m = document.querySelector(sel); return m ? m.getAttribute('content') : null; }
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  var title = clean(meta('meta[property="og:title"]') || document.title || '').slice(0, 300);
  var url = location.href;
  var selection = '';
  try { selection = clean(String(window.getSelection())).slice(0, 3000); } catch (e) {}

  // Visible text: main/article first (less chrome), whole body as fallback.
  var root = document.querySelector('main, article, [role="main"]') || document.body;
  var text = '';
  try { text = clean(root.innerText || root.textContent || ''); } catch (e) {}
  if (text.length < 200 && root !== document.body) { try { text = clean(document.body.innerText || ''); } catch (e) {} }
  text = text.slice(0, 8000);

  // Markup hints (kept from v2–v4): JSON-LD Event → <time datetime> → venue label.
  var hint = {};
  try {
    var sc = document.querySelectorAll('script[type="application/ld+json"]');
    outer: for (var i = 0; i < sc.length; i++) {
      var d = JSON.parse(sc[i].textContent);
      var arr = Array.isArray(d) ? d : (d && d['@graph'] ? d['@graph'] : [d]);
      for (var j = 0; j < arr.length; j++) {
        var n = arr[j];
        if (n && /Event/.test(String(n['@type'])) && n.startDate) {
          var sd = String(n.startDate); hint.from = sd.slice(0, 10);
          if (sd.length >= 16) hint.startTime = sd.slice(11, 16);
          if (n.endDate) { var ed = String(n.endDate); var edd = ed.slice(0, 10); if (edd !== hint.from) hint.to = edd; if (ed.length >= 16) hint.endTime = ed.slice(11, 16); }
          if (n.location) hint.location = clean(n.location.name || (typeof n.location === 'string' ? n.location : '')).slice(0, 200);
          break outer;
        }
      }
    }
  } catch (e) {}
  if (!hint.from) {
    try {
      var ts = document.querySelectorAll('time[datetime]');
      if (ts.length) {
        var d1 = String(ts[0].getAttribute('datetime')); hint.from = d1.slice(0, 10);
        if (d1.length >= 16) hint.startTime = d1.slice(11, 16);
        if (ts.length > 1) { var d2 = String(ts[1].getAttribute('datetime')); var dd2 = d2.slice(0, 10); if (dd2 !== hint.from) hint.to = dd2; if (d2.length >= 16) hint.endTime = d2.slice(11, 16); }
      }
    } catch (e) {}
  }
  if (hint.from && !/^\d{4}-\d{2}-\d{2}$/.test(hint.from)) hint = {};
  if (hint.from && !hint.startTime) hint.allDay = true;
  if (!hint.location) {
    try {
      var els = document.querySelectorAll('dt,th,strong,b,h3,h4,h5,div,span,p');
      for (var k = 0; k < els.length; k++) {
        var lt = clean(els[k].textContent);
        if (/^(where|wo|ort|veranstaltungsort|location)$/i.test(lt)) {
          var sib = els[k].nextElementSibling; var lv = sib ? clean(sib.textContent) : '';
          if (lv && lv.length <= 120) { hint.location = lv; break; }
        }
      }
    } catch (e) {}
  }
  if (!hint.location) delete hint.location;

  var payload = { v: 1, title: title, url: url, text: text, selection: selection, hint: hint };
  window.open('__ORIGIN__/events/clip#' + encodeURIComponent(JSON.stringify(payload)), '_blank');
})();
```

- [ ] **Step 2: Syntax-check the source**

Run: `node --check src/lib/clipper/bookmarklet.js && echo SYNTAX_OK`
Expected: `SYNTAX_OK`.

- [ ] **Step 3: Rewrite the clipper page to inject the source**

Replace the whole `<script is:inline data-astro-rerun>` block and update the frontmatter + copy in `src/pages/event-clipper.astro`. Keep the `<style>` block and the layout props (`page="calendar"`, `noindex={true}`) exactly as they are.

Frontmatter (replace the existing one):
```astro
---
// /event-clipper — Termin-Clipper bookmarklet page.
//
// Deliberately NOT login-gated (instructions are harmless). Since v5
// (2026-09-26) the bookmarklet no longer builds the compose URL itself: it
// ships the page text to /events/clip (admin-only), where OpenAI reads
// date, time and place. The bookmarklet SOURCE is a readable file
// (src/lib/clipper/bookmarklet.js) imported ?raw and injected below; the
// href is built client-side from location.origin so dev clips into dev
// and prod into prod. Bookmarklets freeze at drag time: after any change
// to the source, re-drag the button.
import KioskLayout from '../layouts/KioskLayout.astro';
import bookmarkletSrc from '../lib/clipper/bookmarklet.js?raw';
---
```

Copy changes inside `<main>` (only these lines change):
- The `<li>` list's third item becomes: `<li>Mahalle liest die Seite (ein paar Sekunden) und öffnet den Termin vorausgefüllt — Datum, Uhrzeit, Ort, Kurztext. Prüfen, ergänzen, veröffentlichen.</li>`
- The `.clip-note` paragraph becomes: `Das Lesen übernimmt ein Sprachmodell (OpenAI); die Seite wird dafür als Text übertragen, nichts wird gespeichert. Der Clipper ist ein Admin-Werkzeug. Nach einer Änderung am Clipper den Knopf neu in die Leiste ziehen. Auf dem Handy funktionieren Lesezeichen-Skripte leider nur eingeschränkt.`

Script (replace the old block):
```astro
<script is:inline define:vars={{ bookmarkletSrc }}>
  (function () {
    var link = document.getElementById('clipper-link');
    if (!link) return;
    link.setAttribute(
      'href',
      'javascript:' + encodeURIComponent(bookmarkletSrc.replace('__ORIGIN__', location.origin))
    );
    // A click on the page itself shouldn't run the clipper here (it would
    // clip the clipper page) — nudge to drag instead.
    link.addEventListener('click', function (e) {
      e.preventDefault();
      alert('Zieh den Knopf in deine Lesezeichen-Leiste — von dort aus clippt er jede Seite.');
    });
  })();
</script>
```

Note: `define:vars` serialises the string safely — no manual escaping. `*?raw` is already typed: `src/env.d.ts` references `astro/client`, which pulls in Vite's client types (`node_modules/vite/client.d.ts:243 declare module '*?raw'`), so no declaration is needed (verified 00:50).

- [ ] **Step 4: Verify the page serves the new bookmarklet**

Run: `curl -s http://localhost:4655/event-clipper | grep -c "events/clip#"` → must print `1` (the source is embedded). Also `curl -s http://localhost:4655/event-clipper | grep -c "define:vars"` → `0` (Astro must have compiled the directive away; a `1` means the script is not `is:inline`).

- [ ] **Step 5: Bookmarklet probe against a fixture page (local, not committed)**

Write `scratchpad/clipper-fixture.html` — a berlin.de-style page WITHOUT JSON-LD:
```html
<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Kiezfest am Herrfurthplatz – Nachbarschaftshaus</title>
<meta property="og:title" content="Kiezfest am Herrfurthplatz"></head>
<body><nav>Start · Programm · Kontakt</nav>
<main><h1>Kiezfest am Herrfurthplatz</h1>
<p><time datetime="2026-10-03T19:00">Samstag, 3. Oktober 2026, 19 Uhr</time> bis 22 Uhr</p>
<h3>Ort</h3><p>Herrfurthplatz, 12049 Berlin</p>
<p>Musik, Essen und Nachbarschaft: das Kiezfest bringt alle zusammen, die am Herrfurthplatz wohnen oder arbeiten. Der Eintritt ist frei, Spenden sind willkommen. Kommt vorbei und bringt eure Nachbarinnen und Nachbarn mit.</p>
</main><footer>Impressum</footer></body></html>
```

Write `scratchpad/clipper-bookmarklet-probe.cjs`:
```js
// Runs the REAL bookmarklet (as served by /event-clipper on :4655) inside a fixture page with window.open stubbed.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  // Read the REAL bookmarklet the page hands out: the href the drag button carries.
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:4655/event-clipper');
  const href = await p.getAttribute('#clipper-link', 'href');
  if (!href || !href.startsWith('javascript:')) { console.log('FAIL no javascript: href on #clipper-link'); process.exit(1); }
  const src = decodeURIComponent(href.slice('javascript:'.length));
  if (!src.includes('http://localhost:4655/events/clip#')) { console.log('FAIL __ORIGIN__ not replaced'); process.exit(1); }
  await p.goto('file://' + path.resolve('scratchpad/clipper-fixture.html'));
  const opened = await p.evaluate((code) => { let u = null; window.open = (x) => { u = x; return null; }; eval(code); return u; }, src);
  let fails = 0; const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${x}`); if (!ok) fails++; };
  check('opens /events/clip with a fragment', typeof opened === 'string' && opened.startsWith('http://localhost:4655/events/clip#'), String(opened).slice(0, 60));
  const payload = JSON.parse(decodeURIComponent(String(opened).split('#')[1] || ''));
  check('v=1, og:title used', payload.v === 1 && payload.title === 'Kiezfest am Herrfurthplatz', payload.title);
  check('url is the page url', /clipper-fixture\.html$/.test(payload.url), payload.url);
  check('text is the main text, nav and footer excluded', /Musik, Essen/.test(payload.text) && !/Impressum/.test(payload.text) && !/Programm · Kontakt/.test(payload.text), payload.text.slice(0, 60));
  check('time[datetime] hint: from + startTime, venue label → location', payload.hint.from === '2026-10-03' && payload.hint.startTime === '19:00' && /Herrfurthplatz/.test(payload.hint.location || ''), JSON.stringify(payload.hint));
  check('no selection → empty string', payload.selection === '');
  await p.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('main p:last-child')); getSelection().removeAllRanges(); getSelection().addRange(r); });
  const opened2 = await p.evaluate((code) => { let u = null; window.open = (x) => { u = x; return null; }; eval(code); return u; }, src);
  const payload2 = JSON.parse(decodeURIComponent(String(opened2).split('#')[1] || ''));
  check('selection carried', /Musik, Essen/.test(payload2.selection), payload2.selection.slice(0, 40));
  await b.close(); console.log(fails ? `${fails} FAILED` : 'all green'); process.exit(fails ? 1 : 0);
})();
```

Run: `NODE_PATH=$(npm root -g)/@playwright/cli/node_modules node scratchpad/clipper-bookmarklet-probe.cjs`
Expected: `all green` (7 checks). The probe takes the bookmarklet from the button's `href` on the served page, so it tests exactly what a user drags — no assumption about how Astro serialises `define:vars`.

- [ ] **Step 6: Gates and commit**

Run: `pnpm type-check 2>&1 | grep -c "error TS"` → `23`. Run: `npx -y svelte-check@4 2>&1 | grep -E "COMPLETED .* ERRORS"` → `89 ERRORS`.

```bash
git add src/lib/clipper/bookmarklet.js src/pages/event-clipper.astro
git commit -m "clipper: bookmarklet as a readable source file (?raw), ships page text to /events/clip via the URL fragment"
```


---

### Task 4: The clip page + composer notice

**Files:**
- Create: `src/pages/events/clip.astro`
- Modify: `src/components/calendar/kiosk/compose/EventComposePageInner.svelte` (URL param read near line 84; notice markup near line 319)
- Modify: `src/lib/kiosk-i18n.ts` (two keys)
- Local probe: `scratchpad/clipper-e2e-probe.cjs`

**Interfaces:**
- Consumes (Task 1): `toComposeParams`, `mergeHint`, `normalizeClipResult`, `berlinTodayISO`, type `NormalizedClip`. (Task 2): `POST /api/events/clip`. (Task 3): the fragment payload `{ v, title, url, text, selection, hint }`.
- Produces: `/events/clip` page; `?clipMiss=1` handling on `/events/create`; i18n keys `cal.compose.clip.miss`.

- [ ] **Step 1: Write the clip page**

```astro
---
// /events/clip — Termin-Clipper v5 landing (2026-09-26). ADMIN-ONLY.
// The bookmarklet opens this page with the event page's text in the URL
// FRAGMENT (never sent to a server). The bundled script below reads it,
// strips it from history, POSTs it to /api/events/clip (same origin → the
// session cookie rides along, no CORS), and redirects to the normal
// /events/create prefill. Middleware already gates /events; here we add the
// admin check because the endpoint is admin-only too.
import KioskLayout from '../../layouts/KioskLayout.astro';
import { getSession } from 'auth-astro/server';

const session = await getSession(Astro.request);
if (!session?.user) return Astro.redirect('/login?redirect=%2Fevents%2Fclip', 302);
if (session.user.role !== 'admin') return Astro.redirect('/calendar', 302);
---

<KioskLayout title="Mahalle · Termin wird gelesen" description="Termin-Clipper" page="calendar" noindex={true}>
  <main class="clip-status px-4 md:px-9 lg:px-10">
    <p class="font-dmmono text-[11px] uppercase tracking-[0.18em]" style="color: var(--k-ink-mute);">WERKZEUG · KALENDER</p>
    <h1 class="font-bricolage font-bold text-[28px] md:text-[34px] tracking-tight mt-2" style="color: var(--k-ink);">Termin wird gelesen …</h1>
    <p id="clip-msg" class="mt-3 text-[15px] leading-relaxed" style="color: var(--k-ink-soft);">Einen Moment — Datum, Uhrzeit und Ort werden aus der Seite gelesen.</p>
    <p id="clip-fallback" class="mt-6 hidden text-[14px]">
      <a href="/event-clipper" class="underline">Zurück zum Clipper</a> · <a href="/events/create" class="underline">Termin von Hand anlegen</a>
    </p>
  </main>
</KioskLayout>

<script>
  import { toComposeParams, mergeHint, normalizeClipResult, berlinTodayISO, type ClipHint } from '../../lib/clipper/extract';

  type Payload = { v: number; title: string; url: string; text: string; selection?: string; hint?: ClipHint };

  const msg = document.getElementById('clip-msg')!;
  const fallback = document.getElementById('clip-fallback')!;
  const fail = (text: string) => { msg.textContent = text; fallback.classList.remove('hidden'); };

  (async () => {
    let payload: Payload | null = null;
    try {
      const raw = location.hash.slice(1);
      if (raw) payload = JSON.parse(decodeURIComponent(raw));
    } catch { payload = null; }
    // Strip the text from the address bar / history right away (the page is
    // ours, but a 12 000-char fragment in the history list helps nobody).
    history.replaceState(history.state, '', location.pathname);
    if (!payload || payload.v !== 1 || typeof payload.text !== 'string' || typeof payload.url !== 'string') {
      fail('Nichts empfangen. Bitte den Clipper auf der Veranstaltungsseite noch einmal anklicken.');
      return;
    }
    const page = { title: String(payload.title || ''), url: payload.url, selection: payload.selection || '' };
    let result = mergeHint(normalizeClipResult(null, berlinTodayISO()), payload.hint); // markup-only fallback
    try {
      const res = await fetch('/api/events/clip', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: page.title, url: page.url, text: payload.text, selection: page.selection || undefined, hint: payload.hint }),
      });
      if (res.status === 401 || res.status === 403) { fail('Bitte als Admin anmelden und den Clipper erneut anklicken.'); return; }
      const data = await res.json().catch(() => null);
      if (data?.ok && data.result) result = data.result;
    } catch { /* fall through with the markup-only result */ }
    const params = toComposeParams(result, page);
    location.replace('/events/create?' + params.toString());
  })();
</script>
```

Note: a bundled (non-inline) `<script>` in an `.astro` page is processed by Vite, so the TypeScript import works. It runs once per document — this page is never reached by a view transition, so no `data-astro-rerun` is needed. `hidden` is Tailwind's `display:none`.

- [ ] **Step 2: i18n keys**

In `src/lib/kiosk-i18n.ts`, next to `'cal.compose.field.allDay'` in BOTH dictionaries add:
- DE: `'cal.compose.clip.miss': 'Kein Datum erkannt — bitte Datum und Uhrzeit prüfen.',`
- EN: `'cal.compose.clip.miss': 'No date recognised — please check date and time.',`
(Draft copy; the user words UI copy himself — flag in the report.)

- [ ] **Step 3: Composer reads `clipMiss` and shows the notice**

In `src/components/calendar/kiosk/compose/EventComposePageInner.svelte`:

(a) Add a state next to `inlineError` (around line 197): `let clipMiss = $state(false);`

(b) The file computes its initial values synchronously at module init (`const initialValues = computeInitialValues();`, line ~138 — the island is `client:only`, so `window` exists; there is NO `onMount`). Read the flag the same way, right after that line:
```ts
const clipMissParam = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('clipMiss') === '1';
```
and initialise the state with it: `let clipMiss = $state(clipMissParam);` (declare the state AFTER this const, next to `inlineError`).

(c) Directly ABOVE the existing `{#if inlineError}` block (line ~319), add:
```svelte
{#if clipMiss}
  <div class="px-4 md:px-9 lg:px-10 pb-4">
    <p class="font-bricolage text-sm px-3.5 py-2 rounded-md border" style="color: var(--k-ink); background: color-mix(in srgb, var(--k-ochre) 18%, transparent); border-color: var(--k-ochre);" role="status">
      {$t['cal.compose.clip.miss']}
    </p>
  </div>
{/if}
```
The translation store is imported as `import { t } from '../../../../lib/kiosk-i18n';` (line 31) and read as `$t[...]`. No element with `role="status"` exists on the compose page yet, so the probe's count of 1 is exact.

- [ ] **Step 4: Gates**

Run: `pnpm type-check 2>&1 | grep -c "error TS"` → `23`. Run: `npx -y svelte-check@4 2>&1 | grep -E "COMPLETED .* ERRORS"` → `89 ERRORS`. A new error means the `$state`/`$t` usage is wrong — fix it, never raise the budget.

- [ ] **Step 5: End-to-end probe on the dev server (local, not committed)**

Write `scratchpad/clipper-e2e-probe.cjs`:
```js
// Admin logs in on :4655, opens /events/clip with a bookmarklet-shaped fragment, lands on the prefilled composer.
const { chromium } = require('playwright'); const fs = require('fs');
const BASE = 'http://localhost:4655';
(async () => {
  const b = await chromium.launch(); let fails = 0;
  const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${x}`); if (!ok) fails++; };
  const login = async (email) => {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await p.goto(`${BASE}/login`);
    await p.fill('input[type="email"]', email); await p.fill('input[type="password"]', fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim());
    await p.keyboard.press('Enter'); await p.waitForURL('**/forum**', { waitUntil: 'domcontentloaded', timeout: 60000 });
    return p;
  };
  const frag = (o) => '#' + encodeURIComponent(JSON.stringify(o));
  const p = await login('admin@mahalle-dev.test');
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));

  // 1. Full path: text with a date → composer prefilled.
  await p.goto(`${BASE}/events/clip` + frag({ v: 1, title: 'Kiezfest am Herrfurthplatz', url: 'https://example.org/kiezfest', text: 'Kiezfest am Herrfurthplatz. Samstag, 3. Oktober 2026, 19 bis 22 Uhr. Ort: Herrfurthplatz, 12049 Berlin. Musik, Essen und Nachbarschaft. Eintritt frei.', selection: '', hint: {} }));
  await p.waitForURL('**/events/create?**', { timeout: 45000 }); await p.waitForTimeout(1500);
  const u = new URL(p.url());
  check('redirected to compose with from=2026-10-03', u.searchParams.get('from') === '2026-10-03', u.search.slice(0, 120));
  check('times 19:00–22:00', u.searchParams.get('startTime') === '19:00' && u.searchParams.get('endTime') === '22:00');
  check('no clipMiss', u.searchParams.get('clipMiss') === null);
  check('body ends with the Quelle line', /Quelle: https:\/\/example\.org\/kiezfest$/.test(u.searchParams.get('body') || ''));
  const dateVal = await p.locator('input[type="date"]').first().inputValue();
  const timeVal = await p.locator('input[type="time"]').first().inputValue();
  check('form shows the date and start time', dateVal === '2026-10-03' && timeVal === '19:00', `${dateVal} ${timeVal}`);
  check('fragment stripped from history (no # in url)', !p.url().includes('#'));
  await p.screenshot({ path: '/mnt/c/Users/atakee/Downloads/clipper-prefilled.png' });

  // 2. No date on the page → composer with the notice.
  await p.goto(`${BASE}/events/clip` + frag({ v: 1, title: 'Yoga im Park', url: 'https://example.org/yoga', text: 'Yoga im Park. Jeden Abend um 19 Uhr treffen wir uns. Bring eine Matte mit.', selection: '', hint: {} }));
  await p.waitForURL('**/events/create?**', { timeout: 45000 }); await p.waitForTimeout(1500);
  check('clipMiss=1 when no date', new URL(p.url()).searchParams.get('clipMiss') === '1', p.url().slice(-80));
  check('notice rendered', (await p.locator('[role="status"]').filter({ hasText: /Datum|date/i }).count()) === 1);
  await p.screenshot({ path: '/mnt/c/Users/atakee/Downloads/clipper-miss.png' });

  // 3. Empty fragment → honest failure text, no redirect.
  await p.goto(`${BASE}/events/clip`); await p.waitForTimeout(800);
  check('no payload → stays with a message and links', /Nichts empfangen/.test(await p.locator('#clip-msg').innerText()) && (await p.locator('#clip-fallback a').count()) === 2);
  check('no page errors', errs.length === 0, errs.join(' | '));
  await p.context().close();

  // 4. Member (non-admin) → bounced to /calendar.
  const m = await login('jonas@mahalle-dev.test');
  await m.goto(`${BASE}/events/clip` + frag({ v: 1, title: 'x', url: 'https://x.org', text: 'x', hint: {} }));
  await m.waitForTimeout(1500);
  check('non-admin bounced to /calendar', /\/calendar/.test(m.url()), m.url());
  await b.close(); console.log(fails ? `${fails} FAILED` : 'all green'); process.exit(fails ? 1 : 0);
})();
```

Run: `NODE_PATH=$(npm root -g)/@playwright/cli/node_modules node scratchpad/clipper-e2e-probe.cjs`
Expected: `all green` (11 checks). Screenshots `clipper-prefilled.png` and `clipper-miss.png` land in the user's Downloads (he reads screenshots there).

- [ ] **Step 6: Commit**

```bash
git add src/pages/events/clip.astro src/components/calendar/kiosk/compose/EventComposePageInner.svelte src/lib/kiosk-i18n.ts
git commit -m "clipper: /events/clip landing (admin) reads the fragment, asks the API, opens the prefilled composer; clipMiss notice"
```

---

### Task 5: Docs

**Files:**
- Modify: `src/components/calendar/kiosk/CLAUDE.md` (section „Compose URL prefill + Termin-Clipper", after the v2–v4 paragraph at ~line 95)
- Modify: root `CLAUDE.md` — NO change needed (the clipper is documented in the area file only); confirm by `grep -n "clipper" CLAUDE.md` returning nothing that contradicts v5.

- [ ] **Step 1: Add the v5 paragraph**

Append after the „Clipper v2–v4" paragraph:

```markdown
**Clipper v5 (2026-09-26, user: „why don't we add here an agent? … this event adder is just for me"):** the bookmarklet no longer builds the compose URL. Its SOURCE is a readable file, `src/lib/clipper/bookmarklet.js` (ES5, `// @ts-nocheck`, imported `?raw` by `/event-clipper` and injected via `define:vars`; `__ORIGIN__` replaced client-side). It collects title, URL, selection, the visible text of `main/article` (else body, capped 8 000 chars) and the v2–v4 markup hints, and opens **`/events/clip#<url-encoded JSON>`** — the fragment never reaches a server, has no practical length limit and needs no cross-origin fetch (a `fetch` from the foreign page would neither pass CORS nor carry the Lax session cookie). `/events/clip` (`src/pages/events/clip.astro`, middleware-gated + `role === 'admin'` check, non-admins → `/calendar`) reads the fragment, strips it with `history.replaceState`, POSTs it same-origin to **`POST /api/events/clip`** (`requireAdminSession`; Zod body caps text 12 000 / selection 3 000; `gpt-4o-mini`, temperature 0, strict `response_format` json_schema = `CLIP_JSON_SCHEMA`, 20 s timeout; server fetches NOTHING; nothing stored) and redirects to the unchanged `/events/create?title&body&location&from&to&startTime&endTime&allDay` prefill. Pure helpers + `node:test` suite: `src/lib/clipper/extract.ts` (`buildClipMessages` states Berlin's today + weekday so „Samstag"/„morgen" resolve; `normalizeClipResult` drops dates > 400 days away, times without a date, ends before starts; `mergeHint` lets the markup hints fill only what the model left empty; `toComposeParams` = the prefill contract). **Fail-safe:** OpenAI error/timeout/garbage ⇒ `200 { ok:false, reason }` + ONE static Sentry message `clipper: extraction failed` (reason in `extra`, flushed) ⇒ the page falls back to the markup hints ⇒ if those are empty too the composer opens with `?clipMiss=1` and shows `cal.compose.clip.miss` („Kein Datum erkannt — bitte Datum und Uhrzeit prüfen.", draft copy). Probes (scratchpad): `clipper-api-probe.cjs` (9 checks incl. 401/403/400), `clipper-bookmarklet-probe.cjs` (real served source in a fixture page, `window.open` stubbed), `clipper-e2e-probe.cjs` (admin lands prefilled; no-date → notice; empty fragment → honest message; member → bounced). ⚠ Still true: bookmarklets freeze at drag time — re-drag from `/event-clipper` after this ship. Cost ≈ 1 ct per clip on `gpt-4o-mini`.
```

- [ ] **Step 2: Commit**

```bash
git add src/components/calendar/kiosk/CLAUDE.md
git commit -m "docs: calendar area — Termin-Clipper v5 (LLM extraction, admin-only)"
```

---

## Self-review notes (done while writing)

- Coverage: transport (Task 3+4), endpoint (Task 2), extraction quality + honesty (Task 1+4), admin gating (Task 2 route guard, Task 4 page check, probes for 401/403 and the member bounce), docs (Task 5). Fail-safe and „nothing stored" are in Task 2's code, not just prose.
- Types: `ClipHint`, `ClipInput`, `NormalizedClip` defined in Task 1 and used by name in Tasks 2 and 4; `toComposeParams` signature identical in Task 1 tests and Task 4 script; the fragment payload shape is stated identically in Task 3 (producer) and Task 4 (consumer).
- Review Focus 1–5 each have a pinned test (Task 1 tests marked, Task 2 Zod caps + `bad_json` path, Task 3 text cap).
- Audit 00:15: the normaliser first kept the model's end time after correcting a nonsense end date (22:00 > 20:00 on the corrected day) while the test expected it dropped — code changed to drop both when `endDate < startDate`.
- Known limits, to state in the final report: (a) COOP-isolated pages are irrelevant here (no opener is used); (b) a logged-OUT admin loses the fragment across the login bounce (the `?redirect=` carries path + search only) — the clip page then says „Nichts empfangen", re-click; acceptable for a one-person tool; (c) the notice copy and the clipper page copy are drafts for the user to word.

## Audit record (00:15–00:55, done by the orchestrator against the code)
- Astro 5.15.1, Zod 3.25.76. `define:vars` exists; the bookmarklet probe now reads the served button's `href` instead of guessing the serialisation.
- `*?raw` is typed through `astro/client` → Vite client types; no declaration needed.
- `KioskLayout` takes `page` and `noindex` (lines 33/35). Tokens `--k-ochre`, `--k-ink-mute`, `--k-ink-soft` exist.
- `EventComposePageInner.svelte` computes initial values synchronously at line 138 (no `onMount`); store is `t` → `$t`; no `role="status"` on the page.
- `requireAdminSession` and `session.user.role` typing confirmed; Sentry import is `import * as Sentry from '@sentry/astro'`.
- Middleware: `/api/events/*` → 401 JSON, `/events/*` → 302; no origin check on same-origin JSON POSTs.
- The fetch-login recipe referenced by the API probe was wrong (file did not exist); replaced with the one in `scratchpad/e2e-admin-hint.mts`.
- OpenAI `json_schema` shape with `type: ['string','null']` in strict mode and `temperature: 0` — from knowledge of the API, not repo evidence; the API probe in Task 2 is the live check.
- Normaliser defect (end time kept after a nonsense end date) fixed in Task 1.
