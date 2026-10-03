/**
 * Unsubscribe token: `base64url(userId).base64url(HMAC-SHA256(secret, 'kiez-brief:' + userId))`.
 * Stateless, no expiry (the link must work from a months-old mail); all it can do is turn the
 * mail off. SERVER-ONLY (node:crypto).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'kiez-brief:';

/** The HMAC secret: the Auth.js secret (NEXTAUTH_SECRET, JWT_SECRET as its fallback — the same pair auth.config.ts reads). */
export function unsubSecret(): string {
  return import.meta.env.NEXTAUTH_SECRET || import.meta.env.JWT_SECRET || '';
}

function sig(userId: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(PREFIX + userId).digest();
}

export function makeUnsubToken(userId: string, secret: string): string {
  if (!userId || !secret) throw new Error('unsub token needs a user id and a secret');
  return `${Buffer.from(userId, 'utf8').toString('base64url')}.${sig(userId, secret).toString('base64url')}`;
}

/** The user id the token stands for, or null for anything that is not a valid token. */
export function verifyUnsubToken(token: unknown, secret: string): string | null {
  if (typeof token !== 'string' || !secret) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  let userId: string;
  let given: Buffer;
  try {
    userId = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
    given = Buffer.from(token.slice(dot + 1), 'base64url');
  } catch {
    return null;
  }
  if (!/^[a-f0-9]{24}$/.test(userId)) return null;
  const expected = sig(userId, secret);
  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? userId : null;
}
