// src/lib/mentions/broadcast.ts — dependency-pure (server + islands).
// „@alle" (2026-09-22, admin-only broadcast): the SERVER strips the span
// „@alle -handle -handle" from the stored body and keeps it as
// `broadcast: { token, excludedHandles }` on the document, so no renderer
// ever shows it; the author's edit box restores it at the START of the text.
// Same boundary rule as @handle mentions and NO lookbehind (Safari < 16.4).
export const BROADCAST_HANDLE = 'alle';

export interface BroadcastRef {
  token: string;              // canonical „@alle -a -b" as stored
  excludedHandles: string[];  // lowercase, unique
  notifiedAt?: Date | string; // set once the notifications went out
  recipients?: number;        // how many were notified (for the admin's own eyes)
}

// group 1 = the character before „@" (or start); group 2 = the „-handle" run.
const SRC = `(^|[^\\p{L}\\p{N}_@./])@${BROADCAST_HANDLE}(?![a-z0-9_])((?: -[a-z0-9_]{3,20}(?![a-z0-9_]))*)`;

export function parseBroadcast(text: string): { body: string; token: string; excludedHandles: string[] } | null {
  const m = new RegExp(SRC, 'iu').exec(text);
  if (!m) return null;
  const at = (m.index ?? 0) + m[1].length;
  const rawRun = m[2] ?? '';
  const excludedHandles = [...new Set(rawRun.trim().split(/\s+/).filter(Boolean).map((t) => t.slice(1).toLowerCase()))];
  const token = excludedHandles.length ? `@${BROADCAST_HANDLE} ${excludedHandles.map((h) => '-' + h).join(' ')}` : `@${BROADCAST_HANDLE}`;
  const end = at + 1 + BROADCAST_HANDLE.length + rawRun.length;
  const body = (text.slice(0, at) + text.slice(end)).replace(/[ \t]{2,}/g, ' ').replace(/^ +| +$/g, '');
  return { body, token, excludedHandles };
}

export function restoreBroadcastText(body: string, broadcast?: Pick<BroadcastRef, 'token'> | null): string {
  if (!broadcast?.token) return body;
  return body ? `${broadcast.token} ${body}` : broadcast.token;
}
