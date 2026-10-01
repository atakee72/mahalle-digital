// SERVER-ONLY: imports banGuard → mongodb. Never import from a client island
// or a shared (page + component) module — see CLAUDE.md „Server-only modules".
import { getSession } from 'auth-astro/server';
import { rejectIfBanned } from './auth/banGuard';
import { gateMember, type MemberGate } from './auth/memberGate';

/**
 * Admin guard for API endpoints. Returns either a usable session
 * (admin role confirmed) or a Response object the caller should
 * return immediately.
 *
 * Usage:
 *   const guard = await requireAdminSession(request);
 *   if (!guard.ok) return guard.response;
 *   // ...guard.userId is set
 *
 * Why a tagged-union return instead of throwing: keeps endpoint
 * handlers as plain async functions without try/catch noise, and the
 * Response is already pre-shaped with the right status code +
 * JSON body.
 */
export async function requireAdminSession(
  request: Request
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const session = await getSession(request);
  if (!session?.user?.id) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    };
  }
  if (session.user.role !== 'admin') {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      })
    };
  }
  return { ok: true, userId: session.user.id };
}

/**
 * Member guard for write endpoints: session, then LIVE ban check
 * (`rejectIfBanned`, reads the DB — the JWT snapshots at login and a ban
 * happens mid-session). Same tagged-union shape as requireAdminSession.
 *
 * Usage:
 *   const gate = await requireMemberSession(request);
 *   if (!gate.ok) return gate.response;
 *   const { session, userId } = gate;
 *
 * 401 body is exactly `{ error: 'Unauthorized - Please login' }` (the text
 * the routes used before 2026-09-30); 403 is rejectIfBanned's own response.
 * Routes that check a path id BEFORE the session keep doing so — call this
 * after that check. Decision logic + tests: src/lib/auth/memberGate.ts.
 */
export async function requireMemberSession(request: Request): Promise<MemberGate> {
  return gateMember(await getSession(request), rejectIfBanned);
}
