# Newsboard (kiosk) notes

Loaded lazily when Claude reads/edits files in `src/components/newsboard/kiosk/`
(or any subtree). The root `CLAUDE.md` keeps a pointer here so it can be pulled in
when working on related files outside this dir (`src/pages/newsboard.astro`,
`src/pages/newsboard/submit.astro`, `src/lib/newsboard/*`).

This is the kiosk (paper/ink) Newsboard UI, shipped June 2026. It is the
"Schillerkiez Kurier" — a daily-newspaper presentation of the existing `news`
collection. The pre-kiosk React UI (`NewsCardsWrapper.tsx`, `ui/NewsCards.tsx`)
still exists; see `src/pages/api/news/CLAUDE.md` for the data/API side.

Phased plan: `docs/superpowers/plans/2026-06-19-newsboard-kiosk-redesign-phase1.md`.
This dir is **Phase 1** (index browse + minimal submit). Phases 2/3 listed at the
bottom.

## Pages

- **Index** = `src/pages/newsboard.astro` — `KioskLayout` with `page="newsboard"`,
  mounts `NewsboardIndexInner.svelte` with `client:only="svelte"`. Frontmatter
  computes server-fixed props (`issue`, `degraded`, `currentUserId`) and sets
  `Cache-Control: no-store` (per-user save state makes caching unsafe — mirrors
  marketplace).
- **Submit** = `src/pages/newsboard/submit.astro` → `submit/NewsSubmitInner.svelte`.
  Auth-gated: frontmatter redirects to `/login` when no session.

## Folder layout

- `NewsboardIndexInner.svelte` — orchestrator (fetch, filters, save, bucketing).
- `browse/` — `NewsMasthead`, `NewsTitleBlock`, `NewsFilterRail`, `NewsCard`,
  `NewsCardLead`, `DateDivider`.
- `primitives/` — `SourceChip`, `SektionTag`, `KuratiertChip`, `HeatChip`,
  `ReadDot`, `SaveToggle`, `ArticleImage`, `ArticleMeta`.
- `states/` — `NewsSkeleton`, `NewsEmptyToday`, `NewsEmptySaved`, `NewsError`,
  `NewsDegradedBanner`.
- `submit/` — `NewsSubmitInner`, `QuotaIndicator`, `SektionPicker`.

## Pure helpers — keep them dependency-pure

`src/lib/newsboard/newsTaxonomy.ts` and `newsFormat.ts` are **DEPENDENCY-PURE**
(no `mongodb`/`fs`/`auth` imports). Both the Astro page (server) and the Svelte
island (client) import them. **NEVER add a server-only import to these** — it would
bleed mongodb into the client bundle and silently break hydration (see root
CLAUDE.md "Server-only modules bleeding into client bundles"). They hold: the
taxonomy types/maps + resolvers, `computeIssueNumber`, `chronoBucket`,
`formatRelativeTime`, `formatFetchDate`, and the read-decay/heat constants.

## Taxonomy resolver strategy

The DB has **no** `sektion`/`quelle` enum fields. The design wants a fixed
7-section / 10-source taxonomy (`SektionKey` × `QuelleKey`). The resolvers map the
real free-string DB fields onto it at render time:

- `resolveSektion(aiCategory)` — substring-matches `aiCategory` → one of 7
  sektions; defaults to `'lokales'` (catch-all for neighborhood news).
- `resolveQuelle(sourceName, source)` — `source === 'user_submitted'` → `'user'`;
  otherwise matches `sourceName` → a known source key; defaults to `'newsdata'`
  (neutral styling for unknown RSS/API sources).

**Phase-3 follow-up:** have `src/pages/api/news/fetch-daily.ts` emit a real
`sektion` field so the resolver degrades to a fallback rather than the primary
classifier.

## Issue number — computed server-side

`computeIssueNumber(now)` = days since notional launch `2026-01-03`, **+1**. Seed
cross-check: `2026-05-24` = Nr. 142. Computed **server-side** in `newsboard.astro`
frontmatter and passed as the `issue` prop — never derived client-side per render
(handoff rule; keeps the number stable across re-renders/locales).

## Phase-1 inert components (pre-wired for Phase 3)

These render but are deliberately neutered now; Phase 3 flips them on without
re-touching the components:

- `HeatChip` is fed `forumLinks: 0` → `count < HEAT_THRESHOLD` (=2) → never shows.
- `ReadDot` always renders unread (wine dot).
- The FilterRail "Ungelesen" toggle is disabled.
- The orchestrator's `toVM()` hardcodes `forumLinks: 0, read: false, archived: false`.

## Cards link to the detail route; the detail page links OUT

As of Phase 2, the feed cards' headline + `weiterlesen` link to the **internal**
detail page `/newsboard/${id}` (same tab). The detail page's `weiterlesen bei …`
button is what links to the external `sourceUrl` (`target="_blank"`) — the
Newsboard never renders the full article inline.

**Mobile bottom-nav clearance (F1 fix, 2026-09-03, `6c7014f8`).** `[id].astro`'s
content wrapper is `pb-28 lg:pb-[50px]` — 112px bottom padding below `lg`, the
original 50px at `lg+`. Reason: on a short article the `weiterlesen bei …` CTA
(the only offsite link) landed under the fixed mobile bottom-nav. **Known
limitation (accepted):** bottom padding only guarantees clearance ONCE SCROLLED —
it cannot make the CTA visible on first paint, because at `scrollY=0` the CTA's
position is set by the content ABOVE it, which padding below can't move. First-
paint visibility on short articles would need a design change (source block above
body on mobile, or a scroll cue); deliberately NOT done — this "short page +
fixed bottom nav hides the last element" is a global pattern, fix app-wide if it
ever matters. Don't drop the `pb-28` thinking `KioskFooter` covers it — the footer
scrolls into view but sits BELOW the CTA, so it doesn't lift the CTA on first paint.

## No-image placeholder is first-class

`ArticleImage` renders a dashed-border source monogram + "kein bild" when
`imageUrl` is empty (~15-20% of RSS articles ship no image). Don't treat the
empty-image branch as an error/edge — it's an intended visual.

## Degraded flag (NOT an error state)

`degraded = !import.meta.env.NEWSDATA_API_KEY` (server-side, in `newsboard.astro`).
When true it shows the amber RSS-only `NewsDegradedBanner` + a masthead note + a
7-source count (vs 9 normally). This is a normal operating mode, not an error.

## Orchestrator ↔ API contract

`NewsboardIndexInner.svelte` depends on these shapes:

- `GET /api/news` → `{ news: [...] }` (orchestrator passes
  `limit=40&sortBy=approvedAt&sortOrder=desc` + optional `dateFrom`).
- `GET /api/news/save` → `{ savedIds: string[] }`.
- `POST /api/news/save` → body `{ newsId, action: 'save' | 'unsave' }`.

Save is **optimistic with rollback** (mutates `savedIds` + `articles`, reverts on
non-OK). Toast helper is `showToast(message, { type })` from `src/utils/toast.ts`.

## Submit form fills itself from the link (2026-09-21)
The link field is the FIRST field of `submit/NewsSubmitInner.svelte`; pasting (or changing) an https address calls `GET /api/news/preview` once per address and fills only the fields that are still empty — a typed title is never overwritten, and a late answer for a link the member has already changed is dropped. The original design had this; the kiosk form lost it in the June migration while the endpoint stayed live and unguarded. Endpoint rules + probe: `src/pages/api/news/CLAUDE.md` → „Link preview for the submit form". The design's „VORSCHAU · IM FEED" card is still deferred.

## Floating „+" on phones (2026-09-20, user request)
`a[data-news-fab]` at the end of `NewsboardIndexInner.svelte` → `/newsboard/submit`: the same floating add button as calendar, market and forum (`fixed bottom-16 right-4 z-30`, 56 px, `lg:hidden`, label `news.mobile.cta.aria`), shown in every list state. It is INK with a wine print shadow (user decision 2026-09-20: the button takes the page colour; an ink shadow would vanish under an ink disc, so it borrows the primary ink button's wine shadow). The title block's „+ news einreichen" button is desktop-only since the same night (`hidden lg:inline-flex`, user request); the floating button carries the same `data-tour="kurier-submit"`, so the tour's last Kurier stop lands on it below `lg`. Same request: the page title is 34 px below 380 px / 36 px from 380 px on phones like forum and calendar (was 26 px; from `md` the old `clamp(26px,4vw,38px)` stays — written as `md:text-[length:clamp(…)]`, the `length:` hint is needed or Tailwind reads it as a colour). It runs to two lines on phones, like the market's. Probe: `scratchpad/title-sizes.cjs`. Known cost the user accepted: a permanent button may bring more submissions into the editorial queue. Probe + details: `src/components/forum/kiosk/CLAUDE.md` → „Floating „+" on phones".

## Kiez cards + lead pick (2026-09-22)

The server now orders a day by the article's real `publishedAt` (score is only
a tiebreak — see `src/pages/api/news/CLAUDE.md`), which exposed two follow-on
problems fixed the same day:

- **Lead pick + today's order (refined 2026-09-22 12:18, user decision:
  „the scoring idea was actually nice, and we can use it just for sorting the
  articles of today").** `approvedItems[0]` used to BE the lead — now that's
  just „the highest score of the day", which can be old. The first cut of the
  fix (`pickLead()`) went too far the other way and made HEUTE pure
  publish-time order, discarding the score signal entirely. Final rule,
  `orderBoard()` (`src/lib/newsboard/newsFormat.ts`, pure, tested in
  `newsOrder.test.ts`, replaces `pickLead()`): inside HEUTE, order by
  `aiRelevanceScore` desc with `publishedAt` desc as tiebreak; GESTERN/ÄLTER
  stay `publishedAt` desc (unchanged); the lead is the first item of the
  ordered HEUTE bucket (today's highest score), falling back to the first
  (newest) of GESTERN before the 6 AM cron, else no lead — removed from its
  bucket once picked. `NewsVM` carries a `score` field
  (`aiRelevanceScore ?? 0`, set in `toVM`) so the pure function never needs a
  server import. `NewsboardIndexInner.svelte` derives one
  `board = orderBoard(approvedItems, new Date(), !activeSektion && !savedOnly)`
  and reads `board.lead`/`board.today`/`board.yesterday`/`board.older`.
- **Kiez sources stay visible.** Recency ordering means a Kiez/Neukölln
  article no longer floats to the top on score alone, so it now prints as an
  INK card so it doesn't get lost among mainstream RSS sources. `isKiezSource()`
  + the editable `KIEZ_SOURCE_PATTERNS` list live in `newsTaxonomy.ts` (pure);
  `toVM()` sets `NewsVM.kiez`. The look is a token-inversion trick, not a new
  component: `NewsCard.svelte` / `NewsCardLead.svelte` override
  `--k-paper`/`--k-ink`/`--k-ink-soft`/`--k-ink-mute`/`--k-border-hair` (+
  `--k-paper-warm`/`--k-border-ink` on the lead, which uses those instead of
  the plain-card tokens) as INLINE custom properties on the card root when
  `article.kiez` — every descendant that reads the token (border, text)
  inverts for free via normal CSS cascade, no per-child styling. No `<style>`
  block was added (nested-island rule — `NewsCard`/`NewsCardLead` are only
  ever imported through `NewsboardIndexInner`, and a `<style>` block there
  gets orphaned in prod, see root CLAUDE.md). A mono kicker chip
  (`news.kiez.kicker`, `data-kiez-kicker`) renders first in the chip row;
  `data-kiez="true"` on the card root is for probes.
  **Gotcha found by reading the actual card tree, not the plan text:**
  `SourceChip.svelte` (nested inside `ArticleMeta`, not one of the primitives
  the original plan named) hardcodes its OWN pill background to
  `var(--k-paper-warm)` — a literal token, not derived from `--k-paper` — so
  without overriding `--k-paper-warm` too, a Kiez card's source chip went
  invisible (light text on an un-inverted light chip). Fixed by adding
  `--k-paper-warm` to both cards' override list rather than touching
  `SourceChip.svelte` itself (keeps it generic). Everything else
  (`SektionTag`, `HeatChip`, `ArticleMeta`'s submitter-initials disc,
  `ArticleImage`'s no-image placeholder) either chains through
  `--k-ink`/`--k-paper` already (inverts automatically) or uses an
  independent semantic accent (wine/moss/teal/ochre/danger, the project's
  „sticker accents stay" convention) — deliberately untouched.
- Probe: `scratchpad/news-kiez-probe.cjs` (env `PROBE_WIDTH`, checks the lead
  pick, the ink card's computed colors, the kicker text, and a plain card's
  paper background) against two `E2E-`-prefixed dev-only fixtures inserted via
  `scratchpad/news-kiez-fixtures.mts insert`/`cleanup`.

## Default time window = `week`

`activeZeitraum` defaults to `'week'` (not `'today'`) so the HEUTE/GESTERN/FRÜHER
dividers have content — RSS `publishedAt` often predates the fetch day. The
masthead "Artikel heute" count uses `todayCount`, which counts **only** today's
chrono bucket even though a wider window is loaded. Zeitraum change re-fetches the
window; sektion + savedOnly are client-side filters (no refetch).

## Tokens

- `tokens.css` `[data-page="newsboard"]` sets `--k-accent: var(--k-ink)` — the
  carved accent is **ink**, not ochre (per handoff). Don't revert to ochre.
- `tokens-newsboard.css` holds the sektion / quelle / read-decay / heat tokens
  (`--sektion-*`, `--quelle-*`, `--news-noimage-*`, `--news-heat-color`, etc.).

## Phase 2 (shipped, 2026-06-20)

Plan: `docs/superpowers/plans/2026-06-20-newsboard-kiosk-redesign-phase2.md`.

- **Detail route** `/newsboard/[id].astro` — SSR main column (kicker, H1, dek,
  source, hero image, body paragraphs, source-footer link-out, AI/mod disclosure)
  for SEO, with the interactive **sidebar** as an island (`NewsDetailInner.svelte`
  → `detail/ReadingListControls` save toggle, `detail/ForumDiscussCTA`,
  `detail/RelatedRail`). Mirrors the marketplace SSR-shell + island split (no
  duplicate H1/body). `NewsDetail` type lives in the PURE `newsTaxonomy.ts` so the
  island never imports the mongodb-importing `newsQuery.ts`. Server fetch:
  `fetchNewsDetailForSSR(id, userId)` in `src/lib/newsboard/newsQuery.ts`
  (visibility = approved OR own pending/rejected).
- **Forum CTA prefill** — `ForumDiscussCTA` links to
  `/topics/create?prefill_title=…&prefill_body=<sourceUrl>`; `ComposePageInner`
  (forum) reads those params in `onMount` and seeds `initialValues`. The CTA's
  exhausted state comes from `GET /api/topics/daily-count` (new endpoint).
- **Full submit** — `submit/NewsSubmitInner.svelte` (replaced the Phase-1
  `NewsSubmitMinimal` stub) with `QuotaIndicator` (5-slot), `SektionPicker`,
  image upload (`POST /api/news/upload` → Cloudinary `mahalle/newsboard`), and the
  rate-limited (quota-reached) state. Backend: `submit.ts` enforces 5/day rolling-24h
  + stores the chosen section as `aiCategory` (the index resolver round-trips it);
  `GET /api/news/daily-count` feeds the indicator; `sektion` added to
  `NewsSubmitSchema`.
- **Submit success toast fires on the DESTINATION (F3 fix, 2026-09-03, `7feca439`).**
  `NewsSubmitInner.submit()` navigates to `/newsboard?just_submitted=1` (NOT a
  toast + synchronous `window.location.href`, which died in the page teardown
  before rendering). `NewsboardIndexInner`'s `onMount` reads the param, shows the
  success toast, and strips it via `history.replaceState` — the marketplace
  `?just_posted` flash pattern. Reuse this pattern for any submit-then-redirect flow.
- **`SaveToggle` tap target (F2 fix, 2026-09-03, `5e48854d`).** The visible box
  stays small (22px `mini` / 26px); an invisible absolutely-positioned child span
  (`inset:-11px` mini / `-9px` large) extends the HIT area to ~44px without growing
  the visual box. The insets are deliberately fitted INSIDE the flex gaps of the
  card rows it lives in (12px `NewsCard`, 14px `NewsCardLead`) so the halo never
  eats the neighbouring "readmore" tap — if you change those gaps or the insets,
  re-check the overlap. `shrink-0` on the button prevents a flex squeeze in tight
  meta rows. Inline styles only (no `<style>` — avoids the nested-island orphan trap).
- **Own-submission straps** — the feed shows the author's own pending/rejected
  items with an `IN PRÜFUNG`/`ABGELEHNT` strap + reason (states 08/09); `NewsVM`
  carries `moderationStatus` + `warningText`. **Gotcha (fixed 2026-06-22):**
  user-submitted non-approved items have **no `fetchDate`** (it's set only at admin
  approval), and `/api/news` leads its sort with `fetchDate: -1` + a page limit —
  so an author's own pending item sank below the limit and never reached the feed,
  making the strap effectively dead. `/api/news` now runs a separate query to
  surface own pending/rejected at the **top of page 1** (honoring the existing
  `$or` intent), and `NewsboardIndexInner` floats `ownNonApproved` above the feed
  body while keeping the lead an **approved** item (`NewsCardLead` renders no
  strap). Any non-approved item in the client list is the current user's own — the
  API never returns other users' non-approved news.
- `KioskBtn` gained optional `target`/`rel` props (used by the lead CTA in Phase 1;
  retained).
- **SSR-prefetch of the index for SEO** (Task C1, landed 2026-06-22) — the index is
  now `client:load` (was `client:only`), seeded from `fetchNewsForSSR(userId)` in
  the server-only `newsQuery.ts`. The feed headlines/dek/summary render in raw HTML
  (verified: ~39 `<h3>` server-rendered). The island accepts an `initialArticles`
  prop, seeds `articles`/`status` on first paint, and skips the initial client
  fetch **for anonymous visitors only** (logged-in users still refetch once to
  resolve `saved` state, since the SSR seed uses an empty saved set). Hydration was
  verified clean (0 console errors/warnings) in **both** `de` and `en` locales —
  Svelte 5 reconciles relative-time / locale text differences silently via
  reactivity on mount (only DOM *structure* must match SSR, and it does because the
  seed and the client fetch share the same source + default `week` window). The
  `fetchNewsForSSR` filter duplicates the `/api/news` visibility filter — keep them
  in sync (Phase-3 could extract a shared `buildNewsFilter`).

## Deferred

Not bugs or tech-debt — parked by design. Build when the phase lands:

- Full submit **live preview card** (the design's "VORSCHAU · IM FEED" panel) — the
  form ships without it; add later if wanted.
- Read-state decay + a `news_read_state` store (Phase 3).
- Heat indicator: real `heatCount` + a forum-link counter job (Phase 3).
- Real `sektion` field emitted from `fetch-daily.ts` (Phase 3) — currently the
  resolver maps `aiCategory`, and user submissions store the section as `aiCategory`.
- Offline/cached state (state 05) — needs a service worker.
- Masthead once-per-day intro animation.
