// src/lib/auth/emailChange.ts
// SERVER-ONLY (mongodb + crypto). Never import from a client/.svelte file.
//
// Email-change tokens are stored ONLY as sha256(rawToken) — the raw token
// lives solely in the emailed link. Single-use is enforced by an atomic
// findOneAndUpdate claim. Mirrors src/lib/auth/emailVerify.ts (same
// collection shape, plus a `newEmail` field carried on the token doc so the
// sessionless confirm endpoint knows what to swap to).
import { randomBytes, createHash } from 'crypto';
import { ObjectId } from 'mongodb';
import { connectDB } from '../mongodb';

const TOKEN_TTL_MS = 30 * 60 * 1000;  // 30 minutes per design
const RESEND_GUARD_MS = 60 * 1000;           // at most one new token per user per 60s

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Issue a single-use email-change token for a user, carrying the target
 * `newEmail`. Invalidates the user's prior unused tokens (latest-wins).
 * Returns the RAW token to embed in the link, or null if a fresh unused
 * token was issued <60s ago (resend guard).
 */
export async function createEmailChangeToken(userId: string, newEmail: string): Promise<string | null> {
  const db = await connectDB();
  const col = db.collection('emailChangeTokens');
  const uid = new ObjectId(userId);
  const now = Date.now();

  const recent = await col.findOne({
    userId: uid,
    usedAt: null,
    createdAt: { $gte: new Date(now - RESEND_GUARD_MS) },
  });
  if (recent) return null;

  await col.deleteMany({ userId: uid, usedAt: null });

  const raw = randomBytes(32).toString('hex');
  await col.insertOne({
    tokenHash: hashToken(raw),
    userId: uid,
    newEmail,
    expiresAt: new Date(now + TOKEN_TTL_MS),
    usedAt: null,
    createdAt: new Date(now),
  });
  return raw;
}

/**
 * Atomically claim the token (single-use), re-verify the target email is
 * still unique (a THIRD party may have registered it after the change was
 * started but before it was confirmed), then swap the user's email.
 *
 * Returns:
 *  - 'ok'          — email swapped, emailVerified set, pendingEmail cleared.
 *  - 'invalid'     — token missing/expired/already used.
 *  - 'email_taken' — token was valid but the target email is no longer free.
 *    The claim is NOT rolled back (token stays burnt) and pendingEmail is
 *    left in place — the sessionless confirm endpoint must not distinguish
 *    this from 'invalid' externally (no oracle), but the caller's own
 *    profile view can still show the stuck pendingEmail so they can cancel.
 *
 * 'ok' carries the swapped-to `email` — the sessionless confirm page (Task 8)
 * has no session and no other way to know which address just went live, and
 * the design requires showing it ("Login now uses {addr}."). Not a new
 * information leak: the caller already had to possess the correct 256-bit
 * token (delivered only to the new address's inbox) to reach this branch.
 */
export async function confirmEmailChange(
  rawToken: string
): Promise<{ status: 'ok'; email: string } | { status: 'invalid' } | { status: 'email_taken' }> {
  if (!rawToken) return { status: 'invalid' };
  const db = await connectDB();
  const tokens = db.collection('emailChangeTokens');

  // Atomic claim: only succeeds if the token is still unused + unexpired.
  const claimed = await tokens.findOneAndUpdate(
    { tokenHash: hashToken(rawToken), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } }
  );
  if (!claimed) return { status: 'invalid' };

  const userId = claimed.userId as ObjectId;
  const newEmail = String(claimed.newEmail ?? '');

  // Re-check uniqueness at consume time (same collation as the start-time
  // check), excluding the token owner themselves.
  const takenBySomeoneElse = await db.collection('users').findOne(
    { email: newEmail, _id: { $ne: userId } },
    { collation: { locale: 'en', strength: 2 } }
  );
  if (takenBySomeoneElse) return { status: 'email_taken' };

  try {
    await db.collection('users').updateOne(
      { _id: userId },
      {
        $set: { email: newEmail, emailVerified: true, updatedAt: new Date().toISOString() },
        $unset: { pendingEmail: '' },
      }
    );
  } catch (err: any) {
    // A duplicate-key violation means users_email_unique caught a race the
    // findOne above lost (someone took the address in between). That is the
    // 'email_taken' case, NOT a transient write failure — so return it BEFORE
    // the rollback below: the documented contract for 'email_taken' is that
    // the claim stays burnt. Rolling back here instead would leave the token
    // live, and the user would re-click a link that re-hits the same 11000
    // forever. Externally indistinguishable from 'invalid' either way (the
    // confirm endpoint deliberately maps both to one generic 400 so there is
    // no enumeration oracle); this is about burning the token correctly.
    if (err?.code === 11000) return { status: 'email_taken' };

    // The user write failed AFTER the token was claimed — roll the claim back
    // so the link stays usable and the change isn't lost.
    await tokens.updateOne({ _id: (claimed as any)._id }, { $set: { usedAt: null } })
      .catch((rollbackErr) => {
        console.error('confirmEmailChange: rollback ALSO failed — token may be permanently burnt:', rollbackErr);
      });
    console.error('confirmEmailChange: user write failed, rolled back claim:', err);
    return { status: 'invalid' };
  }

  // Email is already swapped — clear any other unused tokens for this user.
  // Best-effort + POST-success: a failure here must NOT undo the change.
  await tokens.deleteMany({ userId, usedAt: null })
    .catch((cleanupErr) => {
      console.error('confirmEmailChange: sibling-token cleanup failed (change still succeeded):', cleanupErr);
    });
  return { status: 'ok', email: newEmail };
}

/** Cancel a pending email change: drop all tokens for the user + clear pendingEmail. Idempotent. */
export async function cancelEmailChange(userId: string): Promise<void> {
  const db = await connectDB();
  const uid = new ObjectId(userId);
  await db.collection('emailChangeTokens').deleteMany({ userId: uid });
  await db.collection('users').updateOne({ _id: uid }, { $unset: { pendingEmail: '' } });
}
