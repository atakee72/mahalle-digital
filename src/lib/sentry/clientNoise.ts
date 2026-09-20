/**
 * Browser-side Sentry noise that can never point at a real defect. Pure — the
 * client config's `beforeSend` calls it; unit-tested with the exact strings
 * from the prod board (2026-09-02 … 2026-09-20). Twin of the server config's
 * TRANSIENT_PATTERNS.
 *
 * Why these and nothing broader — every dropped kind is a CANCELLATION or a
 * framework fallback the member never sees:
 *  1. View-transition aborts: Astro's ClientRouter starts a page transition and
 *     the tab goes to the background / the link is tapped twice. The browser
 *     rejects with InvalidStateError ("Skipped ViewTransition…", "Transition
 *     was aborted because of invalid state… Document hidden") or AbortError;
 *     the navigation still completes.
 *  2. React's "This root received an early update, before anything was able
 *     hydrate" — it switches that root to client rendering and carries on.
 *  3. `null (reading 'body')` — ONLY when the frame is Astro's ClientRouter: a
 *     page that was open during a deploy fetches the next page from a build
 *     that is gone. From any other file the same message is a real bug.
 * An InvalidStateError that is NOT about transitions stays visible.
 */
const TRANSITION_NOISE = /view ?transition|transition was (aborted|skipped)|document (being )?hidden/i;
const REACT_EARLY_UPDATE = /this root received an early update, before anything was able (to )?hydrate/i;
const NULL_BODY = /cannot read properties of null \(reading 'body'\)/i;

export function isClientNoise(type: string | undefined, value: string | undefined, frameFiles: string[] = []): boolean {
  const t = type ?? '';
  const v = value ?? '';
  if (t === 'AbortError' || /^AbortError\b/.test(v)) return true;
  if ((t === 'InvalidStateError' || /InvalidStateError/.test(v)) && TRANSITION_NOISE.test(v)) return true;
  if (REACT_EARLY_UPDATE.test(v)) return true;
  if (NULL_BODY.test(v) && frameFiles.some((f) => /ClientRouter/i.test(f))) return true;
  return false;
}
