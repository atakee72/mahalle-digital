# Blog (kiosk) notes — „Die Beilage"

Loaded lazily when Claude reads/edits files in `src/components/blog/` (or any
subtree). The root `CLAUDE.md` keeps a pointer here so it can be pulled in when
working on related files outside this dir (`src/pages/blog/*`,
`src/layouts/blog/*`, `src/lib/blog/beilage.ts`, `src/styles/blog.css`).

„Die Beilage" ("the supplement") is the kiosk (paper/ink) presentation of the
`blog` content collection — the Schillerkiez Kurier's magazine supplement.
Legacy dark-glass blog (`BlogBaseLayout.astro`, `BlogSearch.svelte`,
`ImageGallery.svelte`, `TagCloud.astro`, `TagBarMobile.astro`, `BlogCard.astro`)
was torn down in the kiosk migration's final task (July 2026) — no trace of it
remains, don't resurrect the pattern.

## Pages

- `src/pages/blog/index.astro` — index. `KioskLayout` `page="blog"`, mounts
  `BeilageIndex.svelte` `client:only="svelte"`. Filters `!data.draft`
  unconditionally over `getCollection('blog')`.
- `src/pages/blog/[...slug].astro` — article detail. Resolves entry with
  `!data.draft || !import.meta.env.PROD` (drafts 404 in prod, visible in dev —
  see "Draft gating" below), picks one of `StandardLayout` / `HeroLayout` /
  `GalleryLayout` by `postLayout`, renders MDX body server-side via
  `await render(entry)` → `<Content />`.
- `src/pages/blog/tag/[tag].astro` — rubric page. `KioskLayout` `page="blog"`,
  mounts `BeilageTagPage.svelte` `client:only="svelte"`. Unknown/empty tags
  render the "Leere Rubrik" empty state at HTTP 200 (catches stale links)
  rather than 404ing.

There is no separate Druckbogen route — print is a `@media print` layer on the
article route itself (see below), triggered by `window.print()` from
`BlogArticleFooter`.

## Decision 1 — SSR everywhere, not prerendered

Every blog route runs SSR (no `prerender` export anywhere under
`src/pages/blog`). Three independent reasons converge on the same answer:

1. **`KioskNav` has no client-side session fetch.** `KioskLayout.astro` calls
   `getSession(Astro.request)` server-side and passes
   `user={session?.user ?? null}` straight into `<KioskNav client:load>`.
   Unlike the legacy `Navbar.tsx` (which re-fetches `/api/auth/session`
   client-side specifically to correct a prerendered `user={undefined}`),
   `KioskNav` has no such fallback — a prerendered blog page would show every
   visitor as logged out forever, even after a real login.
2. **Draft-404 is a per-request decision.** `[...slug].astro`'s
   `!data.draft || !import.meta.env.PROD` check needs to run per request (dev
   vs. prod), which only works on-demand.
3. **QR generation needs a real `Astro.request`.** `ArticleShell.astro` builds
   the article URL via `getTrustedBaseUrl(Astro.request)` and encodes it into a
   QR SVG at render time (`QRCode.toString`) — there is no request object to
   read at build time for a prerendered/static page.

## Island split: server-rendered MDX body, client-reactive chrome

Article pages mix both rendering modes deliberately, not by accident:

- **Body**: `<Content />` from `await render(entry)` is server-rendered HTML,
  dropped into a plain `<slot />` in each layout (`StandardLayout` /
  `HeroLayout` / `GalleryLayout`). Good for SEO/crawlability, and it's
  authored content — never needs to react to locale toggles.
- **Chrome**: masthead, read-bar, article header, footer (CTAs), related rail,
  and gallery grid are all `client:only="svelte"` islands
  (`BlogReadBar`, `BlogArticleHeader`, `BlogArticleFooter`, `BlogRelatedRail`,
  `BlogGalleryGrid`, `BeilageIndex`, `BeilageTagPage`). These read
  `src/lib/kiosk-i18n.ts`'s reactive `$t`/`$locale` stores so the DE/EN toggle
  flips every chrome string instantly without a page reload. Post titles,
  descriptions, and MDX body text are authored content and never localized —
  they stay as written regardless of locale.

## `src/lib/blog/beilage.ts` — pure derivation helpers

Dependency-pure (no `mongodb`/`fs`/etc.) — imported by both `.astro`
frontmatter (server) and Svelte islands (client). Never add a server-only
import here (see root CLAUDE.md, "Server-only modules bleeding into client
bundles").

- `readingMinutes(body)` — word count / 200 wpm, minimum 1.
- `fmtDate` / `fmtDateKicker` / `fmtMonthLabel` / `monthKey` — DE/EN date
  formatting (Europe/Berlin), 3-char month abbreviations (ICU's "März" /
  "Sept." are hand-truncated to "Mär" / "Sep" to match the design).
- `monthGroups(posts)` — Archiv sidebar rows, newest-first, only months WITH
  posts (never an empty row).
- `relatedFor(currentId, posts, max=3)` — Rubrik-Rail ranking: rank by count of
  shared tags (desc), ties/zero-shared broken by newest-first. Zero-shared
  fill items get `shared: []` and render as "ZULETZT ERSCHIENEN" rather than
  being excluded — the rail always tries to fill up to 3 slots.
  `tagCounts(posts)` — `[tag, count]` pairs for rubric chips, count desc then
  alpha.
- `rankOf(id, posts)` — the "№ n/N" badge: 1-based rank in **ascending**
  pubDate order (oldest = № 1), `of` = total published count. This is
  deliberately the opposite sort direction from the index/tag listings (which
  are newest-first) — № counts up chronologically like an issue number, the
  listings read newest-first like a newspaper front page.

## `BlMasthead` double rule

`.bl-mast-rules` in `src/styles/blog.css` is a standalone element (not a
border shorthand): 2.5px heavy rule on top, 2px gap, 1px rule below —
the Kurier-family signal shared with the Newsboard masthead, rust instead of
ink. Never simplify to a single border.

## `BlogReadBar` header-measure docking

`BlogReadBar.svelte` (Lesefaden) docks itself directly under `KioskNav`'s
`<header>` rather than assuming a fixed nav height: on mount it measures
`document.querySelector('header').offsetHeight` and sets its own
`position: sticky; top: {offsetHeight}px`, re-measuring on `resize`. The
scroll-progress fill is a direct style binding (no CSS transition) so it
tracks scroll position 1:1; only the 100% "gelesen ✓" swap animates
(`.bl-read-done` keyframe), and that's exempted under
`prefers-reduced-motion` because it's a state swap, not motion tied to
scrolling.

## Druckbogen (print) — visibility-isolation recipe, with one deviation

`src/styles/blog-print.css`'s `@media print` block follows the same
visibility-isolation pattern as `steckbrief.astro`/`druck.astro`: `body *` is
hidden, `.bl-sheet` (and its subtree) stays visible. That file is imported
ONLY by `ArticleShell.astro` — never by the index/tag pages: only article
routes have a `.bl-sheet`, so on any other page the isolation would hide
everything and reveal nothing (printing `/blog` produced a blank sheet until
this was scoped, July 2026). **Deliberate deviation**
from those precedents: they pin their print sheet with `position: fixed`,
which clips content past the first page — fine for their single-sheet cards,
wrong for a multi-page article. The blog's `.bl-sheet` uses `position:
absolute` (anchored to `body`'s top; `body.k-paper-bg` is `position:
relative`) so content flows across as many pages as the article needs, and the
18mm margins live on `@page` (not sheet padding) so every page gets them, not
just page 1. The print rules load via a global style block because `<body>`
belongs to `KioskLayout`, not the page. The STAND (date) + QR footer render
inline after the content (`.bl-print-foot`) rather than pinned to a page edge
— it lands wherever the last page's content ends, which is an accepted
looseness for a multi-page sheet metaphor. QR: `ArticleShell.astro` generates
an inline SVG via `qrcode`'s `QRCode.toString()` server-side (safe `set:html`
— the URL is always self-constructed from `getTrustedBaseUrl()`, never
user input), sized in print via `.bl-print-qr` (18mm × 18mm).

## `prefill_tags` / `prefill_title` / `prefill_body` — two blog consumers of `/topics/create`

Both funnel into `ComposePageInner.svelte`'s `computeInitialValues()`, which
reads `?prefill_title` / `?prefill_body` / `?prefill_tags` synchronously at
script-init (see `src/components/forum/kiosk/CLAUDE.md` for why it must be
synchronous, not `onMount`).

- **Aufruf CTA** (`BeilageIndex.svelte`'s `aufrufCard` snippet, novel §06) —
  `callHref` = `/topics/create?prefill_title=<localized prompt>&prefill_tags=blogidee`.
  No `prefill_body`. Seeds the compose form pre-tagged `#blogidee` so
  community "story ideas" land in a discoverable rubric.
- **Forum-CTA** (`BlogArticleFooter.svelte`, novel §04, the article footer's
  wine card) — `discussHref` = `/topics/create?prefill_title=<prefix + post
  title>&prefill_body=<article URL>`. No `prefill_tags`. This is **the only
  wine element on the entire article page** — everything else is
  ink/rust/paper. Nothing auto-posts; both CTAs only pre-fill the compose
  form, the user still has to submit.

## Draft gating semantics

- **Detail route** (`[...slug].astro`): `!data.draft || !import.meta.env.PROD`
  — a draft entry resolves (200) in dev, 404s in prod. This is the only
  PROD-conditional gate in the blog.
- **Listing routes** (index, tag page): filter is the unconditional
  `!data.draft`, with **no** `PROD` check — a draft is invisible in every
  listing (list, archive counts, rubric counts, related rail, № n/N ranking)
  in both dev and prod. So in dev a draft is reachable directly by URL but
  never discoverable through browsing.

## Gallery grid is dormant in the shipped content

`BlogGalleryGrid.svelte` renders nothing (`{#if images.length > 0}`) when
`galleryImages` is empty — and no shipped post sets `galleryImages` (the
former `postLayout: 'gallery'` example post is deleted); gallery pictures can
also just live in the MDX body like any other post. Don't treat an empty grid
as a bug. When gallery images ARE
present, `GalleryLayout.astro` builds each `alt` from `coverAlt` — captions
are `${post.data.coverAlt} (${i + 1})`, there's no per-image caption field in
the content schema.

## States matrix (novel §09)

| State | Where | Trigger |
|---|---|---|
| 01 — no posts at all | `BeilageIndex.svelte` | `posts.length === 0` (whole collection empty) |
| 02 — filtered to zero | `BeilageIndex.svelte` | `isFiltered && pageItems.length === 0` (search/tag/month AND-combination yields nothing) |
| 03 — Leere Rubrik | `BeilageTagPage.svelte` | unknown or currently-empty tag; renders at HTTP 200 |
| 04 — draft | `[...slug].astro` | see "Draft gating" above |

## Decision 9 — lead card only on unfiltered page 1 (exception: simultaneous posts, see below)

`BeilageIndex.svelte`'s `showLead` derived is
`!isFiltered && page === 0 && pageItems.length > 0` — the large lead card only
ever appears on the true front page (no active search/tag/month filter, first
page). Any filter or pagination collapses the layout to the plain newspaper
column grid; there is no "lead" concept once you're inside a filtered/paged
view.

## Simultaneous posts — order, equal treatment, guest authors (2026-09-18, election guest posts)
Four candidates' guest posts (`src/content/blog/wahl2026-<surname>.mdx`, tag `wahl2026`) were published in ONE push with the IDENTICAL `pubDate`. Three rules came out of it; all live in `beilage.ts` and are tested in `src/lib/blog/beilage.test.ts`.

- **One order for every list: `compareNewest()`** — newest first, equal timestamps fall back to the file id A→Z. Index, tag page, `relatedFor()` and `rankOf()` (exact reverse, so № counts down the listed order) all go through it. The ids are `wahl2026-<surname>` ON PURPOSE: the titles start with the first name, so a title tiebreak would sort Bahar, Charlotte, Michael, Philipp. Before this rule, the order of same-timestamp posts was whatever the glob loader returned.
- **`isSimultaneous()` → equal prominence.** A post that shares its exact timestamp with another never gets the index lead card (Decision 9 gains this exception). Photo strips: since 13:40 the same day (user wanted photos on the index) ALL simultaneous posts get a strip of the same height — 150 px instead of the ordinary 110, because at 110 a portrait is cut at the nose — and a post without a cover gets the `initialsOf(author)` plate, same as on the tag page. First version had been „no strip for any of them". Otherwise alphabetical order turns into a big photo + „NEU" strap for one candidate, a nose-cropped strip for the second and nothing for the rest — and a candidate who sent no photo is visibly worse off. A later editorial intro has its own timestamp, is not simultaneous, and takes the lead card normally.
- **Phones show ONE list.** The index's two newspaper columns are filled alternately (`col1` = items 0,2,4 · `col2` = 1,3,5). Side by side that reads in order; stacked at `grid-cols-1` it showed 0,2,4,1,3,5 — on a phone the live order was Dehne, Lüders, the August guide, Haghanipour, Mende. An old bug, invisible while post order carried no meaning. `BeilageIndex.svelte` now renders a single in-order list below `md` and the two-column grid from `md` up. Measure reading order with `scratchpad/wahl2026/order-check.cjs` (sorts visible links by row then column at 390 and 1400) — DOM order is NOT reading order here.
- **`relatedSlots()` — the rail never drops a member of the group.** Normally 3 related posts. When a post's tag-mates include same-second posts, the rail shows ALL tag-mates (cap 8). With the editorial intro (`wahl2026-einladung`, own later timestamp → takes the index lead card and the first place on the tag page) sharing the tag, three slots dropped the last candidate in the alphabet from every candidate page, and the intro itself listed three of four.
- **Link-preview cards (`ogImage`).** Every post already served full og/twitter tags with the cover as image — but the RAW cover: platforms crop it to ~1.91:1 from the centre (a square portrait loses the top of the head) and no size was declared (`SeoHead` only knows the default's 1200×630 and refuses to guess — keep that rule). Optional schema field `ogImage: image()` = a dedicated, committed 1200×630 asset; `ArticleShell` prefers it over the cover and passes its REAL width/height + `coverAlt` down (`KioskLayout` → `SeoHead`: `imageWidth`/`imageHeight`/`imageAlt`). Made with `scratchpad/wahl2026/og.mjs` (a 2000×1050 crop with a per-photo top offset, checked by eye). A post without a photo and the tag page use the series illustration `wahl2026-og.jpg`. Promoted tag pages get real preview copy via `TAG_META` in `pages/blog/tag/[tag].astro`; other tags keep the generic wording. **Platforms cache a link's preview on first share** — fix the card BEFORE the link is sent out; afterwards only the platform's own re-scrape tools help. Check with `scratchpad/wahl2026/og-check.sh <base>` (declared vs actual size per page).
- **`lede: false` for verbatim guest posts.** Every article sets its first paragraph larger (`.bl-prose > p:first-child`). Same rule, unequal effect: one candidate's long opening paragraph was enlarged, the others' one-line greeting, date line and headline. The schema flag `lede` (default `true`) adds `.bl-prose--nolede` in all three layouts; the four guest posts set it to `false`. Rejected: „enlarge the first two paragraphs when the first is short" — it makes the amount of emphasis depend on how someone happened to open. The larger first paragraph is OUR emphasis, and a verbatim text gets none.
- **No cover → initials plate on the tag page**, not an empty box (`BeilageTagPage.svelte`, `initialsOf(author)`). An empty beige box reads as a broken image and singles out the one author who sent no photo. The index shows no photos for simultaneous posts at all; the tag page shows them, so it needs the plate.
- **Author on the cards.** `BlPostMeta` printed the localized „Mahalle-Team" unconditionally — on a candidate's text that reads as Mahalle's words. It now shows `post.author` unless it is the schema default `'Mahalle Team'`; index + tag page serialize `author`. Side effect, correct: the manifest now shows its real author.

**Recipe for the next guest post (docx + photo):**
1. Text: `scratchpad/wahl2026/docx2md.py` reads the docx with the stdlib (a docx is a zip with XML; no pandoc / python-docx installed). Verbatim means verbatim — typos stay.
2. Escape `\ ` * _ { } [ ] < > ~ | #` in the body (MDX treats them as markup; „Nachbar*innen" is the classic). **Astro's smartypants curls straight quotes** — a candidate's `"Ehrlich.` became `“Ehrlich.`; write a straight double quote as `{'"'}` in the body.
3. Prove it: `scratchpad/wahl2026/verify.cjs` renders each post on a dev server and checks that every source sentence appears in order, whitespace-normalised. It is what caught the curled quote.
4. Photo: `scratchpad/wahl2026/photos.mjs` — sharp, `.rotate()` first (bakes in EXIF orientation), max 2000 px, JPEG, NO metadata (one supplied photo carried a private description line and camera data). `coverCredit: "privat"` (press convention for a photo supplied by the person), and a per-photo `coverPosition` checked by eye on the article header — faces sit in the upper third. `cover` is optional; every surface handles a post without one.
5. Same neutral `description` template for all, no summary of positions. Same two footer lines. No funding logo (the blog is not part of the funded events).
6. A blog post is a DEPLOY — mind the event freeze windows.

## Content collection schema (`src/content.config.ts`)

`postLayout: 'standard' | 'hero' | 'gallery'` (default `'standard'`),
`draft: boolean` (default `false`), `cover`/`coverAlt`/`galleryImages`
optional, `tags: string[]` (default `[]`). One post ships today
(`das-mahalle-manifest.mdx`, `standard`); the old six stock-photo examples
are gone.

### Cover knobs (Aug 2026)

Three optional frontmatter fields, all plumbed through `BlogPostCard` in
`src/lib/blog/beilage.ts` and the three blog pages:

- **`coverCredit` + `coverCreditUrl`** — attribution line under the article
  cover. When set, `BlogArticleHeader.svelte` renders
  `FOTO: <credit>` (linked, `rel="noopener license"`) instead of the default
  i18n line `blog.photo.credit` („FOTO: MAHALLE-TEAM"). **Mandatory for any
  third-party image** — the default line would misattribute it. Route for
  third-party pictures is Wikimedia Commons CC (author, license, link to the
  file page); press photos (Berliner Kurier etc.) are off-limits even with
  credit.
- **`coverPosition`** — CSS `object-position` for the crop (`"bottom"`,
  `"center 80%"`…), default `center`. Applied at all four render sites
  (article header, index lead, index cards, tag page).
- **`coverFit: 'crop' | 'full'`** — article header only. `crop` (default) is
  the fixed-height band (`h-[170px] lg:h-[330px]`, `object-cover`); `full`
  drops the height and shows the whole image at native aspect. Index/tag
  thumbnails always crop regardless.

Cover images live next to the posts in `src/content/blog/images/` and go
through Astro's `image()` pipeline (resize + WebP), so a ~1900px JPEG is fine
as source.

## Tokens

`tokens.css`: `[data-page="blog"] { --k-accent: var(--k-rust); }` —
`--k-rust: #a3552e` is the carved-italic accent (straps, progress fill,
kickers), `--k-rust-deep` for hover/back-links, `--k-rust-tint` for the
Aufruf card background. Page-accent rule: rust is Blog's color across the
whole site (see root CLAUDE.md's page-accent table) — same "don't touch
semantic accents" carve-outs apply (wine stays wine on the Forum-CTA, live
indicators etc. stay whatever they were).

## Audit record (2026-09-10, 4 passes: visual / functional / routes-SSR / mobile @390)

0 critical, 10 important, 5 minor — all importants shipped the same night
(`95f668c6` + peer `29769aec`):

- **Cache headers**: all three blog routes now send
  `Cache-Control: no-store, must-revalidate` like every other session-aware
  SSR page — `KioskLayout` reads the session for the nav, so the HTML varies
  per viewer and must never sit in a shared cache. Any new blog route gets
  the same line.
- **Cover `width`/`height`**: `BlogPostCard` carries `coverWidth`/`coverHeight`
  (`image().width/height`) and `BlogArticleHeader` puts them on both `<img>`
  sites. Only `coverFit: 'full'` posts actually shifted layout (crop mode is
  pinned by its fixed-height band), but the attributes are harmless there.
- **Rubric chip count**: `BlRubrikChip` renders `{' '}{n}` — a literal space
  inside the span gets trimmed by Svelte's whitespace handling, which glued
  the count to the tag (`#community1`).
- **Search bar**: the wrapper is a `<label>` (any tap on the bar focuses the
  input), ≥44px on touch viewports, `focus-within` outline for keyboard users
  (the input itself keeps `outline: none`).
- **Tap targets (peer)**: `BlRubrikChip` is a tap-box (bare 44px `a`/`button`
  with the painted pill in an inner snippet) rather than a `.kiosk-tap`
  extender — the index's `overflow-x-auto` chip row clips the extender to the
  scroller's box (measured 28px). Read-bar back link, pagination buttons and
  the Archiv month row are ≥44px too; the pagination row wraps as two units
  (page-size cluster / arrow cluster) at phone width.
- **Fallback domain**: `ArticleShell.astro`'s QR/canonical fallback literal is
  `mahalle.digital` (was the stale `mahalle.berlin`; only reachable when
  `NEXTAUTH_URL` is unset in prod).

Verified non-issues (don't re-file): dev-server `/@fs/` image paths and
`localhost:3000` in the QR are `NEXTAUTH_URL`/Vite artifacts; the 65px strip
above the masthead on a fresh profile is the tour offer; `/blog/tag/<unknown>`
returning 200 is deliberate; search has no diacritic folding (unspecified);
the DE/EN toggle drifts scroll by ~19px on the index (string-length reflow).
Minor left open: the FOTO credit link and the footer license link are
prose-height links (accepted).
