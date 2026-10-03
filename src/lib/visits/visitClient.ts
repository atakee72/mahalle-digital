/**
 * Client side of „new since your last visit". An index island calls markVisit() once on
 * mount; the cards read `visitState` through NewMark.svelte. One module instance is shared
 * by all islands of a page (like the kiosk-i18n stores).
 */
import { writable } from 'svelte/store';
import { parseBaseline, pickBaseline, type VisitSection } from './visitRules';

export interface VisitState {
  me: string | null;
  since: Partial<Record<VisitSection, string | null>>;
}

export const visitState = writable<VisitState>({ me: null, since: {} });

const storageKey = (section: VisitSection) => `mahalle:visit:${section}`;

function readStored(section: VisitSection) {
  try { return parseBaseline(sessionStorage.getItem(storageKey(section))); } catch { return null; }
}

/** Stamp the visit on the server and publish this visit's baseline. Never throws. */
export async function markVisit(section: VisitSection, me: string | null): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!me) return; // logged out: no visit, no markers
  // Astro's dev server preloads client:only pages in a hidden iframe — that is not a visit.
  if (window.top !== window.self) return;
  const publish = (since: string | null) =>
    visitState.update((s) => ({ me, since: { ...s.since, [section]: since } }));

  // A running visit shows its markers at once, before the request returns.
  const stored = readStored(section);
  const running = stored ? pickBaseline(stored, null, Date.now(), me) : null;
  if (stored && running === stored) publish(stored.since);

  try {
    const res = await fetch('/api/profile/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section }),
    });
    if (!res.ok) return; // logged out (401) or a hiccup: no markers, nothing stored
    const data = (await res.json()) as { previous?: string | null };
    const baseline = pickBaseline(stored, data.previous ?? null, Date.now(), me);
    try { sessionStorage.setItem(storageKey(section), JSON.stringify(baseline)); } catch { /* private mode */ }
    publish(baseline.since);
  } catch {
    /* offline: keep whatever is shown */
  }
}
