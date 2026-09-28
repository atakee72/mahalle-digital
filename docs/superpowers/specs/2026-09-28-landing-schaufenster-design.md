# Landing „Das Schaufenster" — live section frames (design spec)

**Date:** 2026-09-28 · **Status:** implemented on branch feat/landing-schaufenster (2026-09-29), owner's copy pending · **Surface:** `/` (public landing, `src/components/landing/LandingPage.svelte`, `src/pages/index.astro`, `src/lib/landing.ts`)

## 1. Why

A visitor said the landing „looks so serious it looks like a political website". On a phone the page is a wall of type: two election guest posts first, a black strip, a big number, no picture of the app, none of the six section colours. Nothing shows what a member gets.

Goal: the first screen shows the app itself — six phone-shaped frames, one per main section, each drawn LIVE from today's content in its own section colour, in a strip that scrolls sideways by itself and by hand. Warm, colourful, real, and not commercial: no pricing feel, no „Jetzt anmelden" banner, no testimonials, no stock photos, one quiet call to action.

Decision record: three directions were drawn on the canvas https://claude.ai/artifact/BMWsBxuY6EKN2VrsGKNzMm (strip of screenshots · newsstand of live cards · both). The owner chose the strip with LIVE content inside the frames (2026-09-28 21:07).

## 2. Non-goals

- No change to who can read what: the app stays members-only, the landing stays the only public page (plus blog, Kiez-Daten, legal pages). No content wall, no blurred previews.
- No new backend endpoint. The landing keeps reading `getLandingData()` lib-direct, cached one hour.
- No JavaScript carousel library. No CSS `filter` on page-tall layers (see the ribbons incident).
- Phase 1 only: the strip and the page around it. Newsstand cards below the strip (canvas direction 2) are a later step if wanted.

## 3. Page structure

Phone first (390 px), then desktop (≥1024 px). Top to bottom:

1. **Date line** as today (date · Anmelden → · DE | EN).
2. **Wordmark + manifest line** as today.
3. **Double rule** as today.
4. **Schaufenster header line** (mono, 10 px): left `DAS SCHAUFENSTER · SECHS RÄUME`, right `WISCHEN →` (phone) / `ZIEHEN ZUM BLÄTTERN` (desktop). DRAFT copy.
5. **The strip** (section 4).
6. **Dots row**: six dots in the section colours; the active frame's dot is elongated. Decorative (`aria-hidden`).
7. **Heartbeat strip** (ink band) exactly as today: same rows, same zero rule, same „STÜNDLICH AKTUALISIERT".
8. **CTA** as today („Mach mit im Kiez." + „Mitmachen — kostenlos" + sub line + slogan). Sub line may gain „KEINE WERBUNG · KEIN ALGORITHMUS" — DRAFT, owner's call.
9. **Footer** as today.

**Removed:** the three-column teaser zone (Beilage / Der Kiez gemessen / Der Kurier). Its content now lives inside the Beilage, Kiez-Daten and Kurier frames. This is the block that made the page read as text-heavy and political; the owner may veto, in which case it stays below the heartbeat strip in its current form.

The ribbon background stays at 42 %, no filter.

## 4. The strip

### 4.1 Frames, in nav order

Each frame is one `<a>` to its section (`/forum`, `/calendar`, `/marketplace`, `/newsboard`, `/schillerkiez`, `/blog`). Members-only targets land on the login door with `?redirect=`, which is the intended path: look, then knock.

A frame has three zones: the **section bar** (a 44 px replica of the real masthead: the section's `--k-bar-tint` with the shared line/wash/shade layers from `tokens.css`, the „m" disc in paper, the section name in paper mono), the **title block** (mono kicker + the section's real carved title, e.g. „Was *reden* wir heute?"), and the **content card** (below). Under the frame: a mono label in the section colour (FORUM, KALENDER, …) and one italic caption line (DRAFT copy, default = the section title).

| Frame | Live content (no author names, ever) | Data (new unless noted) | Fallback when empty |
|---|---|---|---|
| Forum (wine-deep `#95425d`) | Newest public post: kind kicker (DISKUSSION / ANKÜNDIGUNG / EMPFEHLUNG), title (max 2 lines), up to 3 tags, relative time („vor 5 Std."), line „N Beiträge diese Woche" | `forum: { kind, title, tags, createdAt }` from topics/announcements/recommendations, `PUBLIC_MOD`, newest `createdAt`; count = existing `forumCount` | static screenshot |
| Kalender (teal `#3f7e8a`) | Next upcoming public event: day disc (weekday + day, Berlin), time or „ganztägig", title (max 2 lines), category chip; line „N Termine am Wochenende" when > 0 | `event: { title, startISO, allDay, category }` — `startDate ≥ now`, `visibility ≠ 'private'`, `PUBLIC_MOD`, soonest first; count = existing `weekendEvents` | static screenshot |
| Markt (`#d68a1a`) | Newest available listing: first photo (Cloudinary, 480 px, `f_auto,q_auto`), title (max 2 lines), kind chip (VERKAUFEN / TAUSCH / VERSCHENKEN), price only for `sell` (exchange/gift store `price: 0`) | `listing: { title, image, kind, price }` — `status: 'available'`, `PUBLIC_MOD`, fresh ≤ 21 days (same clock as the browse page: max of `lastBumpedAt`, `createdAt`), newest first. **Field name:** the create route writes `listingType` (`sell` / `exchange` / `gift`); older and seeded docs carry `listingKind` — read `listingType ?? listingKind ?? 'sell'` (audit 2026-09-28: the root CLAUDE.md says `listingKind`, the code says `listingType`). `images` is an array of URL strings; take `[0]` | static screenshot |
| Kurier (ink) | Lead: photo when the article has one, title (max 3 lines), source name; below: the next two titles | existing `kurier[]` gains `imageUrl?` | static screenshot |
| Kiez-Daten (moss `#6b8a4a`) | Ink card: „LUFT HEUTE" + grade word, 7-day bars from `airSpark`, „28.330 Nachbar:innen" | existing `airGrade`, `airSpark`, `population` | when all three are null: static screenshot |
| Beilage (rust `#a3552e`) | Newest post: cover photo when it has one, title (max 3 lines), description (max 2 lines), date | existing `blog[0]` gains `coverSrc?` (`entry.data.cover?.src`) | static screenshot |

Rules:
- **Zero rule per frame:** live content first; if the section has nothing, the frame shows the static screenshot of that section; if the screenshot is missing too, the frame is omitted. The strip never shows an empty card.
- **Privacy:** frames never render a member's name, handle, avatar or e-mail. Forum: title, kind, tags only, no body excerpt. Events: no location line. Listings: no seller. This is stricter than the sections themselves.
- **Consent note (owner's copy):** one sentence in the privacy page: titles of new posts, events and listings may appear on the public start page for up to an hour after they are posted. Ships in the same release. DRAFT wording in section 9.

### 4.2 Geometry

| | Phone (< 1024) | Desktop (≥ 1024) |
|---|---|---|
| Frame width | 236 px | 200 px |
| Frame aspect | 3 : 5 (236 × 393) | 3 : 5 (200 × 333) |
| Gap | 14 px | 24 px |
| Left inset | 16 px (first frame starts at the page inset) | 48 px |
| Visible at rest | 1.6 frames | all six |

The frame box is fixed by `aspect-ratio` so nothing shifts when photos arrive (CLS 0). Frame border 3 px in the section colour, radius 16 px, ink print shadow `3px 3px 0`. Inside, the section bar is 44 px, the title block 64 px, the content card takes the rest and clips with `overflow: hidden`.

### 4.3 Motion

- **One mechanism:** the strip is a native horizontal scroll container (`overflow-x: auto`, `scroll-snap-type: x proximity`, `scroll-snap-align: start`, no visible scrollbar). Autoplay moves `scrollLeft` in a `requestAnimationFrame` loop; hand scrolling is native. No transform track, no library.
- **Snap vs autoplay:** a snap container re-snaps after every programmatic `scrollLeft` change, which makes a rAF drive stutter. While autoplay runs the container has `scroll-snap-type: none`; on every pause it gets `x proximity` back, so a hand scroll still lands on a frame. The container has `scroll-behavior: auto` (never `smooth`) so the wrap below is a hard, invisible jump.
- **Loop:** the six frames are rendered twice (12). When `scrollLeft` passes half the scroll width it is reduced by half in the same frame, which is invisible because the halves are identical. The second copy is `aria-hidden="true"` and its links `tabindex="-1"`.
- **Speed:** 40 px per second, one frame every ~6 s on a phone. Never faster on scroll-into-view.
- **Pause:** on `pointerdown`, `touchstart`, `wheel`, `focusin` and while hovered; resume 4 s after the last interaction ends and the pointer has left. Also paused while the strip is out of the viewport (IntersectionObserver) and while the document is hidden.
- **Reduced motion:** no autoplay, no duplicate copy, plain hand-scrollable strip. `prefers-reduced-motion: reduce` is read once at mount and on change.
- **Keyboard:** the strip is a `role="region"` with `aria-label` and `tabindex="0"`; ← → scroll by one frame; Tab walks the six real frames.
- **Pause control (WCAG 2.2.2):** a small mono „⏸ / ▶" toggle at the right end of the header line, only when autoplay is possible. Its label is DRAFT copy.

### 4.4 Static fallback images

Six WebP files in `public/assets/schaufenster/` (`forum.webp`, `calendar.webp`, `marketplace.webp`, `newsboard.webp`, `schillerkiez.webp`, `blog.webp`), 480 px wide, aspect 3 : 5 (the top of each section on a phone, verify-e-mail banner hidden, ~35 KB each). Produced from the 2026-09-28 prod shots (`scratchpad/hero-src/`) with a small script kept in `scripts/` so they can be re-shot after a redesign. Loaded only when a frame falls back, `loading="lazy"`.

## 5. Data

`LandingData` gains one field, computed inside the existing `compute()` with the same fail-soft pattern (own try/catch per source, failures reported through the existing static Sentry message):

```ts
schaufenster: {
  forum:   { kind: 'discussion' | 'announcement' | 'recommendation'; title: string; tags: string[]; createdAt: string } | null;
  event:   { title: string; startISO: string; allDay: boolean; category: string | null } | null;
  listing: { title: string; image: string | null; kind: 'sell' | 'exchange' | 'gift'; price: number | null } | null;
}
```

`kurier[]` items gain `imageUrl?: string` (`fetch-daily.ts` already stores it; 3 of 3 approved dev articles have one). The blog teaser in `index.astro` gains `coverSrc?: string` produced with Astro's `getImage({ src: entry.data.cover, width: 480, format: 'webp' })` — never the raw `cover.src`, which is the full-size asset — and passes only `blog[0]` to the frame (the second post is no longer shown).

`GET /api/kiez-heartbeat` returns only `rows` + `computedAt` today and stays that way: the new titles are on the public page, not in a public JSON feed.

Cloudinary: `optimizeCloudinary()` only injects `f_auto,q_auto`; add a pure `cloudinaryFit(url, width)` next to it (`w_480,c_fill` after the auto transforms, no-op for non-Cloudinary URLs, tested) for the listing photo.

Cache: unchanged, one hour, same singleton doc. A stale cached payload without `schaufenster` (first deploy) must render as „all fallbacks", not crash: the reader treats a missing field as empty.

Pure, tested helpers (dependency-free, importable by the island):
- `src/lib/landing/frames.ts`: `buildFrames(data, blog, fallbacks) → Frame[]` — applies the per-frame zero rule and produces the six view models (or fewer).
- `src/lib/landing/loop.ts`: `advance(scrollLeft, halfWidth, dx) → number` and `nextIndex(scrollLeft, frameStep, count)` for the dots.
- Berlin day parts for the event disc reuse `src/lib/calendar/berlinDay.ts`.

## 6. Performance

- LCP candidate is the wordmark (text); the first two frames (Forum, Kalender) carry no image, so no image is on the critical path. Photos in frames 3–6 are `loading="lazy"`, `decoding="async"`, width/height set.
- Cloudinary listing photo through `optimizeCloudinary()` plus `w_480,c_fill`. News `imageUrl` is third-party; render with fixed box and `referrerpolicy="no-referrer"`; a load error hides the photo and lets the title take the space.
- No `filter`, no `backdrop-filter` in the strip. `content-visibility` is not used (frames are few and always sized).
- Frame markup is SSR-rendered (`client:load` island as today), so the strip is on the page before hydration; autoplay starts after mount.

## 7. Accessibility

- Frames are real links with a full-sentence `aria-label` („Forum: Was reden wir heute? — <post title>").
- Colour contrast: paper text on the six tints follows the app's bars (Markt ~2.8:1 is a known accepted exception for small labels there; in the frame the section name is 11 px mono bold, same as the real bar).
- Text scales: frames are px-sized boxes; long titles clamp with `-webkit-line-clamp`, never overflow.
- The strip is not the only path to the sections: the CTA and the sign-in link remain.

## 8. Testing and proof

- Unit: `frames.test.ts` (zero rule per frame, missing `schaufenster` field, kind labels), `loop.test.ts` (wrap at half, index maths), the three new queries covered by an integration probe on the dev DB (`scratchpad/landing-data-probe.mts`, prints field names and counts only).
- Browser probes on dev 4655 (`scratchpad/schaufenster-probe.cjs`): 390 and 1440 px, logged out — 12 frame nodes (6 with reduced motion), `scrollLeft` grows over 3 s, stops within 100 ms of a `pointerdown`, resumes after 4 s, wraps without a visible jump (two screenshots 16 ms apart at the wrap), dots follow, CLS 0 via `PerformanceObserver`, no console errors. Composite screenshot of both widths for the owner.
- Gates: tsc ≤ 23, svelte-check ≤ 89, `pnpm build` green. **Nested-island CSS (root CLAUDE.md):** if the strip becomes its own `.svelte` file imported only by `LandingPage.svelte`, its scoped `<style>` is orphaned in prod. Either keep the strip's styles inside `LandingPage.svelte`'s own `<style>` block (preferred, `.lnd-sf-*` classes), or put them in `global.css` — and run the manifest check (`grep -o "<hash>.css" .vercel/output/_functions/manifest_*.mjs | wc -l`) before declaring done.

## 9. Copy (owner's; everything below is DRAFT)

| Key | DE draft | EN draft |
|---|---|---|
| `lnd.sf.kicker` | DAS SCHAUFENSTER · SECHS RÄUME | THE SHOP WINDOW · SIX ROOMS |
| `lnd.sf.hint.phone` | WISCHEN → | SWIPE → |
| `lnd.sf.hint.desktop` | ZIEHEN ZUM BLÄTTERN | DRAG TO BROWSE |
| `lnd.sf.pause` / `lnd.sf.play` | Anhalten / Weiter | Pause / Play |
| `lnd.sf.cap.forum` … `.blog` | the sections' own titles | same |
| forum kind kickers | existing `filter.discussion` / `filter.announcement` / `filter.recommendation` (no new keys) | same |
| `lnd.sf.forum.week` | {n} Beiträge diese Woche | {n} posts this week |
| `lnd.sf.event.weekend` | {n} Termine am Wochenende | {n} events this weekend |
| `lnd.sf.allDay` | ganztägig | all day |
| `lnd.cta.sub` (optional add) | · KEINE WERBUNG · KEIN ALGORITHMUS | · NO ADS · NO ALGORITHM |
| privacy page sentence | Titel neuer Beiträge, Termine und Anzeigen können bis zu eine Stunde nach dem Veröffentlichen im Schaufenster auf der Startseite erscheinen — ohne Namen. | Titles of new posts, events and listings may appear in the shop window on the start page for up to an hour after posting — without names. |

## 10. Rollout

1. Branch `feat/landing-schaufenster`, Vercel preview (dev DB, so the frames show seed content), phone and desktop screenshots for the owner. Dev DB on 2026-09-28: 9 public forum posts, 2 available listings, 3 approved articles with photos, **0 upcoming events** — the Kalender frame will show its fallback on the preview unless one dev event is created first (dev writes are fine; do it from the dev admin account so both paths get seen).
2. Owner looks on his phone; copy replaced with his wording.
3. Merge to main on his word; one region curl, one `vercel ls`.
4. After the deploy: re-shoot the six fallback images from prod when his e-mail is verified (the banner), replace the WebPs in one commit.

## 11. Open decisions (defaults apply unless the owner says otherwise)

1. Remove the three-column teaser zone (section 3). Default: remove.
2. Forum frame: titles only, no body excerpt. Default: titles only, with the privacy sentence.
3. Second blog post no longer teased. Default: accept.
