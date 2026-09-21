// src/lib/mentions/mentions.ts — dependency-pure (server + islands).
// „@handle" in forum posts and comments (2026-09-21). Resolution to a member
// happens on the server when the text is SAVED (mentionsStore.ts); this file
// only finds tokens, splits text for rendering and helps the autocomplete.
//
// NO regex lookbehind here: Safari < 16.4 rejects it at parse time and the
// importing island would never mount. The character BEFORE „@" is matched as
// group 1 instead.

export const MAX_MENTIONS = 10;

export interface MentionRef { handle: string; userId: string }
export interface MentionSegment { type: 'text' | 'mention'; value: string; userId?: string }

// „@" must not follow a letter, digit, „_", „@", „." or „/" (e-mail, URL path, „@@").
const MENTION_SRC = '(^|[^\\p{L}\\p{N}_@./])@([a-z0-9_]{3,20})(?![a-z0-9_])';
const mentionRe = () => new RegExp(MENTION_SRC, 'giu');

/** Unique, lowercase, in order of appearance, capped. */
export function extractMentionHandles(text: string, max = MAX_MENTIONS): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(mentionRe())) {
    const h = m[2].toLowerCase();
    if (!out.includes(h)) out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

/** Only handles the SERVER resolved become mention segments; everything else stays text. */
export function splitMentions(text: string, mentions: readonly MentionRef[]): MentionSegment[] {
  if (mentions.length === 0) return [{ type: 'text', value: text }];
  const byHandle = new Map(mentions.map((m) => [m.handle, m.userId]));
  const segs: MentionSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(mentionRe())) {
    const handle = m[2].toLowerCase();
    const userId = byHandle.get(handle);
    if (!userId) continue;
    const at = (m.index ?? 0) + m[1].length; // position of „@"
    if (at > last) segs.push({ type: 'text', value: text.slice(last, at) });
    segs.push({ type: 'mention', value: handle, userId });
    last = at + 1 + m[2].length;
  }
  if (last < text.length) segs.push({ type: 'text', value: text.slice(last) });
  return segs;
}

/** The „@token" directly left of the caret, or null. `query` may be ''. */
export function activeMentionQuery(value: string, caret: number): { start: number; query: string } | null {
  const left = value.slice(0, caret);
  const at = left.lastIndexOf('@');
  if (at < 0) return null;
  const query = left.slice(at + 1);
  if (!/^[a-z0-9_]{0,20}$/i.test(query)) return null;
  if (at > 0 && /[\p{L}\p{N}_@./]/u.test(left[at - 1])) return null;
  return { start: at, query: query.toLowerCase() };
}

/** Replaces the token with „@handle" and leaves exactly one space after it. */
export function applyMention(value: string, start: number, caret: number, handle: string): { value: string; caret: number } {
  const before = value.slice(0, start);
  const after = value.slice(caret);
  const insert = `@${handle}`;
  const spacer = after.startsWith(' ') ? '' : ' ';
  return { value: before + insert + spacer + after, caret: before.length + insert.length + 1 };
}
