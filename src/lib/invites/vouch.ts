// src/lib/invites/vouch.ts — SERVER-ONLY. Kiez-verification by vouch: the badge for an invited
// member whose inviter carries it, granted on the FIRST confirmation of the member's address.
import type { Db, Document } from 'mongodb';
import * as Sentry from '@sentry/astro';
import { vouchGrants } from './inviteRules';
import { alertMemberVouched } from '../adminAlerts';

/**
 * `before` = the invitee's user document as it was BEFORE emailVerified was set (both confirm
 * functions have it). Call ONLY when before.emailVerified !== true (first transition).
 * Never throws: a failure here must not fail the confirmation (Sentry capture + flush).
 * Returns true when the badge was written.
 */
export async function grantVouchedBadge(db: Db, before: Document): Promise<boolean> {
  if (before.invitedBy === null || before.invitedBy === undefined) return false;
  try {
    const users = db.collection('users');
    const inviter = await users.findOne(
      { _id: before.invitedBy },
      { projection: { name: 1, handle: 1, verified: 1, isBanned: 1, anonymized: 1 } },
    );
    if (!inviter || !vouchGrants(before, inviter)) return false;
    const res = await users.updateOne(
      { _id: before._id, verified: { $ne: true } },
      { $set: { verified: true, vouchedBy: inviter._id, vouchedAt: new Date() } },
    );
    if (res.modifiedCount === 0) return false;
    await alertMemberVouched({
      name: typeof before.name === 'string' ? before.name : '',
      handle: typeof before.handle === 'string' ? before.handle : null,
      inviterName: typeof inviter.name === 'string' ? inviter.name : '',
      inviterHandle: typeof inviter.handle === 'string' ? inviter.handle : null,
    });
    return true;
  } catch (err) {
    Sentry.captureException(err);
    await Sentry.flush(2000);
    return false;
  }
}
