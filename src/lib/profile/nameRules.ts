// src/lib/profile/nameRules.ts — dependency-pure (server routes + islands).
// ONE display-name rule for signup and profile edit (2026-09-21). Names may
// repeat — the handle is the identity; this file only keeps names readable
// and honest.

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 30;

/** Whitespace → one space, control + format characters (zero-width, RTL
 *  override, …) removed, NFC, trimmed. Accepted cost: the zero-width
 *  non-joiner some Persian names use is dropped as well. */
export function cleanDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim();
}

// First char letter/digit; last char letter/digit/mark/dot („Petra M.").
export const DISPLAY_NAME_REGEX = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._'’-]{0,28}[\p{L}\p{M}\p{N}.]$/u;

export function isValidDisplayName(name: string): boolean {
  return DISPLAY_NAME_REGEX.test(name);
}

// ─── Protected names ─────────────────────────────────────────────────
// Comparison form ONLY — never stored, never shown (UTS #39: skeletons are
// for comparing, not for normalising identifiers). A small hand-picked
// lookalike table instead of the 6,500-line Unicode confusables file: the
// threat here is „looks like the team" in a neighbourhood app, not IDN spoofing.
// Keys are written as escapes so no editor can swap a lookalike for its Latin twin.

const LOOKALIKES: Record<string, string> = {
  // Cyrillic а е о р с х у к м т н в і ј ѕ
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
  'к': 'k', 'м': 'm', 'т': 't', 'н': 'h', 'в': 'b', 'і': 'i', 'ј': 'j', 'ѕ': 's',
  // Greek α ο ρ ε ι κ ν τ υ χ
  'α': 'a', 'ο': 'o', 'ρ': 'p', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v',
  'τ': 't', 'υ': 'u', 'χ': 'x',
  // Latin specials NFKD does not decompose: ı ł ø
  'ı': 'i', 'ł': 'l', 'ø': 'o',
  // leetspeak
  '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's',
  // 1 / l / | / ! all read as „i" — both sides of every comparison are folded the same way
  '1': 'i', 'l': 'i', '|': 'i', '!': 'i',
};

export function foldForCompare(s: string): string {
  return Array.from(s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase())
    .map((c) => LOOKALIKES[c] ?? c)
    .join('');
}

const words = (folded: string) => folded.split(/[^a-z0-9]+/).filter(Boolean);
const squash = (folded: string) => folded.replace(/[^a-z0-9]+/g, '');

const ANYWHERE = ['mahalle'].map(foldForCompare);                                     // even spaced out
const WORD_PREFIX = ['admin', 'moderat', 'offiziel', 'official'].map(foldForCompare); // a word STARTS with it
const WHOLE_WORD = ['team', 'mod', 'support', 'system', 'redaktion', 'staff', 'betreiber'].map(foldForCompare);

export function isProtectedName(name: string): boolean {
  const f = foldForCompare(name);
  const flat = squash(f);
  if (ANYWHERE.some((t) => flat.includes(t))) return true;
  const ws = words(f);
  if (ws.some((w) => WORD_PREFIX.some((p) => w.startsWith(p)))) return true;
  return ws.some((w) => WHOLE_WORD.includes(w));
}

export function sameNameFolded(a: string, b: string): boolean {
  return squash(foldForCompare(a)) === squash(foldForCompare(b));
}
