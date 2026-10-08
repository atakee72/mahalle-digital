// src/lib/invites/inviteRules.ts — dependency-pure (server routes AND islands import it).
// Personal invitation links (2026-10-07): every eligible member has ONE permanent code;
// a link carrying it opens /register with the inviter named, and the new account records
// who invited it. The code never expires — the cap does the throttling: at most
// INVITE_USES redemptions per rolling INVITE_WINDOW_DAYS. Mahalle never sends the
// invitation itself (the member shares the link from their own apps).

export const INVITE_USES = 5;
export const INVITE_WINDOW_DAYS = 30;
/** A member may invite once their address is confirmed AND the account is this old. */
export const INVITE_MIN_AGE_DAYS = 7;
export const INVITE_CODE_LEN = 10;
/** Lowercase letters and digits without the look-alikes (i l o 0 1) — the code is read off cards. */
export const INVITE_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** What the register page accepts: a lenient superset of the alphabet, fixed length. */
const CODE_REGEX = /^[a-z0-9]{10}$/;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Query/body input → code, or null. Trims and lowercases (links get retyped from cards). */
export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toLowerCase();
  return CODE_REGEX.test(code) ? code : null;
}

/** `bytes` → a code over INVITE_CODE_ALPHABET (one byte per character; the caller supplies randomness). */
export function codeFromBytes(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < INVITE_CODE_LEN; i++) {
    out += INVITE_CODE_ALPHABET[(bytes[i] ?? 0) % INVITE_CODE_ALPHABET.length];
  }
  return out;
}

export type InviterBlock = 'anonymized' | 'banned' | 'paused_all' | 'paused' | 'unverified' | 'too_new';

/**
 * The user-document fields the eligibility rule reads (createdAt is an ISO string on new
 * accounts, a Date on old ones). The index signature is load-bearing: without it TypeScript's
 * weak-type check refuses a MongoDB `WithId<Document>` (same as `UserFields` in memberType.ts).
 */
export type InviterFields = {
  emailVerified?: unknown;
  createdAt?: unknown;
  isBanned?: unknown;
  anonymized?: unknown;
  invitesPaused?: unknown;
  [k: string]: unknown;
};

export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** When a too-new account may start inviting; null when createdAt is unreadable (then it never unlocks by age — treated as too new). */
export function inviteUnlockAt(createdAt: unknown): Date | null {
  const d = toDate(createdAt);
  return d ? new Date(d.getTime() + INVITE_MIN_AGE_DAYS * DAY_MS) : null;
}

/**
 * Why this member may not invite right now — or null when they may. Order matters: the
 * strongest reason wins, so a banned member is told about the ban, not about a missing
 * confirmation. `pausedAll` is the global switch (env INVITES_PAUSED on the server).
 */
export function inviterBlock(user: InviterFields, now: Date, pausedAll = false): InviterBlock | null {
  if (user.anonymized === true) return 'anonymized';
  if (user.isBanned === true) return 'banned';
  if (pausedAll) return 'paused_all';
  if (user.invitesPaused === true) return 'paused';
  if (user.emailVerified !== true) return 'unverified';
  const unlock = inviteUnlockAt(user.createdAt);
  if (!unlock || unlock.getTime() > now.getTime()) return 'too_new';
  return null;
}

export type InviteBudget = { used: number; left: number; nextFreeAt: Date | null };

/** What GET /api/profile/invite answers — the profile card's whole data (ISO strings, JSON-ready). */
export type InviteState = {
  /** null while the member is blocked (nothing is minted for them). */
  code: string | null;
  url: string | null;
  qrSvg: string | null;
  block: InviterBlock | null;
  /** ISO — when a too-new account unlocks. */
  unlockAt: string | null;
  used: number;
  left: number;
  /** ISO — when the next redemption is possible again; null while something is left. */
  nextFreeAt: string | null;
  invitees: { name: string; handle: string | null; joinedAt: string }[];
};

/**
 * Redemptions inside the rolling window → what is left. `nextFreeAt` is set only when
 * nothing is left: the moment the member is back UNDER the cap (the redemption that
 * leaves the window first among the newest INVITE_USES; with exactly the cap, the oldest).
 * Unreadable dates are ignored (they cannot be inside the window).
 */
export function inviteBudget(redeemedAt: unknown[], now: Date): InviteBudget {
  const start = now.getTime() - INVITE_WINDOW_DAYS * DAY_MS;
  const inWindow = redeemedAt
    .map(toDate)
    .filter((d): d is Date => d !== null && d.getTime() > start && d.getTime() <= now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  const used = inWindow.length;
  const left = Math.max(0, INVITE_USES - used);
  const nextFreeAt = left === 0 && inWindow.length > 0
    ? new Date(inWindow[inWindow.length - INVITE_USES].getTime() + INVITE_WINDOW_DAYS * DAY_MS)
    : null;
  return { used: Math.min(used, INVITE_USES), left, nextFreeAt };
}

/** The link a member shares. `base` without a trailing slash (getTrustedBaseUrl's shape). */
export function inviteUrl(base: string, code: string): string {
  return `${base.replace(/\/+$/, '')}/register?invite=${code}`;
}

/**
 * A mailto: link that opens the member's OWN mail program with subject and body prefilled
 * (RFC 6068: CRLF line ends, everything percent-encoded; no recipient — their program's
 * address book does that better than a field of ours would, and we never see the address).
 */
export function inviteMailto(subject: string, body: string): string {
  const crlf = body.replace(/\r?\n/g, '\r\n');
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(crlf)}`;
}
