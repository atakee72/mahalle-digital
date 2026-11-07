// src/lib/translation/translateAccess.ts
// Pure, dependency-free: who may call POST /api/translate for what, and under
// which rate-limit keys. Members translate every content type under their own
// hourly key. A VISITOR (no session) may translate BLOG posts only (2026-11-07):
// the Beilage is public and indexable, so a reader from a search engine should
// get the same „Übersetzung anzeigen" as a member. Two brakes protect the DeepL
// quota: a per-IP-hash hourly key, and ONE shared daily budget for visitor
// translations that actually call DeepL (cache misses) — cached translations
// are served regardless. Forum, calendar, market and news stay members-only.
export const MEMBER_MAX_PER_HOUR = 30;
export const VISITOR_IP_MAX_PER_HOUR = 10;
/** DeepL calls (cache misses) all visitors together may cause per UTC day. */
export const VISITOR_FRESH_MAX_PER_DAY = 10;
export const VISITOR_FRESH_KEY = 'tr:anon:fresh';
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export type TranslateAccess =
  | { kind: 'refused' }
  | { kind: 'member'; key: string }
  | { kind: 'visitor'; ipKey: string; freshKey: typeof VISITOR_FRESH_KEY };

export function decideTranslateAccess(input: {
  userId: string | null | undefined;
  contentType: string;
  ipHash: string;
}): TranslateAccess {
  if (input.userId) return { kind: 'member', key: `tr:${input.userId}` };
  if (input.contentType === 'blog') {
    return { kind: 'visitor', ipKey: `tr:anon:ip:${input.ipHash}`, freshKey: VISITOR_FRESH_KEY };
  }
  return { kind: 'refused' };
}
