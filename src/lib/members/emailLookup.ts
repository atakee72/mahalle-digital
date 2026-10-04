/**
 * Admin member list: find a member by e-mail address (a bounce names an address, the list shows
 * none). Pure — the island and the route share it. The list payload never carries addresses: the
 * admin types the WHOLE address and the server answers which member it is.
 */

/** The search text is meant as an address: an „@" that is not the first character („@handle" is the handle search). */
export function isEmailQuery(q: string): boolean {
  return q.trim().indexOf('@') > 0;
}

/** The address to look up, trimmed; null while it is not a whole address yet. */
export function lookupEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const email = v.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}
