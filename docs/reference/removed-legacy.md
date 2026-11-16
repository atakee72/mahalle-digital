# Removed legacy surfaces and their recipes

Moved verbatim from the root `CLAUDE.md` on 2026-11-16, when that file was slimmed; the root keeps a short version and points here. Add new notes on this topic HERE and keep the root's short version true. A „see X above/below" or a quoted section name in this text may point to another file now — the map is in `docs/reference/README.md`.

### Calendar Date Range Selection
Lives in the kiosk calendar — click/drag-to-select ranges, the compose prefill and the touch drag are documented in `src/components/calendar/kiosk/CLAUDE.md`. The React `CalendarContainer`/`EventModal` version this block used to describe (speech-bubble tooltip, `prefillDates` memo) was deleted with the kiosk migration.

### Pagination
- The React `Pagination.tsx` component was removed on 2026-09-30 (dead since the kiosk migrations); every live pager is written inline in Svelte.
- **Svelte inline**: Marketplace (`MarketplaceBrowse.svelte`), Blog (`BlogSearch.svelte`), Admin Moderation (`ModerationApp.svelte`, queue + Protokoll each with their own pager) — same layout, adapted to Svelte syntax
- **Features**: First/Prev/Next/Last buttons, "Page X of Y · N items" display, optional page size dropdown
- **Accent colors**: Wine/burgundy for forum and newsboard, teal for marketplace/moderation, white-on-dark for blog

### Splash Screen
`SplashScreen.astro` (the logo-video overlay of the old `BaseLayout`) was removed on 2026-09-30 (dead since the kiosk migrations) — no kiosk page ever used it. The auth door's `KioskSplash.astro` is its own component.

### Page Header
`src/components/ui/PageHeader.astro` (the animated title of the legacy pages) was removed on 2026-09-30 (dead since the kiosk migrations); kiosk pages build their own title blocks.

### Glass Utility System
Removed 2026-10-01: the five `.glass-*` utilities, the `.dark-glass-*` page background and the `.low-perf` override left `global.css` with the unused-exports sweep — no live surface had used them since the kiosk migrations. The reasoning that outlived them: put a heavy `filter`/`backdrop-filter` on a `::after`, never on a host that can contain a `position: fixed` overlay (see „`backdrop-filter` creates a containing block" below), and drop SVG filters under `prefers-reduced-motion`. The old rules are in git history before that date.

### Low-perf Device Detector
The inline `<head>` script lived in `BaseLayout.astro` and was removed on 2026-09-30 (dead since the kiosk migrations) with it (the kiosk layouts carry no heavy filters). The recipe, for reference — it ran before first paint and tagged underpowered devices so heavy SVG filters degraded to flat glass:

```js
if ((navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) ||
    (navigator.deviceMemory && navigator.deviceMemory < 4)) {
  document.documentElement.classList.add('low-perf');
}
```

`.low-perf .glass-luxe-edge::after, .low-perf .glass-luxe::after { filter: none }` in `global.css` dropped the filter on flagged devices (rule removed 2026-10-01 with the glass block). Old Android (2 cores, 2 GB) → flat; modern iPhone/flagship → full wobble. Safari/Firefox `deviceMemory` is undefined — falls back to core count only, fail-safe (unknown = assume capable). Brave/Tor spoof `hardwareConcurrency` to 2 → falls to flat; zero harm, they opt into minimalism. Pattern reusable for any "heavy effect on mid-tier mobile" concern.

### Animation
- The `motion` package (`motion/react`) was removed on 2026-09-30 with the React calendar/newsboard it animated; the logo-video splash went with `BaseLayout`.
- **Live today**: CSS transitions and Svelte `transition:` in the islands, Web Animations API in `is:inline` scripts, Astro View Transitions between pages.
- **Kiez dashboard**: Scroll-triggered section reveal via IntersectionObserver (`use:reveal` Svelte action). CSS transitions for opacity + translateY. Respects `prefers-reduced-motion`.

### Modal scroll-lock
- The five React modals that used `<RemoveScroll enabled={isOpen}>` (ReportModal, EventModal, PostModal, ReadMoreModal, EventViewModal) are gone (`ReportModal.tsx` removed on 2026-09-30, dead since the kiosk migrations) and `react-remove-scroll` was uninstalled the same day; the notes below stay as the recipe for any future React modal (install it again then). The lib handles iOS touch-scroll, desktop scrollbar-gutter compensation, and nested-scroller preservation.
- Replaced earlier `overflow: hidden` on html/body and `position: fixed; top: -scrollY` patterns — both had edge cases (iOS touch leaks, fixed-descendant conflicts with `backdrop-filter` containing blocks).
- For a future React modal: add `react-remove-scroll` back, wrap in `<RemoveScroll enabled={isOpen}>` and drop any bespoke scroll-lock `useEffect`. Svelte modals use `lockPageScroll()` (next bullet).
- **Svelte native `<dialog>` modals are NOT covered by the browser** (audit 2026-09-09): `showModal()` makes the page inert but the document still scrolls under the backdrop. All four Svelte ones (`EventDetailModal`, `KioskReportModal`, `PDeleteAccountModal`, marketplace `DetailGallery` lightbox) plus the React `ConfirmDialog` call `lockPageScroll()` from `src/lib/scrollLock.ts` while open — it locks `<html>` only (see the `overflow-x: clip` corollary above for why never `<body>`) and compensates the scrollbar gutter. Any new native-dialog island must do the same; a comment saying "the browser handles scroll-lock" is wrong.
