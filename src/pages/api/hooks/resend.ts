// POST /api/hooks/resend — Resend webhook: a dead address / spam complaint switches the
// member's Kiez-Brief off (rules: src/lib/newsletter/bounceRules.ts). Public route, guarded by
// the Svix signature (RESEND_WEBHOOK_SECRET). Fail-closed: unset secret => 401.
// Never log the body (it carries addresses). A thrown DB error => 500, Resend retries (wanted);
// the writes are idempotent (the bounce stamp uses the event's own created_at).
import type { APIRoute } from 'astro';
import { Resend } from 'resend';
import { connectDB } from '../../../lib/mongodb';
import { decideBounceEvent } from '../../../lib/newsletter/bounceRules';
import { setOwnNewsletterMode } from '../../../lib/newsletter/preference';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const secret = import.meta.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return json(401, { error: 'not_configured' });

  const raw = await request.text();
  let event: unknown;
  try {
    // Verification is a local HMAC; the key is never used (the constructor only insists on one).
    const resend = new Resend(import.meta.env.RESEND_API_KEY || 're_webhook_verify_only');
    event = resend.webhooks.verify({
      payload: raw,
      headers: {
        id: request.headers.get('svix-id') ?? '',
        timestamp: request.headers.get('svix-timestamp') ?? '',
        signature: request.headers.get('svix-signature') ?? '',
      },
      webhookSecret: secret,
    });
  } catch {
    return json(401, { error: 'invalid_signature' });
  }

  const action = decideBounceEvent(event);
  if (action.kind === 'ignore') return json(200, { ok: true, action: 'ignore' });

  const db = await connectDB();
  const users = db.collection('users');
  let matched = 0;
  for (const addr of action.addresses) {
    const u = await users.findOne(
      { email: addr, anonymized: { $ne: true } },
      { collation: { locale: 'en', strength: 2 }, projection: { _id: 1 } },
    );
    if (!u) continue;
    matched++;
    const id = String(u._id);
    if (action.kind === 'bounce') {
      await users.updateOne({ _id: u._id }, { $set: { emailBounce: { at: action.at, type: action.type, subType: action.subType } } });
      await setOwnNewsletterMode(id, 'off', 'bounce');
    } else {
      await setOwnNewsletterMode(id, 'off', 'complaint');
    }
  }
  return json(200, { ok: true, action: action.kind, matched });
};
