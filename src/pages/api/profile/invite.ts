import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { ObjectId } from 'mongodb';
import { requireMemberSession } from '../../../lib/auth';
import { connectDB } from '../../../lib/mongodb';
import { getTrustedBaseUrl } from '../../../lib/auth/baseUrl';
import { consumeRateLimit } from '../../../lib/auth/rateLimit';
import { getInviteState, regenerateInviteCode } from '../../../lib/invites/invites';

// The member's personal invitation link (2026-10-07): GET = the card's data (mints the code on
// the first eligible read), POST { action: 'regenerate' } = a new code, the old one dies at once.
// GET is session-gated only: a banned member must READ why the card is empty (`block: 'banned'`
// from the rule — the store never mints for them); the live ban check on the POST keeps a banned
// member from writing anything.

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  const userId = session?.user?.id;
  if (!userId || !ObjectId.isValid(userId)) return json({ error: 'Unauthorized' }, 401);
  const base = getTrustedBaseUrl(request);
  if (!base) return json({ error: 'base_url_unavailable' }, 503);
  const db = await connectDB();
  const state = await getInviteState(db, userId, base);
  if (!state) return json({ error: 'Not found' }, 404);
  return json(state);
};

export const POST: APIRoute = async ({ request }) => {
  const gate = await requireMemberSession(request);
  if (!gate.ok) return gate.response;
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!body || typeof body !== 'object' || (body as { action?: unknown }).action !== 'regenerate') {
    return json({ error: 'Invalid action' }, 400);
  }
  // Five renewals an hour: a renewal kills a link people may hold, and a loop of them is abuse.
  const limit = await consumeRateLimit(`invitecode:${gate.userId}`, 5, 60 * 60 * 1000);
  if (limit.limited) return json({ error: 'rate_limited', retryAfterSec: limit.retryAfterSec }, 429);
  const base = getTrustedBaseUrl(request);
  if (!base) return json({ error: 'base_url_unavailable' }, 503);
  const db = await connectDB();
  const code = await regenerateInviteCode(db, gate.userId);
  if (!code) return json({ error: 'not_allowed' }, 403);
  const state = await getInviteState(db, gate.userId, base);
  return json(state);
};
