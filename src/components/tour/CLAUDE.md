# Tour ("Die Führung") notes

Loaded lazily when working in `src/components/tour/`. Spans `src/lib/tour/*`
(engine-adjacent, dependency-pure state) and `src/pages/api/profile/tour.ts`
(server persistence) — read those directly when working on those pieces.

## Engine contract (`TourController.svelte`, five non-negotiable duties)

1. **Wait for hydration before measuring an anchor** — `waitForAnchor()` polls
   `document.querySelector` via `requestAnimationFrame` (4s timeout) before a
   chapter starts. Prevents a ghost ring measured against a not-yet-hydrated
   DOM.
2. **Never crash if an anchor is entirely absent** — every `querySelector`
   call is null-guarded; a missing anchor degrades (stop skipped / chapter
   ends), it never throws.
3. **Compute available stops per page load** — `availableStops` filters
   `chapter.stops` down to the ones with a live anchor at start time. Missing
   anchors are skipped and the stop counter (`N / M`) adapts — e.g.
   logged-out users miss "Gespeichert"/"Meine" and see a shorter tour.
4. **Scroll first, measure after the scroll settles** — `showStop()` calls
   `scrollIntoView` then awaits a fixed delay (380ms, 50ms reduced-motion)
   before reading `getBoundingClientRect()`. `content-visibility:auto` cards
   report a stale/zero rect until they're actually in the viewport — measuring
   before the scroll settles would ring the wrong spot.
5. **A chapter never crosses a navigation** — `astro:before-preparation`
   aborts an in-progress tour and stamps it seen (nav-away counts as "shown",
   not "finished", but it still writes — no re-nagging on the next visit).

## Storage schema + first-write-wins

- `users.tours?: { forum?: Date, kalender?: Date, markt?: Date, kurier?: Date, kiezdaten?: Date, blog?: Date, profil?: Date }` +
  `users.tourHelloDismissedAt?: Date` — additive, not ban-gated (reading a UI
  tour isn't content-writing; banned accounts keep read access).
- **Timestamps, never booleans** — leaves room for a future redesign to
  re-offer chapters after a cutoff date without a schema change.
- **First write wins**: `POST /api/profile/tour` (`src/pages/api/profile/tour.ts`)
  only `$set`s a field when it's currently absent on the user doc. A chapter
  restart (avatar menu, dev hook) never rewrites the original seen date —
  `markChapterSeen`/`markHelloDismissed` in `src/lib/tour/tourStore.ts` mirror
  the same idempotency client-side (`writeLocal` happens synchronously before
  the `fetch`, so `getLocalState()` read immediately after a `void mark…()`
  call sees the write even though the POST is still in flight).
- **Anonymous → signed-in merge**: `syncWithServer()` unions local and server
  "seen" state (local wins ties) and pushes any local-only chapters up to the
  server on the first authenticated load — a logged-out tour run isn't lost
  at registration.

## Scrim-via-box-shadow decision (spotlight ring)

`TourSpotlight.svelte`'s `.tour-ring` paints the dim scrim AND the anchor
cutout as a single oversized `box-shadow` (`0 0 0 200vmax rgba(27,26,23,0.5)`)
on a small bordered `<div>` sized to the anchor's rect, rather than a
full-viewport scrim `<div>` with a CSS `mask`/`clip-path` hole. This is
stacking-context-proof: a real scrim element sits at a fixed z-index and can
end up behind/above unrelated `position: relative`/`transform` ancestors
depending on where in the DOM it mounts, while an oversized `box-shadow`
paints relative to its own tiny element and needs no coordination with
anything else on the page. Deviates from the design handoff's `mask` cutout
mechanism (§03) — see task-3-report.md.

**`TourHelloModal` does NOT use this trick.** It has no anchor to reveal, so
its `.tour-hello-scrim` is a plain full-viewport `position: fixed; inset: 0`
div with a flat `rgba(27,26,23,0.5)` fill — the box-shadow mechanism only
earns its complexity when there's a hole to cut.

## Entrance rules (three entrances, `TourController`'s decision effect)

1. **Hello modal** — signed-in **AND** `!state.helloDismissedAt` **AND** the
   current page has a registered chapter (`CHAPTERS_BY_PAGE[page]`). One-shot
   per account, ever; "Später"/✕/Esc all write `tourHelloDismissedAt` and it
   never reappears — the avatar-menu row is the only way back in after that.
   Body copy is parameterized per surface: `tour.hello.body` has `{surface}`
   and `{n}` placeholders, substituted at render time with the chapter's
   `tour.surface.*` phrase (e.g. "durch den Kalender") and its stop count —
   one shared string instead of seven near-duplicates.
2. **Offer strip** — current page has a chapter **AND** that chapter is
   unseen (`!isChapterSeen(state, chapter.key)`). Fires for BOTH logged-out
   and logged-in users (unlike the hello modal), and falls through from a
   dismissed/absent hello modal on the same page load — see the `mode`
   state machine in `TourController.svelte`. Same `{surface}`/`{n}`
   interpolation as the hello modal (`tour.offer.text`), same `tour.surface.*`
   source.
3. **Avatar-menu row** ("Führung starten") — always rendered (no seen-state
   gate, no entrance decision at all), always starts the **current page's**
   chapter via `window.__mahalleTourStart()`. Never writes anything by
   itself — a restart from here still funnels through the same
   `markChapterSeen` first-write-wins path as any other completion/abort, so
   repeat runs are idempotent no-ops against storage.

## Engine capabilities added for the six-chapter rollout (phase 2)

- **`findAnchor` is visible-first, not first-match.** Several anchors exist
  twice in the DOM (desktop + mobile variants, CSS-hidden per breakpoint via
  `hidden md:block`/`md:hidden` etc.). `document.querySelector` would happily
  return a `display:none` node with a zero rect and ring nothing; `findAnchor`
  iterates `querySelectorAll` and returns the first element with a non-empty
  `getClientRects()`. Every anchor lookup in `TourController.svelte`
  (`waitForAnchor`, `startChapter`, `showStop`, the scroll/resize re-measure)
  goes through it.
- **Forum „Tags" stop on phones (2026-09-20):** `[data-tour="forum-tag"]` exists twice — on the „# Tags" chip (phones, first in the DOM) and on the first tag pill. Visible-first lookup puts the ring on the chip below md and on the first tag from md up. The stop has a `bodyMobileKey` (the user's own wording) whose sentence is true with AND without the chip, because the mobile-copy breakpoint (< 1024 px) also covers tablets, which have no chip — and it deliberately does not say „on your phone". Both anchors share one condition (`tags.length`), so the „anchors must be unconditional" rule is no worse off than before. Still 7 forum stops.
- **`TourStop.bodyMobileKey?: string`** — optional alternate body copy shown
  under a mobile breakpoint instead of `bodyKey`. Used twice: Forum S6 (above) and Kalender S2,
  where the desktop body describes click-then-second-click range selection
  (two discrete clicks, no drag) and the mobile body describes a single tap
  (no range gesture on mobile — different interaction, same anchor).
- **`TourChapter.final?: boolean`** — marks the last chapter in the chain
  (Profil). The end card swaps the normal stamp text (`tour.chrome.stamp`,
  'KAPITEL') for `tour.chrome.stampFinal` ('FÜHRUNG') and omits the
  next-chapter link entirely (no `nextChapterKey`/`nextChapterHref` on that
  registry entry) instead of dead-ending into an empty href.
- **`TourStop.link?: { labelKey, hrefBase, prefillTitleKey, prefillBodyKey,
  prefillTags }`** — optional CTA on a single stop that opens a
  pre-filled compose flow instead of just ringing the anchor. Used once:
  Forum S7 ("Hallo Kiez") links to `/topics/create` with a bracketed-fill-in
  template (title + body + `neu-hier` tag) — the user still edits and submits
  normally, no auto-posting, normal 5/day quota + AI moderation apply.

## How to add a chapter (all seven live — this is now a template, not a spec)

All seven chapters (Forum, Kalender, Markt, Kurier, Kiez-Daten, Blog, Profil —
32 stops, 7·6·5·5·3·3·3) shipped in phase 2 + depth pass (Kalender gained a month-nav stop 2026-08-12).
`design/handoffs/TOUR_CC_ANSWERS.md` + `TOUR_DEPTH_ANSWERS.md` are the copy
source of truth (stop titles/bodies, anchor corrections, the arrow-nose call,
the offer-strip placement call, the chapter chain, the hello-modal template)
— read both before touching any stop copy or adding an eighth chapter.
Depth-pass rules that bind future stops: anchors must be UNCONDITIONAL
(always in the DOM — silent skip is defect insurance, not a design tool);
the tour never explains search fields; two chapters never speak the same
sentence; 7 stops (Forum) is the per-chapter maximum.

1. **Registry entry** in `src/lib/tour/tourChapters.ts` — one
   `CHAPTERS_BY_PAGE[page]` object: `key` (must be a `ChapterKey` from
   `tourStore.ts`), `page`, `kickerKey`, an ordered `stops[]`
   (`{ anchor, titleKey, bodyKey, bodyMobileKey?, link? }`), `endNoteKey`,
   `nextChapterKey`/`nextChapterHref` (omit both only for the final chapter,
   and set `final: true` there instead).
2. **i18n keys** in both dictionaries of `src/lib/kiosk-i18n.ts` — kicker,
   per-stop title/body, end note, next-chapter link text, plus a
   `tour.surface.*` entry if this is a new surface. No new *engine* keys
   needed beyond that (`tour.chrome.*` is shared across all chapters).
3. **`data-tour` anchors** on the real DOM elements the stops point at —
   chrome + top-level controls ONLY, never the n-th item in a list (a card
   can scroll out of existence between page loads; a filter tab or a compose
   CTA can't). If an anchor legitimately exists twice (desktop/mobile
   variants), that's fine — `findAnchor` picks the visible one.
4. Nothing in `TourController`, `TourSpotlight`, `TourHelloModal`, or
   `TourOfferStrip` needs to change — they're all chapter-agnostic, driven
   entirely by the registry + `page` prop.

## v1 deviations from the design handoff

- **Offer strip renders below the nav, not below the page title.** The
  handoff's mock placed it as "a line under the page title" (per-page, inside
  each page's own header markup). `TourController` mounts once, globally, in
  `KioskLayout.astro` between `<KioskNav>` and `<main>` — it has no way to
  reach into an arbitrary page's title block without every kiosk page
  threading a slot for it. Rendering it in the layout's own flow (still
  full-width, still "first thing you see below the nav") gets the same
  "quiet, page-scoped nudge" effect for one shared mount point instead of N
  page-specific ones. **Confirmed final for v1** — CD approved below-nav in
  TOUR_CC_ANSWERS.md §4 ("unter der Nav = final"); "unterm Seitentitel" stays
  a someday target image, not load-bearing.
- **Kurier S3 anchor deviates from the handoff copy.** The handoff's stop 3
  points at an "ungelesen" (unread) filter; the shipped Kurier filter row
  ships that toggle disabled (Phase-1 placeholder, not wired to real
  read-state yet). Re-anchored to the filter row itself
  (`[data-tour="kurier-fade"]`) with softened copy that doesn't promise a
  working unread filter. User-approved option (a) — ring the row, adjust
  copy — over blocking the chapter on the feature. Decided 2026-08-10.
