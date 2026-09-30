// src/lib/auth/banGuard.ts
// SERVER-ONLY (imports mongodb). Live ban checks for enforcement.
//
// Always reads the DB — never trust session.user for ban state. The JWT
// snapshots at login, but bans happen mid-session (3rd strike in the
// moderation queue), so a session flag would be stale exactly when it
// matters.
import { ObjectId } from 'mongodb';
import { connectDB } from '../mongodb';

export async function isUserBanned(userId: string): Promise<boolean> {
  if (!userId || !ObjectId.isValid(userId)) return false;
  const db = await connectDB();
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(userId) },
    { projection: { isBanned: 1 } }
  );
  return user?.isBanned === true;
}

/**
 * Write- and delete-endpoint guard. Call AFTER the session check. Most routes get it
 * through requireMemberSession() (src/lib/auth.ts); the hand-written form is
 *
 *   const bannedRes = await rejectIfBanned(session.user.id);
 *   if (bannedRes) return bannedRes;
 *
 * Returns a pre-shaped 403 when the user is banned, else null.
 * `error: 'account_banned'` is the machine-readable discriminator
 * clients may use to show the suspended state.
 */
export async function rejectIfBanned(userId: string): Promise<Response | null> {
  if (!(await isUserBanned(userId))) return null;
  return new Response(
    JSON.stringify({
      error: 'account_banned',
      message: 'Dein Konto ist gesperrt. Du kannst mitlesen, aber nichts mehr posten.',
    }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  );
}
