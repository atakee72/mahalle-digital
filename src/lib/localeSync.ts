/**
 * Tells the server which app language a logged-in member uses (users.locale), so mail sent
 * without a browser can speak it. Called by the nav on load and on every toggle; one request per
 * browser session and value (sessionStorage), fire-and-forget, a 401 or a network error is
 * ignored. DEPENDENCY-PURE: imported by an island.
 */
const key = (userId: string) => `mahalle:locale-synced:${userId}`;

export function syncLocale(locale: string, userId: string | null | undefined): void {
  if (typeof window === 'undefined' || !userId) return;
  if (window.top !== window.self) return; // Astro's dev preload iframe is not the member
  try {
    if (sessionStorage.getItem(key(userId)) === locale) return;
  } catch {
    /* private mode: just send */
  }
  fetch('/api/profile/locale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale }),
  })
    .then((r) => {
      // Always read the body: an unread response keeps the request open (and a page's network
      // never goes idle — found by the browser probe).
      void r.text().catch(() => {});
      if (!r.ok) return;
      try { sessionStorage.setItem(key(userId), locale); } catch { /* ignore */ }
    })
    .catch(() => {});
}
