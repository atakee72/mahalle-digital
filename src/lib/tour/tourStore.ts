// Tour storage — localStorage mirror + server truth (users.tours / users.tourHelloDismissedAt).
// Pattern: same two-tier idea as the warning-label overlay. Timestamps (ISO strings
// client-side), never booleans — a future redesign can re-offer by cutoff date.
// Anonymous users live on localStorage alone; syncWithServer() POSTs local-only
// chapters up on the first logged-in visit (merge-at-registration, handoff §05).

export type ChapterKey = 'forum' | 'kalender' | 'markt' | 'kurier' | 'kiezdaten' | 'blog' | 'profil';

export interface TourState {
  tours: Partial<Record<ChapterKey, string>>; // ISO timestamps
  helloDismissedAt: string | null;
}

const LS_KEY = 'mahalle-tour-state';
const CHAPTER_KEYS: ChapterKey[] = ['forum', 'kalender', 'markt', 'kurier', 'kiezdaten', 'blog', 'profil'];

export function getLocalState(): TourState {
  if (typeof localStorage === 'undefined') return { tours: {}, helloDismissedAt: null };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { tours: {}, helloDismissedAt: null };
    const parsed = JSON.parse(raw);
    return {
      tours: typeof parsed?.tours === 'object' && parsed.tours ? parsed.tours : {},
      helloDismissedAt: typeof parsed?.helloDismissedAt === 'string' ? parsed.helloDismissedAt : null,
    };
  } catch {
    return { tours: {}, helloDismissedAt: null };
  }
}

function writeLocal(state: TourState): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* quota/privacy */ }
}

export function isChapterSeen(state: TourState, ch: ChapterKey): boolean {
  return typeof state.tours[ch] === 'string';
}

async function postSeen(body: { chapter?: ChapterKey; hello?: boolean }): Promise<void> {
  try {
    await fetch('/api/profile/tour', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch { /* best-effort — localStorage already has it */ }
}

export async function markChapterSeen(ch: ChapterKey, loggedIn: boolean): Promise<void> {
  const state = getLocalState();
  if (isChapterSeen(state, ch)) return; // restart never rewrites
  state.tours[ch] = new Date().toISOString();
  // BINDING: writeLocal must stay BEFORE the first await — TourController calls
  // `void markChapterSeen(...)` and reads getLocalState() on the next line,
  // relying on the local write landing synchronously.
  writeLocal(state);
  if (loggedIn) await postSeen({ chapter: ch });
}

export async function markHelloDismissed(loggedIn: boolean): Promise<void> {
  const state = getLocalState();
  if (state.helloDismissedAt) return;
  state.helloDismissedAt = new Date().toISOString();
  writeLocal(state);
  if (loggedIn) await postSeen({ hello: true });
}

// Merge server truth with local (union of "seen"); push local-only chapters up.
export async function syncWithServer(): Promise<TourState> {
  const local = getLocalState();
  try {
    const res = await fetch('/api/profile/tour');
    if (!res.ok) return local;
    const server = await res.json() as { tours?: Record<string, string>; tourHelloDismissedAt?: string | null };
    const merged: TourState = {
      tours: { ...local.tours },
      helloDismissedAt: local.helloDismissedAt ?? server.tourHelloDismissedAt ?? null,
    };
    for (const ch of CHAPTER_KEYS) {
      const s = server.tours?.[ch];
      if (s && !merged.tours[ch]) merged.tours[ch] = s;           // server → local
      if (!s && local.tours[ch]) void postSeen({ chapter: ch }); // local-only → server (anon merge)
    }
    if (local.helloDismissedAt && !server.tourHelloDismissedAt) void postSeen({ hello: true });
    writeLocal(merged);
    return merged;
  } catch {
    return local;
  }
}
