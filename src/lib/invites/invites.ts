// src/lib/invites/invites.ts — SERVER-ONLY (mongodb, qrcode, import.meta.env). The store behind
// a member's personal invitation link: minting and renewing the code, the member's view of it
// (budget, QR, who joined through it) and the register page's check of a code.
// Rules are the pure src/lib/invites/inviteRules.ts; the register route records a redemption by
// writing `invitedBy` (the inviter's raw _id) + `invitedAt` on the NEW user document — that
// document is the only record of a redemption, so the invite tree and the budget read the same rows.
import { randomBytes } from 'crypto';
import { ObjectId, type Db } from 'mongodb';
import QRCode from 'qrcode';
import {
  codeFromBytes, inviteBudget, inviteUnlockAt, inviterBlock, inviteUrl, normalizeInviteCode,
  type InviteState,
} from './inviteRules';
export type { InviteState } from './inviteRules';

/** Global switch: env INVITES_PAUSED=1 (Vercel injects env at deploy time, so flipping it is a redeploy). */
export function invitesPausedAll(): boolean {
  return import.meta.env.INVITES_PAUSED === '1';
}

const INVITER_PROJECTION = { inviteCode: 1, emailVerified: 1, createdAt: 1, isBanned: 1, anonymized: 1, invitesPaused: 1 } as const;

function idFilter(userId: string): unknown {
  // Dev fixtures carry string _ids; prod has ObjectIds. Match either shape.
  return ObjectId.isValid(userId) ? { $in: [new ObjectId(userId), userId] } : userId;
}

async function mintCode(db: Db, _id: unknown): Promise<string | null> {
  // Up to 5 tries: a collision on the partial unique index (astronomically rare at 10 characters
  // over 31 symbols) just rolls again. The `$exists: false` guard keeps a parallel request from
  // overwriting a code minted a moment earlier — then the re-read below returns that one.
  for (let i = 0; i < 5; i++) {
    const code = codeFromBytes(randomBytes(10));
    try {
      const r = await db.collection('users').updateOne({ _id: _id as any, inviteCode: { $exists: false } }, { $set: { inviteCode: code } });
      if (r.matchedCount === 0) {
        const again = await db.collection('users').findOne({ _id: _id as any }, { projection: { inviteCode: 1 } });
        return typeof again?.inviteCode === 'string' ? again.inviteCode : null;
      }
      return code;
    } catch (e: any) {
      if (e?.code !== 11000) throw e;
    }
  }
  return null;
}

async function redemptionsOf(db: Db, inviterId: unknown) {
  // Tombstones lose `invitedBy` (the deletion pipeline unsets it), so a deleted invitee frees
  // the budget slot — accepted: the row that recorded the redemption is gone with the member.
  return db.collection('users')
    .find({ invitedBy: inviterId as any }, { projection: { name: 1, handle: 1, invitedAt: 1, anonymized: 1 } })
    .sort({ invitedAt: -1 })
    .limit(200)
    .toArray();
}

/** The member's own view. Mints the code on first eligible read. null = no such member. */
export async function getInviteState(db: Db, userId: string, base: string, now = new Date()): Promise<InviteState | null> {
  const user = await db.collection('users').findOne({ _id: idFilter(userId) as any }, { projection: INVITER_PROJECTION });
  if (!user) return null;
  const block = inviterBlock(user, now, invitesPausedAll());
  const rows = await redemptionsOf(db, user._id);
  const budget = inviteBudget(rows.map((r) => r.invitedAt), now);
  let code: string | null = null;
  if (!block) {
    code = typeof user.inviteCode === 'string' ? user.inviteCode : await mintCode(db, user._id);
  }
  const url = code ? inviteUrl(base, code) : null;
  let qrSvg: string | null = null;
  if (url) {
    // Same recipe as the Steckbrief card; the input is OUR url built from the trusted base and a
    // code of our own alphabet — never request input.
    try {
      qrSvg = await QRCode.toString(url, { type: 'svg', margin: 0, color: { dark: '#1b1a17', light: '#0000' } });
    } catch {
      qrSvg = null;
    }
  }
  return {
    code,
    url,
    qrSvg,
    block,
    unlockAt: block === 'too_new' ? inviteUnlockAt(user.createdAt)?.toISOString() ?? null : null,
    used: budget.used,
    left: budget.left,
    nextFreeAt: budget.nextFreeAt?.toISOString() ?? null,
    invitees: rows
      .filter((r) => r.anonymized !== true)
      .map((r) => ({
        name: typeof r.name === 'string' ? r.name : '',
        handle: typeof r.handle === 'string' ? r.handle : null,
        joinedAt: r.invitedAt instanceof Date ? r.invitedAt.toISOString() : String(r.invitedAt ?? ''),
      })),
  };
}

/** A new code for the member; the old one stops working at once. null when blocked or unknown. */
export async function regenerateInviteCode(db: Db, userId: string, now = new Date()): Promise<string | null> {
  const user = await db.collection('users').findOne({ _id: idFilter(userId) as any }, { projection: INVITER_PROJECTION });
  if (!user || inviterBlock(user, now, invitesPausedAll())) return null;
  for (let i = 0; i < 5; i++) {
    const code = codeFromBytes(randomBytes(10));
    try {
      await db.collection('users').updateOne({ _id: user._id }, { $set: { inviteCode: code } });
      return code;
    } catch (e: any) {
      if (e?.code !== 11000) throw e;
    }
  }
  return null;
}

export type ResolvedInvite =
  | { ok: true; inviter: { _id: unknown; name: string; handle: string | null } }
  | { ok: false; reason: 'invalid' | 'blocked' | 'exhausted' };

/** The register page / route asks: may this code still be used, and by whom was it issued? */
export async function resolveInvite(db: Db, rawCode: unknown, now = new Date()): Promise<ResolvedInvite> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return { ok: false, reason: 'invalid' };
  const inviter = await db.collection('users').findOne(
    { inviteCode: code },
    { projection: { ...INVITER_PROJECTION, name: 1, handle: 1 } },
  );
  if (!inviter) return { ok: false, reason: 'invalid' };
  if (inviterBlock(inviter, now, invitesPausedAll())) return { ok: false, reason: 'blocked' };
  const rows = await redemptionsOf(db, inviter._id);
  if (inviteBudget(rows.map((r) => r.invitedAt), now).left === 0) return { ok: false, reason: 'exhausted' };
  return {
    ok: true,
    inviter: {
      _id: inviter._id,
      name: typeof inviter.name === 'string' ? inviter.name : '',
      handle: typeof inviter.handle === 'string' ? inviter.handle : null,
    },
  };
}
