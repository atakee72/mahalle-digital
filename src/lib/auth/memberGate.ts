// src/lib/auth/memberGate.ts
// PURE (no imports beyond a type). The decision logic of requireMemberSession()
// — kept dependency-free so it is unit-testable with `npx tsx --test`
// (auth-astro/server cannot be loaded outside Astro). The wiring with the real
// getSession + rejectIfBanned lives in src/lib/auth.ts.
import type { Session } from '@auth/core/types';

export type MemberGate =
  | { ok: true; userId: string; session: Session }
  | { ok: false; response: Response };

/** The exact body the 22 member routes wrote by hand before 2026-09-30. Do not reword. */
export const MEMBER_UNAUTHORIZED_BODY = { error: 'Unauthorized - Please login' } as const;

export function memberUnauthorizedResponse(): Response {
  return new Response(JSON.stringify(MEMBER_UNAUTHORIZED_BODY), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Session check, then live ban check, in that order — the order every
 * member write route used. `rejectIfBanned` is injected so this stays pure.
 * A session without `user.id` is refused (401) and never reaches the ban
 * check; the jwt/session callbacks always set the id, so this only guards
 * against a malformed token.
 */
export async function gateMember(
  session: Session | null,
  rejectIfBanned: (userId: string) => Promise<Response | null>
): Promise<MemberGate> {
  const userId = session?.user?.id;
  if (!userId) return { ok: false, response: memberUnauthorizedResponse() };
  const banned = await rejectIfBanned(userId);
  if (banned) return { ok: false, response: banned };
  return { ok: true, userId, session: session as Session };
}
