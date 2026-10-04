/**
 * Admin member list: find a member by e-mail address (a bounce names an address, the list shows
 * none). Pure — the island and the route share it. The list payload never carries addresses: the
 * admin types part of an address and the server answers which members match.
 */

/** Shortest piece of an address worth a lookup (one or two letters match half the list). */
export const EMAIL_FRAGMENT_MIN = 3;

/**
 * The piece of an address to look up while the admin types, trimmed; null while it is too short,
 * has a space in it, or is a handle search („@name").
 */
export function emailFragment(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const q = v.trim();
  if (q.length < EMAIL_FRAGMENT_MIN || q.length > 254 || /\s/.test(q) || q.startsWith('@')) return null;
  return q;
}

/** The fragment as a literal for a regular expression: every special character escaped. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
