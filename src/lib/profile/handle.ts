// src/lib/profile/handle.ts
// PURE module — imported by server code AND scripts. Never import DB here.
import { isProtectedName } from './nameRules';

export const HANDLE_REGEX = /^[a-z0-9_]{3,20}$/;
export const HANDLE_FALLBACK = 'nachbar';

/** Chars NFD can't decompose. German ö/ü/ä decompose to o/u/a via NFD —
 *  deliberately NOT oe/ue/ae, to keep one rule for Turkish + German names. */
const MANUAL_MAP: Record<string, string> = {
  ß: 'ss', ı: 'i', ø: 'o', æ: 'ae', œ: 'oe', đ: 'd', ł: 'l', þ: 'th',
};

/** "Emre Aydın" -> "emre_aydin". Deterministic; caller handles collisions. */
export function slugifyHandle(name: string): string {
  let s = name
    .toLowerCase()
    .replace(/[ßıøæœđłþ]/g, (c) => MANUAL_MAP[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics (escaped range — do not paste literal combining chars)
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (s.length > 20) s = s.slice(0, 20).replace(/_$/, '');
  if (s.length < 3) s = HANDLE_FALLBACK; // suffixing at the caller keeps it unique
  return s;
}

// ─── Handle choice at signup (2026-09-21) ────────────────────────────
// New members may pick their handle ONCE, at signup; without a choice the
// automatic slug above applies. Existing handles never change in this version.

// Words a handle must never be: they read as a place in the app or as a group mention.
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'alle', 'all', 'everyone', 'here', 'channel', 'kiez', 'nachbarn', 'nachbarschaft',
  'schillerkiez', 'forum', 'kurier', 'markt', 'kalender', 'profil', 'profile', 'login', 'register',
]);

/** What the member typed → candidate handle. One leading „@" is tolerated. */
export function normalizeChosenHandle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim().toLowerCase();
  return s.startsWith('@') ? s.slice(1) : s;
}

export function chosenHandleProblem(handle: string): 'format' | 'reserved' | null {
  if (!HANDLE_REGEX.test(handle)) return 'format';
  if (RESERVED_HANDLES.has(handle)) return 'reserved';
  // „mahalle_team", „adm1n" … — the same team-lookalike logic as for display names.
  if (isProtectedName(handle.replace(/_/g, ' ')) || isProtectedName(handle)) return 'reserved';
  return null;
}
