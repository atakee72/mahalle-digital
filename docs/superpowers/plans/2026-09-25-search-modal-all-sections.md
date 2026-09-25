# Site Search — Modal over All Sections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The masthead magnifier opens a centred search modal over a blurred scrim that searches ALL five member sections — Forum (posts + comments), Kalender, Markt, News (Kurier), Blog — shows the top hits per section live while typing, and hands over to `/search?q=`, which lists every hit grouped by section with section chips.

**Architecture:** One endpoint, one result shape. `GET /api/search` keeps its gate, query rules and rate limit but now answers a `SiteSearchResult` (`{ q, hits: { forum, calendar, marketplace, news, blog } }`, every value an array of the unified `SiteHit` row) from a new server orchestrator `searchSite()` that runs the shipped `searchForum()` plus three Mongo legs (events, listings, news) and one in-memory leg (blog content collection) in parallel — each leg under exactly the visibility filter its own index page uses. Two islands consume it through one shared runes module (`createSearchRunner()`: debounce 250 ms, last request wins, `pending` state): the new `SearchModal.svelte` (mounted by `KioskNav` as the last child of `<header>`, scrim + box as siblings, `lockPageScroll()`, focus trap, Escape/scrim close, focus back to the disc) and the rewritten `SearchPage.svelte` (moved to `src/components/search/`, section chips, `?q=&s=`). The strip under the bar and the inline field from 09-24/09-25 are deleted; the disc stays.

**Tech Stack:** Astro 5 (`astro:content` for the blog leg), Svelte 5 runes incl. a `.svelte.ts` module, MongoDB driver regex queries, Tailwind utilities + `.sm-*` rules in `global.css` (nested-island rule), `node:test` via `npx tsx --test`, Playwright probes on the dev server :4655.

**Spec:** User decisions 2026-09-25 morning (no separate spec file): (1) „i didnt like the idea to slide to the left to open the search field.. what if a click on the search button there opens the search field something like a modal in the middle of the page with a background blurring everything behind?"; (2) „all or nothing — if we build a search function, we should give them either complete or nothing at all — a halfway search wouldnt bring anything but frustration"; (3) „we will ship it today, no worries". Plus the handoff's modal rules: blurred scrim, box a sibling of the scrim, upper third on phones, `lockPageScroll` html-only, Escape/scrim close, focus back to the disc, live top hits + „alle Treffer →" to `/search`. Prior plans this one supersedes in the masthead: `docs/superpowers/plans/2026-09-24-forum-search.md` (Task 5), `2026-09-25-search-inline-desktop.md`.

## Audit 2026-09-25 11:05 (assumptions checked against the code)

- `$t` is `Record<keyof typeof de, string>` (`kiosk-i18n.ts:2085`) → `SECTION_LABEL_KEY` typed as a literal union, never `string`.
- Node 24 ICU: de-DE „Sa., 26.09.", en-GB „Sat 26/09" (no comma), `hourCycle: 'h23'` → „10:00", en-CA → `2026-09-27` for 22:30 Z. Test strings match.
- `.svelte.ts` rune modules: `@sveltejs/vite-plugin-svelte` 5.1.1 (`DEFAULT_SVELTE_MODULE_EXT`), `@astrojs/svelte` 7.2.5 — supported; first such module in this repo.
- `astro:content` from `src/lib`: precedent `src/pages/sitemap.xml.ts` (a `.ts` module) type-checks today.
- Seed dev DB: „Test" appears in forum posts and events regardless of the seed's age (listings go stale after 21 days) → probes query „Test".
- 9 blog posts carry the tag `wahl2026` → the blog probe check (≥ 4) holds.
- `<header>` has no `transform`/`overflow` → fixed scrim + box escape it; `--k-radius-md` and `.kiosk-tap` exist.
- `tick` in `KioskNav.svelte` is used only inside the deleted search block → its import goes (Task 4 Step 3a).

## Global Constraints

- **All five sections or nothing**: the response ALWAYS carries all five keys (`forum`, `calendar`, `marketplace`, `news`, `blog`), each an array (possibly empty). No leg may be silently skipped: if a leg throws, the whole request fails (500 → the islands show „nicht erreichbar"). The idle hint in the modal names all five sections.
- **Visibility = the section's own index page, no more, no less** (copied from the research 2026-09-25): events `buildModerationFilter(userId)` from `src/lib/topicsQuery.ts` (no month window — a member may find a past event); listings `buildListingsFilter(userId)` from `src/lib/listingsQuery.ts` with NO `ownerScope` (approved/legacy/reported-pending/own, status `available|reserved` and `max(lastBumpedAt, createdAt) ≥ now − 21 d`, plus the caller's own listings of any status/age — exactly the browse grid); news the filter of `GET /api/news` (`src/pages/api/news/index.ts:29-38`: approved, or the caller's own pending/rejected via `submittedBy` — no `$exists:false` arm, no reported-pending arm, no 7-day window); blog `!data.draft` unconditionally (index/tag-page rule, not the detail page's dev-only draft exposure); forum unchanged (`searchForum()`).
- **Searchable fields per section**: events `title`, `body`, `location`, `tags`; listings `title`, `descriptionPlainText`; news `title`, `description`, `sourceName`; blog `title`, `description`, `tags`, plain body (MDX stripped). Forum unchanged (`title`, `body`, `tags`; comments `body`).
- **Detail URLs**: forum as shipped (`PATH_BY_KIND`, `#comment-<id>`); event `/calendar?event=<id>&d=YYYY-MM-DD` with `d` = the event's start day in **Europe/Berlin** (mirrors `EventDetailModal.shareUrl()`, which formats in the browser's local time; the server runs UTC, so the zone must be explicit); listing `/marketplace/<id>`; news `/newsboard/<id>`; blog `/blog/<entry.id>`.
- **Query rules unchanged**: `normalizeQuery` 2–80 chars, regex-escaped, case-insensitive; `excerptAround` ≤ 160 chars; per section max 20 hits (`SEARCH_PER_SECTION = 20`; forum keeps its own 30 posts + 20 comments). Rate limit `search:<userId>` 300/h unchanged. Responses `Cache-Control: no-store` **and** `Vary: Cookie` (the answer varies by session).
- **Never ship a raw body, a full user document or an e-mail**: rows carry `excerpt`, not `body`/`description`; forum authors stay `{ name, handle }` from `populateAuthors()`; listings ship no seller field (the detail page does the seller join); news ships `sourceName` only.
- **Modal DOM contract**: `<div class="sm-scrim">` and `<div id="site-search" class="sm-box" role="dialog" aria-modal="true">` are SIBLINGS (the blur on the scrim must never be an ancestor of the box — root CLAUDE.md, `backdrop-filter` containing block); mounted as the last child of `<header>` in `KioskNav.svelte` so the header's `z-50` (already bumped by `searchOpen`) covers the fixed bottom nav; box `max-width: 640px`, `left/right: 16px`, top `8dvh` on phones (upper third, room for the keyboard) and `14vh` from `md`; scroll locked with `lockPageScroll()` from `src/lib/scrollLock.ts` (html-only — never body); the input gets focus on open; Escape and a scrim click close; Tab cycles inside the box; closing by Escape or from inside the box returns focus to the disc; instant close (no exit animation — the notification panel's ruling); open animation 160/180 ms, none under `prefers-reduced-motion: reduce`.
- **Styles**: `.sm-*` block in `src/styles/global.css` after the `.ms-*` disc rules; the strip/inline rules (`.ms-strip`, `.ms-strip__inner`, `.ms-field`, `.ms-close`, `.ms-inline`, `.ms-field--inline`, `@keyframes ms-inline-in`, the reduced-motion `.ms-inline` line) are deleted. Row and page styling uses Tailwind utilities inline. No `<style>` block in any new `.svelte` file (nested-island rule).
- **Copy**: all strings through `kiosk-i18n.ts`, BOTH dictionaries; every new string is a DRAFT the user rewords (his rule). Section labels reuse `nav.forum` / `nav.calendar` / `nav.marketplace` / `nav.news` / `nav.blog` (there is no `nav.newsboard` key; the nav says „News").
- **`search.astro`**: passes `tour={false}` (the forum tour was offered on a page without its anchors — open since 09-24) and NO `page` (site-wide page → app-level ochre bars, like `/profile`).
- **Gates before push**: `npx tsx --test src/lib/search/siteSearch.test.ts` and `src/lib/forum/searchQuery.test.ts` green; `pnpm type-check` ≤ 23 errors; `npx -y svelte-check@4` ≤ 89 errors; `pnpm build` green; probes `scratchpad/site-search-probe.mts`, `scratchpad/search-page-probe.cjs`, `scratchpad/search-modal-probe.cjs` all green. Commit messages one line, only named files staged (`scratchpad/` is gitignored — probes stay local). Push on the user's word; prod check after the deploy (`fra1::fra1`, logged-out 401, logged-in query returns all five keys, modal opens on prod). Freeze Fri 25 Sept evening → Sat 16:30.

## Review Focus

1. **A rejected or deleted-parent item must never surface in any section** — a rejected event of another member, a listing older than 21 days that is not the caller's, a pending News submission of another member, a draft blog post. Pinned: Task 1 (blog draft, unit test) + Task 2 (`site-search-probe.mts`: rejected event hidden; stale listing hidden for jonas, visible for its owner ayse; pending news hidden for jonas, visible for its submitter ayse).
2. **Event day in the link crosses midnight in Berlin, not UTC**: an event at `2026-09-26T22:30:00Z` starts on the 27th in Berlin (CEST). Pinned: Task 1 unit test `eventHref` → `d=2026-09-27`.
3. **The modal must not scroll the page away under the scrim and must keep the bar visible**: open at `scrollY 400`, wheel/scrollBy → `scrollY` unchanged, `<html>` overflow hidden, header `top` 0. Pinned: Task 4 probe (`page scroll locked`, `header not hidden`).
4. **Keyboard users**: focus lands in the input; ArrowDown reaches the first hit; Tab from the last focusable wraps to the input; Escape returns focus to the disc. Pinned: Task 4 probe.
5. **Empty-state flash and stale hits while typing** (the 09-24 review finding, now in two islands): during the debounce neither „Nichts gefunden" nor the previous query's hits show. Pinned: Task 3 page probe (existing check kept) + Task 4 modal probe (`no stale hits mid-debounce`).

---

### Task 1: Pure module `src/lib/search/siteSearch.ts` — TDD

**Files:**
- Create: `src/lib/search/siteSearch.ts`
- Create: `src/lib/search/siteSearch.test.ts`

**Interfaces:**
- Consumes: `buildSearchRegex`, `excerptAround`, `SearchResult`, `PostKind` from `src/lib/forum/searchQuery.ts` (pure); `compareNewest` from `src/lib/blog/beilage.ts` (pure).
- Produces (later tasks copy these names verbatim): types `SearchSection`, `HitKind`, `SiteHit`, `SiteSearchResult`, `BlogSearchEntry`; constants `SECTIONS`, `SECTION_LABEL_KEY`, `SECTION_ACCENT`, `SEARCH_PER_SECTION = 20`, `MODAL_PER_SECTION = 3`; functions `berlinDay(d)`, `eventHref(id, startDate)`, `eventDayLabel(iso, locale, allDay)`, `plainMdx(body)`, `searchBlogEntries(entries, q, max?)`, `forumToHits(r)`, `emptyHits()`, `countHits(r)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/search/siteSearch.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTIONS, SEARCH_PER_SECTION, berlinDay, eventHref, eventDayLabel, plainMdx,
  searchBlogEntries, forumToHits, emptyHits, countHits, type BlogSearchEntry, type SiteSearchResult,
} from './siteSearch';

test('SECTIONS: the five member sections in nav order', () => {
  assert.deepEqual(SECTIONS, ['forum', 'calendar', 'marketplace', 'news', 'blog']);
});

test('berlinDay + eventHref: the event day is Berlin time, not UTC', () => {
  assert.equal(berlinDay(new Date('2026-09-26T22:30:00Z')), '2026-09-27'); // CEST +2
  assert.equal(berlinDay(new Date('2026-12-31T23:30:00Z')), '2027-01-01'); // CET +1
  assert.equal(berlinDay('2026-09-26T08:00:00.000Z'), '2026-09-26');
  assert.equal(eventHref('abc', new Date('2026-09-26T22:30:00Z')), '/calendar?event=abc&d=2026-09-27');
  assert.equal(eventHref('abc', 'not a date'), '/calendar?event=abc'); // no `d` rather than a wrong one
  assert.equal(eventHref('abc', null), '/calendar?event=abc');
});

test('eventDayLabel: weekday + day.month (+ time unless all-day), Berlin zone', () => {
  const iso = '2026-09-26T08:00:00.000Z'; // 10:00 Berlin
  assert.equal(eventDayLabel(iso, 'de', false), 'Sa., 26.09. · 10:00');
  assert.equal(eventDayLabel(iso, 'de', true), 'Sa., 26.09.');
  assert.equal(eventDayLabel(iso, 'en', false), 'Sat 26/09 · 10:00'); // en-GB: no comma after the weekday
  assert.equal(eventDayLabel(null, 'de', false), '');
  assert.equal(eventDayLabel('nope', 'de', false), '');
});

test('plainMdx: imports, tags and markdown syntax go, words stay', () => {
  const body = `import Foo from '../x.astro';\n\n# Titel\n\n<Foo prop="1" />\nDer **Schillermarkt** findet [hier](/x) statt.\n\n> Zitat\n\n![alt](img.jpg)`;
  assert.equal(plainMdx(body), 'Titel Der Schillermarkt findet hier statt. Zitat alt');
  assert.equal(plainMdx(''), '');
});

const entry = (over: Partial<BlogSearchEntry>): BlogSearchEntry => ({
  id: 'p', title: 'T', description: 'D', tags: [], author: 'A', draft: false,
  pubDateISO: '2026-09-01T00:00:00.000Z', body: '', ...over,
});

test('searchBlogEntries: drafts never, matches title/description/tags/body, newest first, capped', () => {
  const entries = [
    entry({ id: 'draft', title: 'Schillermarkt geheim', draft: true }),
    entry({ id: 'old', title: 'Alt', body: 'Der Schillermarkt war schön.', pubDateISO: '2026-08-01T00:00:00.000Z' }),
    entry({ id: 'tagged', tags: ['schillermarkt'], pubDateISO: '2026-09-10T00:00:00.000Z' }),
    entry({ id: 'desc', description: 'Rund um den Schillermarkt', pubDateISO: '2026-09-05T00:00:00.000Z' }),
    entry({ id: 'none', title: 'Nichts', body: 'nichts' }),
  ];
  const hits = searchBlogEntries(entries, 'schillermarkt');
  assert.deepEqual(hits.map((h) => h.id), ['tagged', 'desc', 'old']);
  assert.equal(hits[0].section, 'blog');
  assert.equal(hits[0].kind, 'post');
  assert.equal(hits[0].href, '/blog/tagged');
  assert.equal(hits[0].sub, 'A');
  assert.equal(hits[2].excerpt, 'Der Schillermarkt war schön.'); // body match → excerpt around it
  assert.equal(hits[1].excerpt, 'Rund um den Schillermarkt');     // no body match → description
  assert.equal(searchBlogEntries(entries, 'schillermarkt', 1).length, 1);
  // sortDate (order-only) wins over pubDate, like the blog index
  const late = entry({ id: 'late', title: 'Schillermarkt', pubDateISO: '2026-09-20T00:00:00.000Z', sortISO: '2026-08-15T00:00:00.000Z' });
  assert.deepEqual(searchBlogEntries([...entries, late], 'schillermarkt').map((h) => h.id), ['tagged', 'desc', 'late', 'old']);
});

test('forumToHits: posts then comments, comment title = parent title', () => {
  const r = {
    q: 'x',
    posts: [{ _id: 'p1', kind: 'announcement' as const, href: '/announcements/p1', title: 'A', excerpt: 'e', tags: ['t'], date: '2026-09-01T00:00:00.000Z', author: { name: 'Ayşe', handle: 'ayse' } }],
    comments: [{ _id: 'c1', href: '/topics/p2#comment-c1', excerpt: 'ce', date: null, parentTitle: 'Parent' }],
  };
  const hits = forumToHits(r);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], { section: 'forum', kind: 'announcement', id: 'p1', href: '/announcements/p1', title: 'A', excerpt: 'e', date: '2026-09-01T00:00:00.000Z', sub: 'Ayşe', tags: ['t'] });
  assert.deepEqual(hits[1], { section: 'forum', kind: 'comment', id: 'c1', href: '/topics/p2#comment-c1', title: 'Parent', excerpt: 'ce', date: null, sub: null });
});

test('emptyHits + countHits: all five keys always present', () => {
  const r: SiteSearchResult = { q: 'x', hits: emptyHits() };
  assert.deepEqual(Object.keys(r.hits), ['forum', 'calendar', 'marketplace', 'news', 'blog']);
  assert.deepEqual(countHits(r), { total: 0, bySection: { forum: 0, calendar: 0, marketplace: 0, news: 0, blog: 0 } });
  r.hits.news.push({ section: 'news', kind: 'news', id: 'n', href: '/newsboard/n', title: 't', excerpt: '', date: null, sub: 'Quelle' });
  assert.equal(countHits(r).total, 1);
  assert.equal(countHits(r).bySection.news, 1);
  assert.equal(SEARCH_PER_SECTION, 20);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/lib/search/siteSearch.test.ts`
Expected: FAIL — `Cannot find module './siteSearch'`.

- [ ] **Step 3: Write the module**

```ts
// src/lib/search/siteSearch.ts
// Site-wide search — PURE (no driver, no astro:content): row types shared by
// the API, the results page and the masthead modal, the per-section
// constants, the event-link/day helpers and the in-memory blog leg. The
// Mongo legs live in siteSearchStore.ts (server). 2026-09-25.
import { buildSearchRegex, excerptAround, type PostKind, type SearchResult } from '../forum/searchQuery';
import { compareNewest } from '../blog/beilage';

export type SearchSection = 'forum' | 'calendar' | 'marketplace' | 'news' | 'blog';
export const SECTIONS: readonly SearchSection[] = ['forum', 'calendar', 'marketplace', 'news', 'blog'];

/** Label key in kiosk-i18n (the nav's own words). Literal union, not string:
 *  `$t` is a Record over the dictionary's keys, a plain string index would
 *  not type-check (tsc budget). */
export type SectionLabelKey = 'nav.forum' | 'nav.calendar' | 'nav.marketplace' | 'nav.news' | 'nav.blog';
export const SECTION_LABEL_KEY: Record<SearchSection, SectionLabelKey> = {
  forum: 'nav.forum', calendar: 'nav.calendar', marketplace: 'nav.marketplace', news: 'nav.news', blog: 'nav.blog',
};
/** Kicker colour per section on paper — the page accents; Markt takes the
 *  darker ochre of its floating „+" (plain ochre has no contrast on paper). */
export const SECTION_ACCENT: Record<SearchSection, string> = {
  forum: 'var(--k-wine)', calendar: 'var(--k-teal)', marketplace: '#b97a1a', news: 'var(--k-ink)', blog: 'var(--k-rust)',
};

export const SEARCH_PER_SECTION = 20; // per non-forum section; the forum keeps 30 posts + 20 comments
export const MODAL_PER_SECTION = 3;   // live hits per section in the masthead modal

export type HitKind = PostKind | 'comment' | 'event' | 'sell' | 'exchange' | 'gift' | 'news' | 'post';

export interface SiteHit {
  section: SearchSection;
  kind: HitKind;
  id: string;
  href: string;
  title: string;          // comment: the parent post's title
  excerpt: string;        // ≤ 160 chars around the first match — never a body
  date: string | null;    // ISO: forum/news/blog published, calendar START, listing updated
  sub: string | null;     // one secondary label: author name · event location · news source · blog author
  tags?: string[];
  price?: number | null;  // listings of kind 'sell'
  allDay?: boolean;       // events
}

export interface SiteSearchResult {
  q: string;
  hits: Record<SearchSection, SiteHit[]>;
}

export function emptyHits(): Record<SearchSection, SiteHit[]> {
  return { forum: [], calendar: [], marketplace: [], news: [], blog: [] };
}

export function countHits(r: SiteSearchResult): { total: number; bySection: Record<SearchSection, number> } {
  const bySection = { forum: 0, calendar: 0, marketplace: 0, news: 0, blog: 0 } as Record<SearchSection, number>;
  let total = 0;
  for (const s of SECTIONS) { bySection[s] = r.hits[s]?.length ?? 0; total += bySection[s]; }
  return { total, bySection };
}

// ─── Calendar helpers ──────────────────────────────────────────────────
function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** YYYY-MM-DD of an instant in Europe/Berlin (en-CA prints ISO order). */
export function berlinDay(v: unknown): string | null {
  const d = toDate(v);
  if (!d) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Same link the event modal's „teilen" builds — `d` lands the calendar on
 *  the right month; without a valid start there is no `d` at all. */
export function eventHref(id: string, startDate: unknown): string {
  const d = berlinDay(startDate);
  return d ? `/calendar?event=${id}&d=${d}` : `/calendar?event=${id}`;
}

/** „Sa., 26.09. · 10:00" / "Sat 26/09 · 10:00" — all-day drops the time. */
export function eventDayLabel(iso: string | null | undefined, locale: 'de' | 'en', allDay: boolean): string {
  const d = toDate(iso);
  if (!d) return '';
  const tag = locale === 'de' ? 'de-DE' : 'en-GB';
  const day = new Intl.DateTimeFormat(tag, { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit' }).format(d);
  if (allDay) return day;
  const time = new Intl.DateTimeFormat(tag, { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${day} · ${time}`;
}

// ─── Blog leg (in memory — the collection is 12 files, not a table) ────
export interface BlogSearchEntry {
  id: string;            // = the slug (/blog/<id>)
  title: string;
  description: string;
  tags: string[];
  author: string;
  draft: boolean;
  pubDateISO: string;
  sortISO?: string;      // order-only `sortDate`, like the blog index
  body: string;          // raw MDX
}

/** Raw MDX → searchable words: import/export lines, JSX tags, markdown
 *  link/image syntax and emphasis marks go; whitespace collapses. */
export function plainMdx(body: string): string {
  if (!body) return '';
  return body
    .replace(/^(import|export) .*$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')   // ![alt](src) → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ')    // [text](href) → text
    .replace(/<[^>]+>/g, ' ')                      // JSX / HTML tags
    .replace(/^[#>\s]+/gm, ' ')                    // headings, quotes
    .replace(/[*_`~]/g, '')                        // emphasis, code marks
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchBlogEntries(entries: BlogSearchEntry[], q: string, max = SEARCH_PER_SECTION): SiteHit[] {
  const rx = buildSearchRegex(q);
  return entries
    .filter((e) => !e.draft)
    .map((e) => ({ e, plain: plainMdx(e.body) }))
    .filter(({ e, plain }) => rx.test(e.title) || rx.test(e.description) || e.tags.some((t) => rx.test(t)) || rx.test(plain))
    .sort((a, b) => compareNewest(a.e, b.e))
    .slice(0, max)
    .map(({ e, plain }) => ({
      section: 'blog' as const, kind: 'post' as const, id: e.id, href: `/blog/${e.id}`,
      title: e.title,
      excerpt: rx.test(plain) ? excerptAround(plain, q) : e.description,
      date: e.pubDateISO, sub: e.author, tags: e.tags,
    }));
}

// ─── Forum leg adapter (searchForum() rows → SiteHit) ──────────────────
export function forumToHits(r: SearchResult): SiteHit[] {
  const posts: SiteHit[] = r.posts.map((p) => ({
    section: 'forum', kind: p.kind, id: p._id, href: p.href, title: p.title, excerpt: p.excerpt,
    date: p.date, sub: p.author?.name ?? null, tags: p.tags,
  }));
  const comments: SiteHit[] = r.comments.map((c) => ({
    section: 'forum', kind: 'comment', id: c._id, href: c.href, title: c.parentTitle, excerpt: c.excerpt,
    date: c.date, sub: null,
  }));
  return [...posts, ...comments];
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test src/lib/search/siteSearch.test.ts`
Expected: 7 tests PASS. If `eventDayLabel` differs by one punctuation mark in this Node's ICU (e.g. `Sa.,` vs `Sa,`), fix the EXPECTATION to what `Intl` prints here — prod (Vercel Node 20/24, full ICU) prints the same as local Node ≥ 18 with full ICU; note the actual string in the commit message.

- [ ] **Step 5: Commit**

```bash
git add src/lib/search/siteSearch.ts src/lib/search/siteSearch.test.ts
git commit -m "site search: pure row types, Berlin event day, blog leg, forum adapter (tests)"
```

---

### Task 2: Server orchestrator, blog loader, `GET /api/search` on all sections, `search.astro` SSR — API probe

**Files:**
- Create: `src/lib/search/siteSearchStore.ts`
- Create: `src/lib/search/blogEntries.ts`
- Modify: `src/pages/api/search.ts` (whole file)
- Modify: `src/pages/search.astro` (frontmatter imports + query; the island line changes in Task 3)
- Create: `scratchpad/site-search-probe.mts` (gitignored)

**Interfaces:**
- Consumes: Task 1 (`SiteHit`, `SiteSearchResult`, `emptyHits`, `forumToHits`, `searchBlogEntries`, `eventHref`, `SEARCH_PER_SECTION`, `BlogSearchEntry`); `searchForum(db, q, userId)` from `src/lib/forum/searchStore.ts`; `buildModerationFilter(userId)`, `mergeModerationFilter(filter, mod)` from `src/lib/topicsQuery.ts`; `buildListingsFilter(userId)` from `src/lib/listingsQuery.ts` (returns `{ $and: [...] }`); `buildSearchRegex`, `excerptAround`, `normalizeQuery` from `src/lib/forum/searchQuery.ts`; `consumeRateLimit` from `src/lib/auth/rateLimit.ts`.
- Produces: `searchSite(db: Db, q: string, userId: string | undefined, blog: BlogSearchEntry[]): Promise<SiteSearchResult>`; `loadBlogSearchEntries(): Promise<BlogSearchEntry[]>`; `GET /api/search?q=` → `SiteSearchResult` JSON with `Cache-Control: no-store`, `Vary: Cookie`.

- [ ] **Step 1: Server store**

```ts
// src/lib/search/siteSearchStore.ts
// SERVER-ONLY (driver). Five legs in parallel, each under the visibility
// filter of its own index page (research 2026-09-25, see the plan):
//   forum   → searchForum() unchanged (buildModerationFilter, comments under their parent)
//   events  → buildModerationFilter, no month window
//   listings→ buildListingsFilter(userId) = the browse grid (21-day freshness, own always)
//   news    → GET /api/news filter (approved or own pending/rejected, no window)
//   blog    → in memory over the content collection, drafts never
// A failing leg fails the request: „all or nothing" (user 2026-09-25).
import type { Db } from 'mongodb';
import { buildModerationFilter, mergeModerationFilter } from '../topicsQuery';
import { buildListingsFilter } from '../listingsQuery';
import { searchForum } from '../forum/searchStore';
import { buildSearchRegex, excerptAround } from '../forum/searchQuery';
import {
  SEARCH_PER_SECTION, eventHref, forumToHits, searchBlogEntries,
  type BlogSearchEntry, type SiteHit, type SiteSearchResult,
} from './siteSearch';

function toIso(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'number' || typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export async function searchEvents(db: Db, q: string, userId?: string): Promise<SiteHit[]> {
  const rx = buildSearchRegex(q);
  const filter: Record<string, any> = { $or: [{ title: rx }, { body: rx }, { location: rx }, { tags: rx }] };
  mergeModerationFilter(filter, buildModerationFilter(userId));
  const docs = await db.collection('events')
    .find(filter, { projection: { title: 1, body: 1, location: 1, startDate: 1, allDay: 1 } })
    .sort({ startDate: -1 }) // furthest ahead first, then the recent past — the calendar's own order reversed
    .limit(SEARCH_PER_SECTION)
    .toArray();
  return docs.map((d) => ({
    section: 'calendar', kind: 'event', id: String(d._id), href: eventHref(String(d._id), d.startDate),
    title: str(d.title), excerpt: excerptAround(d.body, q), date: toIso(d.startDate),
    sub: typeof d.location === 'string' && d.location.trim() ? d.location.trim() : null,
    allDay: d.allDay === true,
  }));
}

export async function searchListings(db: Db, q: string, userId?: string): Promise<SiteHit[]> {
  const rx = buildSearchRegex(q);
  const base = buildListingsFilter(userId ?? null) as { $and: Record<string, any>[] };
  const filter = { $and: [...base.$and, { $or: [{ title: rx }, { descriptionPlainText: rx }] }] };
  const docs = await db.collection('listings')
    .find(filter, { projection: { title: 1, descriptionPlainText: 1, price: 1, listingType: 1, updatedAt: 1, createdAt: 1 } })
    .sort({ updatedAt: -1 })
    .limit(SEARCH_PER_SECTION)
    .toArray();
  return docs.map((d) => {
    const kind = d.listingType === 'exchange' || d.listingType === 'gift' ? d.listingType : 'sell';
    return {
      section: 'marketplace', kind, id: String(d._id), href: `/marketplace/${String(d._id)}`,
      title: str(d.title), excerpt: excerptAround(d.descriptionPlainText, q), // old listings without the plain copy: '' (title still matches)
      date: toIso(d.updatedAt ?? d.createdAt), sub: null,
      price: kind === 'sell' && typeof d.price === 'number' ? d.price : null,
    };
  });
}

export async function searchNews(db: Db, q: string, userId?: string): Promise<SiteHit[]> {
  const rx = buildSearchRegex(q);
  const visible = {
    $or: [
      { moderationStatus: 'approved' },
      ...(userId ? [
        { submittedBy: userId, moderationStatus: 'pending' },
        { submittedBy: userId, moderationStatus: 'rejected' },
      ] : []),
    ],
  };
  const filter = { $and: [visible, { $or: [{ title: rx }, { description: rx }, { sourceName: rx }] }] };
  const docs = await db.collection('news')
    .find(filter, { projection: { title: 1, description: 1, sourceName: 1, publishedAt: 1 } })
    .sort({ publishedAt: -1 })
    .limit(SEARCH_PER_SECTION)
    .toArray();
  return docs.map((d) => ({
    section: 'news', kind: 'news', id: String(d._id), href: `/newsboard/${String(d._id)}`,
    title: str(d.title), excerpt: excerptAround(d.description, q), date: toIso(d.publishedAt),
    sub: str(d.sourceName) || null,
  }));
}

export async function searchSite(db: Db, q: string, userId: string | undefined, blog: BlogSearchEntry[]): Promise<SiteSearchResult> {
  const [forum, calendar, marketplace, news] = await Promise.all([
    searchForum(db, q, userId),
    searchEvents(db, q, userId),
    searchListings(db, q, userId),
    searchNews(db, q, userId),
  ]);
  return { q, hits: { forum: forumToHits(forum), calendar, marketplace, news, blog: searchBlogEntries(blog, q) } };
}
```

- [ ] **Step 2: Blog loader (server, `astro:content`)**

```ts
// src/lib/search/blogEntries.ts
// SERVER-ONLY (astro:content — a virtual module of the Astro build; fine in
// src/lib the way src/pages/sitemap.xml.ts uses it, never importable by a
// unit test — which is why the leg itself is the pure searchBlogEntries()).
// Returns EVERY entry incl. drafts; the pure leg drops drafts, so the rule
// is under test.
import { getCollection } from 'astro:content';
import type { BlogSearchEntry } from './siteSearch';

export async function loadBlogSearchEntries(): Promise<BlogSearchEntry[]> {
  const entries = await getCollection('blog');
  return entries.map((e) => ({
    id: e.id,
    title: e.data.title,
    description: e.data.description,
    tags: e.data.tags,
    author: e.data.author,
    draft: e.data.draft,
    pubDateISO: e.data.pubDate.toISOString(),
    sortISO: e.data.sortDate?.toISOString(),
    body: e.body ?? '',
  }));
}
```

- [ ] **Step 3: The route**

```ts
// src/pages/api/search.ts
import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../lib/mongodb';
import { consumeRateLimit } from '../../lib/auth/rateLimit';
import { normalizeQuery } from '../../lib/forum/searchQuery';
import { searchSite } from '../../lib/search/siteSearchStore';
import { loadBlogSearchEntries } from '../../lib/search/blogEntries';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Cookie' },
  });

// Site search over Forum, Kalender, Markt, News and Blog (2026-09-25 — until
// then forum only). Members only (middleware gates the prefix too). 300
// queries per member and hour — the islands debounce, a person cannot reach
// that. Every section answers or the request fails: no partial results.
export const GET: APIRoute = async ({ request, url }) => {
  const session = await getSession(request);
  const userId = session?.user?.id;
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const q = normalizeQuery(url.searchParams.get('q'));
  if (!q) return json({ error: 'query_invalid' }, 400);

  const rl = await consumeRateLimit(`search:${userId}`, 300, 60 * 60 * 1000);
  if (rl.limited) return json({ error: 'rate_limited' }, 429);

  const [db, blog] = await Promise.all([connectDB(), loadBlogSearchEntries()]);
  return json(await searchSite(db, q, userId, blog));
};
```

- [ ] **Step 4: `search.astro` frontmatter** — replace the two search imports and the `if (initialQuery)` block (keep `KioskLayout`, `SearchPage`, `getSession`, `connectDB`, `normalizeQuery` imports; the `<SearchPage …>` line and layout props change in Task 3):

```astro
---
// /search — site search over Forum, Kalender, Markt, News and Blog (since
// 2026-09-25; forum only from 09-24, orphaned before that). The query runs
// on the SERVER (src/lib/search/siteSearchStore.ts): a `?q=` in the URL is
// answered in this first render, later keystrokes go through
// GET /api/search from the island.
import KioskLayout from '../layouts/KioskLayout.astro';
import SearchPage from '../components/search/SearchPage.svelte';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../lib/mongodb';
import { normalizeQuery } from '../lib/forum/searchQuery';
import { searchSite } from '../lib/search/siteSearchStore';
import { loadBlogSearchEntries } from '../lib/search/blogEntries';
import { SECTIONS, type SiteSearchResult, type SearchSection } from '../lib/search/siteSearch';

const session = await getSession(Astro.request);
const userId = session?.user?.id;

const initialQuery = normalizeQuery(Astro.url.searchParams.get('q')) ?? '';
const sParam = Astro.url.searchParams.get('s');
const initialSection: SearchSection | 'all' = (SECTIONS as readonly string[]).includes(sParam ?? '') ? (sParam as SearchSection) : 'all';
let initialResults: SiteSearchResult | null = null;
if (initialQuery) {
  try {
    const [db, blog] = await Promise.all([connectDB(), loadBlogSearchEntries()]);
    initialResults = await searchSite(db, initialQuery, userId, blog);
  } catch (err) {
    console.error('[search.astro] first query failed:', err);
  }
}
---
```
(The import path `../components/search/SearchPage.svelte` does not exist until Task 3 — Task 2 ends with `pnpm type-check` counting one extra error; Task 3 removes it. Do NOT run `pnpm build` between Tasks 2 and 3.)

- [ ] **Step 5: API probe (dev DB fixtures through the driver, queries through the route)**

Start the dev server first: `pnpm dev --port 4655 >/tmp/dev4655.log 2>&1 &` (stop later with `fuser -k 4655/tcp`). The probe reads the password file only into the login body.

```ts
// scratchpad/site-search-probe.mts
// Site search probe — DEV ONLY: fixtures for events / listings / news in the
// dev DB (refuses a database name without "dev"), queries through
// GET /api/search on :4655 as two seed accounts (ayse = fixture owner,
// jonas = someone else). Blog uses the real content collection. Password
// from scratchpad/devpw.txt, never printed. Run: npx tsx scratchpad/site-search-probe.mts
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';

const BASE = 'http://localhost:4655';
const PW = readFileSync('scratchpad/devpw.txt', 'utf8').trim();
const login = async (email: string) => {
  const c: Record<string, string> = {};
  const store = (r: Response) => { for (const s of r.headers.getSetCookie()) { const [pair] = s.split(';'); const i = pair.indexOf('='); c[pair.slice(0, i)] = pair.slice(i + 1); } };
  const H = () => ({ cookie: Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ') });
  const cs = await fetch(`${BASE}/api/auth/csrf`); store(cs); const { csrfToken } = await cs.json();
  const lr = await fetch(`${BASE}/api/auth/callback/credentials`, { method: 'POST', redirect: 'manual', headers: { ...H(), 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE }, body: new URLSearchParams({ csrfToken, email, password: PW }) });
  store(lr);
  const s = await (await fetch(`${BASE}/api/auth/session`, { headers: H() })).json();
  if (!s?.user?.id) throw new Error('login failed for ' + email);
  return { H, id: String(s.user.id) };
};
let fails = 0;
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${x}`); if (!ok) fails++; };
const client = await MongoClient.connect(process.env.MONGODB_URI!);
const db = client.db();
if (!/dev/i.test(db.databaseName)) { console.error('refusing non-dev db'); process.exit(2); }

const ayse = await login('ayse@mahalle-dev.test');
const jonas = await login('jonas@mahalle-dev.test');
const tag = `zqxv${Date.now()}`;
const now = new Date();
const days = (n: number) => new Date(Date.now() + n * 86400000);
const ids: Array<[string, any]> = [];
const ins = async (col: string, doc: Record<string, any>) => { const r = await db.collection(col).insertOne(doc); ids.push([col, r.insertedId]); return r.insertedId; };
try {
  // Events: one approved (found by LOCATION), one rejected by ayse (hidden from jonas), start 22:30Z → Berlin next day
  const okEvent = await ins('events', { title: `Kiezfest ${tag}`, body: 'Musik und Essen.', location: `Herrfurthplatz ${tag}`, tags: [], author: ayse.id, startDate: new Date('2026-09-26T22:30:00Z'), endDate: new Date('2026-09-27T00:30:00Z'), allDay: false, date: Date.now(), createdAt: now, moderationStatus: 'approved' });
  await ins('events', { title: `Geheim ${tag}`, body: `versteckt ${tag}`, location: '', tags: [], author: ayse.id, startDate: days(3), endDate: days(3), date: Date.now(), createdAt: now, moderationStatus: 'rejected' });
  // Listings: one live, one stale (40 days, no bump) — both ayse's
  const okListing = await ins('listings', { title: `Lampe ${tag}`, descriptionPlainText: `Schöne Lampe ${tag}, wenig benutzt.`, listingType: 'sell', price: 12, status: 'available', sellerId: ayse.id, createdAt: now, updatedAt: now, moderationStatus: 'approved', images: [] });
  await ins('listings', { title: `Altlampe ${tag}`, descriptionPlainText: 'alt', listingType: 'gift', price: 0, status: 'available', sellerId: ayse.id, createdAt: days(-40), updatedAt: days(-40), moderationStatus: 'approved', images: [] });
  // News: one approved (found by SOURCE NAME), one pending submitted by ayse
  const okNews = await ins('news', { source: 'ai_fetched', title: `Kurier ${tag}`, description: 'Ein Artikel.', sourceUrl: `https://example.test/${tag}`, sourceName: `Quelle ${tag}`, publishedAt: now, fetchDate: now.toISOString().slice(0, 10), moderationStatus: 'approved' });
  await ins('news', { source: 'user_submitted', title: `Eingereicht ${tag}`, description: 'wartet', sourceUrl: `https://example.test/p${tag}`, sourceName: 'x', publishedAt: now, submittedBy: ayse.id, moderationStatus: 'pending' });

  const q = async (who: { H: () => Record<string, string> }, s: string) => { const r = await fetch(`${BASE}/api/search?q=${encodeURIComponent(s)}`, { headers: who.H() }); return { r, j: r.ok ? await r.json() : null }; };
  const idsOf = (rows: any[]) => rows.map((h) => h.id);

  const j1 = await q(jonas, tag);
  check('200 + Vary: Cookie + no-store', j1.r.status === 200 && j1.r.headers.get('vary') === 'Cookie' && /no-store/.test(j1.r.headers.get('cache-control') ?? ''));
  check('all five keys are arrays', ['forum', 'calendar', 'marketplace', 'news', 'blog'].every((k) => Array.isArray(j1.j?.hits?.[k])), JSON.stringify(Object.keys(j1.j?.hits ?? {})));
  check('jonas: approved event found by location', idsOf(j1.j.hits.calendar).includes(String(okEvent)));
  check('jonas: rejected event hidden', !idsOf(j1.j.hits.calendar).includes(String(ids[1][1])));
  const ev = j1.j.hits.calendar.find((h: any) => h.id === String(okEvent));
  check('event href has Berlin day', ev?.href === `/calendar?event=${okEvent}&d=2026-09-27`, ev?.href);
  check('event row: kind/sub/allDay/date', ev?.kind === 'event' && ev?.sub === `Herrfurthplatz ${tag}` && ev?.allDay === false && typeof ev?.date === 'string');
  check('jonas: live listing found, stale hidden', idsOf(j1.j.hits.marketplace).includes(String(okListing)) && j1.j.hits.marketplace.length === 1, String(j1.j.hits.marketplace.length));
  const li = j1.j.hits.marketplace[0];
  check('listing row: kind sell, price 12, href', li?.kind === 'sell' && li?.price === 12 && li?.href === `/marketplace/${okListing}` && !('sellerId' in (li ?? {})));
  check('jonas: approved news found by source name, pending hidden', idsOf(j1.j.hits.news).includes(String(okNews)) && j1.j.hits.news.length === 1);
  check('news row: no description, sub = source', !('description' in j1.j.hits.news[0]) && j1.j.hits.news[0].sub === `Quelle ${tag}`);
  const j2 = await q(ayse, tag);
  check('ayse (owner): stale own listing visible', j2.j.hits.marketplace.length === 2);
  check('ayse (submitter): own pending news visible', j2.j.hits.news.length === 2);
  check('ayse (author): own rejected event visible', j2.j.hits.calendar.length === 2);
  const b = await q(jonas, 'wahl2026');
  check('blog: election posts found by tag, slug hrefs', b.j.hits.blog.length >= 4 && b.j.hits.blog.every((h: any) => /^\/blog\/[a-z0-9-]+$/.test(h.href) && h.kind === 'post'), String(b.j.hits.blog.length));
  const f = await q(jonas, 'Schillermarkt');
  check('forum leg still answers (posts and/or comments)', f.j.hits.forum.length > 0 && f.j.hits.forum.every((h: any) => h.section === 'forum'));
  check('forum rows: no author object, sub = name', f.j.hits.forum.every((h: any) => !('author' in h) && ('sub' in h)));
  const none = await q(jonas, 'zzqqxxyy');
  check('no hits → five empty arrays, 200', none.r.status === 200 && Object.values(none.j.hits).every((a: any) => a.length === 0));
  const anon = await fetch(`${BASE}/api/search?q=${tag}`);
  check('logged out → 401', anon.status === 401);
  const short = await fetch(`${BASE}/api/search?q=a`, { headers: jonas.H() });
  check('1 char → 400', short.status === 400);
} finally {
  for (const [col, id] of ids) await db.collection(col).deleteOne({ _id: id });
  await client.close();
}
console.log(fails ? `${fails} FAILED` : 'all green');
process.exit(fails ? 1 : 0);
```

- [ ] **Step 6: Run the probe**

Run: `npx tsx scratchpad/site-search-probe.mts`
Expected: `all green` (19 checks). If `forum leg still answers` fails because the seed forum has no „Schillermarkt", change that query to a word that the seed forum has (`grep -o "title: '[^']*'" scripts/seed-dev-db.ts | head`) — the check is about the leg, not the word.

- [ ] **Step 7: Commit**

```bash
git add src/lib/search/siteSearchStore.ts src/lib/search/blogEntries.ts src/pages/api/search.ts src/pages/search.astro
git commit -m "site search: GET /api/search answers forum, calendar, market, news and blog under each section's own visibility"
```

---

### Task 3: Shared runner, `SearchHit.svelte`, `SearchPage.svelte` with section chips, i18n, `tour={false}`

**Files:**
- Create: `src/lib/search/searchRunner.svelte.ts`
- Create: `src/components/search/SearchHit.svelte`
- Move + rewrite: `git mv src/components/forum/kiosk/SearchPage.svelte src/components/search/SearchPage.svelte`
- Modify: `src/pages/search.astro` (the `<KioskLayout …>` + `<SearchPage …>` lines)
- Modify: `src/lib/kiosk-i18n.ts` (`nav.search.placeholder` in both dicts; new `search.*` keys after `nav.search.close` in both dicts)
- Modify: `scratchpad/search-page-probe.cjs`

**Interfaces:**
- Consumes: Task 1 types/constants; Task 2 response; `normalizeQuery`, `splitFirstMatch`, `SEARCH_MAX_LEN` from `src/lib/forum/searchQuery.ts`; `relTime` from `src/lib/relTime.ts`; `PostTypeChip.svelte` (`kind`, `size="sm"`); `t`, `tStr`, `locale` from `kiosk-i18n`.
- Produces: `createSearchRunner(initial?: { query?: string; results?: SiteSearchResult | null })` → object with `query` (get/set), `normalized`, `hits` (`SiteSearchResult | null`, only when its `q` equals `normalized`), `loading`, `failed`, `pending`; `<SearchHit hit q compact? />`; `<SearchPage initialQuery initialResults initialSection />`.

- [ ] **Step 1: i18n keys** — in BOTH dictionaries find `'nav.search.close'` (de ≈ line 99, en ≈ line 2123 before this edit): replace the `'nav.search.placeholder'` line two lines above it and add the `search.*` keys right after it. Drafts — the user rewords.

```ts
  // de
  'nav.search.placeholder': 'Mahalle durchsuchen …',
  'search.hint': 'Forum · Kalender · Markt · News · Blog — ab 2 Zeichen',
  'search.searching': 'Suche …',
  'search.unavailable': 'Die Suche ist gerade nicht erreichbar.',
  'search.retry': 'Versuch es gleich noch einmal.',
  'search.none': 'Nichts gefunden.',
  'search.none.hint': 'Probier andere Wörter oder einen Tag (z. B. spielplatz).',
  'search.all': 'Alle {n} Treffer',
  'search.count': '{n} Treffer',
  'search.section.all': 'Alle',
  'search.comment': 'Kommentar',
  'search.clear': 'Suche leeren',
  'search.idle': 'Tippe einen Suchbegriff oben ein.',
  'search.allday': 'ganztags',
```
```ts
  // en
  'nav.search.placeholder': 'Search Mahalle …',
  'search.hint': 'Forum · Calendar · Market · News · Blog — from 2 characters',
  'search.searching': 'Searching …',
  'search.unavailable': 'Search is unavailable right now.',
  'search.retry': 'Try again in a moment.',
  'search.none': 'Nothing found.',
  'search.none.hint': 'Try other words or a tag (e.g. spielplatz).',
  'search.all': 'All {n} results',
  'search.count': '{n} results',
  'search.section.all': 'All',
  'search.comment': 'Comment',
  'search.clear': 'Clear search',
  'search.idle': 'Type a search term above.',
  'search.allday': 'all day',
```
Listing kinds reuse the existing `market.filter.kind.tausch` / `market.filter.kind.verschenken`.

- [ ] **Step 2: The runner (runes module)**

```ts
// src/lib/search/searchRunner.svelte.ts
// One fetch state machine for both search islands (page + modal): debounce
// 250 ms, „last request wins", and `pending` = a query is typed but ITS
// answer is not in yet — while pending neither an empty state nor the
// previous query's hits may show (review 2026-09-24). Runes in a .svelte.ts
// module; call it during component init (it creates an $effect). Islands
// write `runner.query` from oninput (no bind: on the accessor).
import { normalizeQuery } from '../forum/searchQuery';
import type { SiteSearchResult } from './siteSearch';

export function createSearchRunner(initial: { query?: string; results?: SiteSearchResult | null } = {}) {
  let query = $state(initial.query ?? '');
  let results = $state<SiteSearchResult | null>(initial.results ?? null);
  let loading = $state(false);
  let failed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  const normalized = $derived(normalizeQuery(query));
  const hits = $derived(results && normalized && results.q === normalized ? results : null);
  const pending = $derived(!!normalized && !hits);

  async function run(q: string) {
    const my = ++seq;
    loading = true;
    failed = false;
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (my !== seq) return;
      if (!r.ok) { failed = true; return; }
      results = (await r.json()) as SiteSearchResult;
    } catch {
      if (my === seq) failed = true;
    } finally {
      if (my === seq) loading = false;
    }
  }

  $effect(() => {
    const q = normalized;
    clearTimeout(timer);
    if (!q) { loading = false; failed = false; return; }
    if (results && results.q === q) return; // SSR answer or the same query again
    failed = false;
    timer = setTimeout(() => run(q), 250);
    return () => clearTimeout(timer);
  });

  return {
    get query() { return query; },
    set query(v: string) { query = v; },
    get normalized() { return normalized; },
    get hits() { return hits; },
    get loading() { return loading; },
    get failed() { return failed; },
    get pending() { return pending; },
  };
}
```

- [ ] **Step 3: One row for every section**

```svelte
<!-- src/components/search/SearchHit.svelte -->
<script lang="ts">
  // One search hit — the same paper card on the results page and, compact,
  // in the masthead modal. Kicker per section in the section's accent;
  // forum posts keep the PostTypeChip, comments the ↪ KOMMENTAR kicker with
  // the parent title. Highlight through splitFirstMatch() — no {@html}.
  // Tailwind only, no <style> (nested island → orphaned styles in prod).
  import PostTypeChip from '../forum/kiosk/PostTypeChip.svelte';
  import { t, locale } from '../../lib/kiosk-i18n';
  import { relTime } from '../../lib/relTime';
  import { splitFirstMatch } from '../../lib/forum/searchQuery';
  import { SECTION_ACCENT, SECTION_LABEL_KEY, eventDayLabel, type SiteHit } from '../../lib/search/siteSearch';

  let { hit, q, compact = false } = $props<{ hit: SiteHit; q: string; compact?: boolean }>();

  const titleSplit = $derived(splitFirstMatch(hit.title, q));
  const bodySplit = $derived(splitFirstMatch(hit.excerpt, q));
  const accent = $derived(SECTION_ACCENT[hit.section]);
  const isPost = $derived(hit.kind === 'discussion' || hit.kind === 'announcement' || hit.kind === 'recommendation');

  // Kicker text after the section label — one line, mono uppercase.
  const kicker = $derived.by(() => {
    const label = $t[SECTION_LABEL_KEY[hit.section]];
    switch (hit.kind) {
      case 'comment': return `↪ ${$t['search.comment']} · ${relTime(hit.date, $locale)}`;
      case 'event': return `${label} · ${eventDayLabel(hit.date, $locale, hit.allDay === true)}${hit.allDay ? ` · ${$t['search.allday']}` : ''}`;
      case 'sell': return `${label} · ${hit.price ?? '–'} €`;
      case 'exchange': return `${label} · ${$t['market.filter.kind.tausch']}`;
      case 'gift': return `${label} · ${$t['market.filter.kind.verschenken']}`;
      case 'news': return `${label}${hit.sub ? ` · ${hit.sub}` : ''} · ${relTime(hit.date, $locale)}`;
      case 'post': return `${label}${hit.sub ? ` · ${hit.sub}` : ''} · ${relTime(hit.date, $locale)}`;
      default: return relTime(hit.date, $locale); // forum posts: chip carries the kind
    }
  });
</script>

<a
  href={hit.href}
  class="sh block focus:outline-none focus:ring-2 focus:ring-ink rounded-xl"
  data-section={hit.section}
  data-kind={hit.kind}
>
  <article class="bg-paper border-[1.5px] border-ink rounded-xl {compact ? 'px-3 py-2' : 'px-3.5 py-3'}">
    <div class="flex items-center gap-1.5 {compact ? 'mb-0.5' : 'mb-1.5'} min-w-0">
      {#if isPost}
        <PostTypeChip kind={hit.kind as 'discussion' | 'announcement' | 'recommendation'} size="sm" />
        <span class="font-dmmono text-[9.5px] text-ink-mute truncate">· {kicker}</span>
      {:else}
        <span class="font-dmmono text-[9.5px] uppercase tracking-[0.08em] truncate" style="color: {accent}">{kicker}</span>
      {/if}
    </div>
    {#if hit.kind === 'comment'}
      <p class="font-dmmono text-[9.5px] text-ink-mute tracking-[0.05em] truncate {compact ? 'mb-0.5' : 'mb-1.5'}">↪ {hit.title}</p>
    {:else}
      <h3 class="font-bricolage font-extrabold {compact ? 'text-[14px]' : 'text-[15px]'} tracking-[-0.015em] leading-[1.2] m-0 mb-1 text-ink {compact ? 'truncate' : ''}">
        {#if titleSplit}{titleSplit.prefix}<mark class="bg-ochre text-ink px-0.5">{titleSplit.match}</mark>{titleSplit.suffix}{:else}{hit.title}{/if}
      </h3>
    {/if}
    {#if hit.excerpt}
      <p class="font-bricolage text-[12.5px] leading-[1.45] text-ink-soft m-0 {compact ? 'line-clamp-1' : ''}">
        {#if bodySplit}{bodySplit.prefix}<mark class="bg-ochre text-ink px-0.5">{bodySplit.match}</mark>{bodySplit.suffix}{:else}{hit.excerpt}{/if}
      </p>
    {/if}
    {#if !compact && hit.kind === 'event' && hit.sub}
      <p class="font-dmmono text-[10px] text-ink-mute mt-1 m-0 truncate">📍 {hit.sub}</p>
    {/if}
  </article>
</a>
```

- [ ] **Step 4: Move and rewrite the page island**

`git mv src/components/forum/kiosk/SearchPage.svelte src/components/search/SearchPage.svelte`, then replace its whole content:

```svelte
<!-- src/components/search/SearchPage.svelte -->
<script lang="ts">
  // /search results — site-wide since 2026-09-25 (forum only from 09-24).
  // The page SSRs the first `?q=`; the runner (shared with the masthead
  // modal) debounces later keystrokes. Section chips filter client-side and
  // ride in `?s=`; „Alle" lists every section as a group in nav order.
  // URL sync keeps Astro's ClientRouter state (root CLAUDE.md).
  import { onMount } from 'svelte';
  import { t, tStr } from '../../lib/kiosk-i18n';
  import { SEARCH_MAX_LEN } from '../../lib/forum/searchQuery';
  import { SECTIONS, SECTION_LABEL_KEY, SECTION_ACCENT, countHits, type SiteSearchResult, type SearchSection } from '../../lib/search/siteSearch';
  import { createSearchRunner } from '../../lib/search/searchRunner.svelte';
  import SearchHit from './SearchHit.svelte';

  let { initialQuery = '', initialResults = null, initialSection = 'all' } = $props<{
    initialQuery?: string;
    initialResults?: SiteSearchResult | null;
    initialSection?: SearchSection | 'all';
  }>();

  const runner = createSearchRunner({ query: initialQuery, results: initialResults });
  let section = $state<SearchSection | 'all'>(initialSection);
  let inputEl = $state<HTMLInputElement | null>(null);

  const counts = $derived(runner.hits ? countHits(runner.hits) : null);
  const shown = $derived.by((): SearchSection[] => {
    if (!runner.hits) return [];
    const list = section === 'all' ? SECTIONS : [section];
    return list.filter((s) => runner.hits!.hits[s].length > 0);
  });
  const shownTotal = $derived(counts ? shown.reduce((n, s) => n + counts.bySection[s], 0) : 0);

  onMount(() => { if (!runner.query) inputEl?.focus(); });
  $effect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (runner.normalized) url.searchParams.set('q', runner.normalized); else url.searchParams.delete('q');
    if (section !== 'all') url.searchParams.set('s', section); else url.searchParams.delete('s');
    window.history.replaceState(window.history.state, '', url.toString());
  });

  const kicker = $derived.by(() => {
    if (!runner.normalized) return $t['search.hint'];
    if (runner.failed) return $t['search.unavailable'];
    if (runner.loading || runner.pending) return $t['search.searching'];
    return tStr($t['search.count'], { n: counts?.total ?? 0 });
  });
</script>

<!-- A <div>, not <main>: KioskLayout already provides the page's main landmark. -->
<div class="max-w-3xl mx-auto pb-10" data-search-page>
  <section class="px-[18px] py-2.5 bg-paper-warm border-b border-dashed border-rule">
    <div class="flex items-center gap-2 bg-paper border-[1.5px] border-ink rounded-full px-3.5 py-2">
      <span class="font-dmmono text-[14px] text-ink-mute pointer-events-none shrink-0" aria-hidden="true">⌕</span>
      <!-- type="text": Chrome draws its own clear button on type="search" (prod, 09-24). -->
      <input
        bind:this={inputEl}
        type="text" inputmode="search" enterkeyhint="search"
        maxlength={SEARCH_MAX_LEN}
        value={runner.query}
        oninput={(e) => (runner.query = e.currentTarget.value)}
        placeholder={$t['nav.search.placeholder']}
        aria-label={$t['nav.search.aria']}
        autocomplete="off"
        class="flex-1 min-w-0 bg-transparent border-none outline-none font-bricolage text-[14px] font-semibold text-ink placeholder:text-ink-mute placeholder:font-normal"
      />
      {#if runner.query}
        <button type="button" onclick={() => { runner.query = ''; inputEl?.focus(); }} aria-label={$t['search.clear']}
          class="shrink-0 w-4 h-4 rounded-full bg-ink-mute text-paper text-[9px] font-bold flex items-center justify-center hover:bg-ink transition-colors">×</button>
      {/if}
    </div>
    <p class="mt-1.5 font-dmmono text-[9.5px] uppercase tracking-[0.05em] text-ink-soft">{kicker}</p>

    <!-- Section chips: always all five (the promise is „alle Bereiche"); a zero count is dimmed, not hidden. -->
    {#if counts && counts.total > 0}
      <div class="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={$t['nav.search.aria']}>
        <button type="button" data-section-chip="all" aria-pressed={section === 'all'} onclick={() => (section = 'all')}
          class="font-dmmono text-[10px] uppercase tracking-[0.06em] rounded-full border-[1.5px] border-ink px-2.5 py-1 {section === 'all' ? 'bg-ink text-paper' : 'bg-paper text-ink'}">
          {$t['search.section.all']} · {counts.total}
        </button>
        {#each SECTIONS as s (s)}
          <button type="button" data-section-chip={s} aria-pressed={section === s} disabled={counts.bySection[s] === 0} onclick={() => (section = s)}
            class="font-dmmono text-[10px] uppercase tracking-[0.06em] rounded-full border-[1.5px] border-ink px-2.5 py-1 disabled:opacity-40 {section === s ? 'bg-ink text-paper' : 'bg-paper text-ink'}">
            {$t[SECTION_LABEL_KEY[s]]} · {counts.bySection[s]}
          </button>
        {/each}
      </div>
    {/if}
  </section>

  {#if !runner.normalized}
    <div class="px-[18px] py-10 text-center"><p class="font-bricolage text-ink-mute">{$t['search.idle']}</p></div>
  {:else if runner.failed}
    <div class="mx-[18px] my-6 px-6 py-10 bg-paper-warm border-[1.5px] border-dashed border-rule rounded-xl text-center">
      <p class="font-bricolage text-2xl text-ink mb-2">{$t['search.unavailable']}</p>
      <p class="font-bricolage text-ink-soft">{$t['search.retry']}</p>
    </div>
  {:else if runner.loading || runner.pending}
    <!-- Answer on its way: no list and no empty state until it is here. -->
    <div class="px-[18px] py-10" aria-hidden="true"></div>
  {:else if counts && (counts.total === 0 || shownTotal === 0)}
    <div class="mx-[18px] my-6 px-6 py-10 bg-paper-warm border-[1.5px] border-dashed border-rule rounded-xl text-center">
      <p class="font-bricolage text-2xl text-ink mb-2">{$t['search.none']}</p>
      <p class="font-bricolage text-ink-soft">{$t['search.none.hint']}</p>
    </div>
  {:else if runner.hits}
    <div class="px-[18px] py-2.5 flex flex-col gap-4">
      {#each shown as s (s)}
        <section data-search-group={s}>
          <h2 class="font-dmmono text-[10px] uppercase tracking-[0.12em] m-0 mb-2" style="color: {SECTION_ACCENT[s]}">
            {$t[SECTION_LABEL_KEY[s]]} · {counts?.bySection[s]}
          </h2>
          <div class="flex flex-col gap-2.5">
            {#each runner.hits.hits[s] as hit (hit.kind + hit.id)}
              <SearchHit {hit} q={runner.normalized ?? ''} />
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 5: `search.astro` — the island and layout lines** (frontmatter from Task 2 already imports `SECTIONS` and computes `initialSection`):

```astro
<KioskLayout title="Mahalle · Suche" description="Suche in Forum, Kalender, Markt, News und Blog." tour={false}>
  <SearchPage client:only="svelte" initialQuery={initialQuery} initialResults={initialResults} initialSection={initialSection} />
</KioskLayout>
```
(no `page` prop: the site-wide page is app-level, ochre bars like `/profile`; `tour={false}` closes the 09-24 open item.)

- [ ] **Step 6: Page probe** — replace `scratchpad/search-page-probe.cjs` with:

```js
// /search page probe on the dev server :4655 (desktop + phone). Password from
// scratchpad/devpw.txt is only ever passed to page.fill.
// Run: NODE_PATH=$(npm root -g)/@playwright/cli/node_modules node scratchpad/search-page-probe.cjs
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); let fails = 0;
  const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${x}`); if (!ok) fails++; };
  for (const [name, vw] of [['desktop', { width: 1400, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const p = await (await b.newContext({ viewport: vw, deviceScaleFactor: 2 })).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:4655/login?redirect=%2Fsearch%3Fq%3DTest');
    await p.fill('input[type="email"]', 'jonas@mahalle-dev.test'); await p.fill('input[type="password"]', fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim());
    await p.keyboard.press('Enter'); await p.waitForURL('**/search**'); await p.waitForTimeout(1500);
    const ssr = await p.locator('[data-search-page] a.sh').count();
    check(`${name}: SSR hits for ?q=Test`, ssr > 0, String(ssr));
    const groups = await p.locator('[data-search-group]').evaluateAll((els) => els.map((e) => e.dataset.searchGroup));
    check(`${name}: at least two section groups (seed forum posts + events say „Test“, whatever the seed's age)`, groups.length >= 2, groups.join(','));
    check(`${name}: six chips, „Alle" pressed`, (await p.locator('[data-section-chip]').count()) === 6 && (await p.locator('[data-section-chip="all"]').getAttribute('aria-pressed')) === 'true');
    check(`${name}: no tour offer on /search`, (await p.locator('.tour-card').count()) === 0);
    check(`${name}: history.state kept`, await p.evaluate(() => history.state !== null && typeof history.state === 'object' && 'index' in history.state));
    await p.locator('[data-section-chip="calendar"]').click(); await p.waitForTimeout(200);
    check(`${name}: calendar chip → only the calendar group, ?s=calendar`, (await p.locator('[data-search-group]').count()) === 1 && (await p.locator('[data-search-group="calendar"]').count()) === 1 && p.url().includes('s=calendar'));
    check(`${name}: event row kicker has a day and a Berlin time or ganztags`, /\d{2}\.\d{2}\.|\d{2}\/\d{2}/.test(await p.locator('[data-search-group="calendar"] a.sh').first().innerText()));
    await p.locator('[data-section-chip="all"]').click();
    await p.locator('[data-search-page] input').first().fill('(('); await p.waitForTimeout(700);
    check(`${name}: "((" shows 0 Treffer, no error`, /0 TREFFER|0 RESULTS/i.test(await p.locator('[data-search-page]').innerText()));
    await p.locator('[data-search-page] input').first().fill('a'); await p.waitForTimeout(600);
    check(`${name}: 1 char → idle hint names five sections`, /Forum · Kalender · Markt · News · Blog|Forum · Calendar/.test(await p.locator('[data-search-page]').innerText()));
    await p.locator('[data-search-page] input').first().fill('Test'); await p.waitForTimeout(900);
    check(`${name}: typed query renders cards + url synced`, (await p.locator('[data-search-page] a.sh').count()) > 0 && p.url().includes('q=Test'));
    await p.locator('[data-search-page] input').first().fill('Testx'); await p.waitForTimeout(60);
    const mid = await p.locator('[data-search-page]').innerText();
    check(`${name}: no empty-state flash while pending`, !/Nichts gefunden|Nothing found|0 TREFFER|0 RESULTS/i.test(mid) && /SUCHE …|SEARCHING …/i.test(mid), mid.replace(/\s+/g, ' ').slice(0, 80));
    await p.waitForTimeout(900);
    check(`${name}: no page errors`, errs.length === 0, errs.join(' | '));
    await p.screenshot({ path: `scratchpad/search-dev-${name}.png` });
    await p.close();
  }
  await b.close(); console.log(fails ? `${fails} FAILED` : 'all green'); process.exit(fails ? 1 : 0);
})();
```

- [ ] **Step 7: Run gates for this task**

Run: `pnpm type-check 2>&1 | grep -c "error TS"` → expected ≤ 23 (the Task 2 import error is gone now). Run the probe: `NODE_PATH=$(npm root -g)/@playwright/cli/node_modules node scratchpad/search-page-probe.cjs` → `all green` (24 checks). Copy `scratchpad/search-dev-desktop.png` and `-phone.png` to `/mnt/c/Users/atakee/Downloads/`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/search/searchRunner.svelte.ts src/components/search/SearchHit.svelte src/components/search/SearchPage.svelte src/pages/search.astro src/lib/kiosk-i18n.ts
git commit -m "search page: all sections grouped with chips (?s=), shared runner, one hit row, no tour on /search"
```
(`git mv` already staged the rename; the `git add` of the new path covers the rewrite.)

---

### Task 4: `SearchModal.svelte` in the masthead, strip and inline field removed — modal probe

**Files:**
- Create: `src/components/search/SearchModal.svelte`
- Modify: `src/components/forum/kiosk/KioskNav.svelte` (lines 15–18 imports; 28–85 search block; 329–338 inline form; 386–396 strip)
- Modify: `src/components/forum/kiosk/MastSearch.svelte` (button attributes + header comment)
- Modify: `src/styles/global.css` (delete lines 990–1027; add the `.sm-*` block; fix the `.ms-*` comment)
- Create: `scratchpad/search-modal-probe.cjs`; delete `scratchpad/mast-search-probe.cjs` (obsolete, gitignored)

**Interfaces:**
- Consumes: Task 3 `createSearchRunner`, `SearchHit`; Task 1 `SECTIONS`, `SECTION_LABEL_KEY`, `SECTION_ACCENT`, `MODAL_PER_SECTION`, `countHits`; `lockPageScroll()` from `src/lib/scrollLock.ts` (returns the restore closure); `SEARCH_MAX_LEN`; `t`, `tStr`.
- Produces: `<SearchModal onClose={(restoreFocus: boolean) => void} />`; KioskNav keeps `searchOpen`, `toggleSearch()`, `closeSearch(restoreFocus)` (names unchanged — the three hide-on-scroll references at lines 124, 159 and the `z-50` ternary at 246 stay exactly as they are).

- [ ] **Step 1: The modal**

```svelte
<!-- src/components/search/SearchModal.svelte -->
<script lang="ts">
  // Masthead search modal (2026-09-25, user: „a modal in the middle of the
  // page with a background blurring everything behind"). Scrim and box are
  // SIBLINGS — the blur must never be an ancestor of the fixed box (root
  // CLAUDE.md, backdrop-filter containing block). Mounted by KioskNav as the
  // last child of <header>, whose z-50 (searchOpen) covers the bottom nav.
  // Live top hits per section from the shared runner; Enter / „Alle Treffer"
  // → full navigation to /search?q=. Scroll lock html-only, focus trap,
  // Escape / scrim close, instant close (notification-panel ruling).
  // Styles .sm-* in global.css, never here (nested island).
  import { tick } from 'svelte';
  import { t, tStr } from '../../lib/kiosk-i18n';
  import { lockPageScroll } from '../../lib/scrollLock';
  import { SEARCH_MAX_LEN } from '../../lib/forum/searchQuery';
  import { SECTIONS, SECTION_LABEL_KEY, SECTION_ACCENT, MODAL_PER_SECTION, countHits } from '../../lib/search/siteSearch';
  import { createSearchRunner } from '../../lib/search/searchRunner.svelte';
  import SearchHit from './SearchHit.svelte';

  let { onClose } = $props<{ onClose: (restoreFocus: boolean) => void }>();

  const runner = createSearchRunner();
  let boxEl = $state<HTMLElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  const counts = $derived(runner.hits ? countHits(runner.hits) : null);
  const resultsHref = $derived(`/search?q=${encodeURIComponent(runner.normalized ?? '')}`);

  $effect(() => lockPageScroll()); // the returned closure restores <html> on unmount
  $effect(() => { tick().then(() => inputEl?.focus()); });

  function close(fromEscape = false) {
    const restoreFocus = fromEscape || (boxEl?.contains(document.activeElement) ?? false);
    onClose(restoreFocus);
  }
  // Tab trap walks EVERY control; the arrows walk only input → hits → footer
  // (skipping the × and Esc buttons, which a keyboard user reaches by Tab).
  function focusables(): HTMLElement[] {
    return boxEl ? Array.from(boxEl.querySelectorAll<HTMLElement>('input, a[href], button:not([disabled])')) : [];
  }
  function rovers(): HTMLElement[] {
    return boxEl ? Array.from(boxEl.querySelectorAll<HTMLElement>('input, a.sh, a.sm-foot')) : [];
  }
  function onDocKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
  }
  function onBoxKeydown(e: KeyboardEvent) {
    const active = document.activeElement as HTMLElement;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const els = rovers();
      if (!els.length) return;
      e.preventDefault();
      const i = els.indexOf(active);
      els[e.key === 'ArrowDown' ? (i + 1) % els.length : (i - 1 + els.length) % els.length].focus();
    } else if (e.key === 'Tab') {
      // Focus trap (WAI-ARIA dialog): Tab cycles inside the box.
      const els = focusables();
      if (!els.length) return;
      const i = els.indexOf(active);
      if (e.shiftKey && i <= 0) { e.preventDefault(); els[els.length - 1].focus(); }
      else if (!e.shiftKey && i === els.length - 1) { e.preventDefault(); els[0].focus(); }
    }
  }
  $effect(() => {
    document.addEventListener('keydown', onDocKeydown);
    return () => document.removeEventListener('keydown', onDocKeydown);
  });
  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!runner.normalized) return;
    window.location.href = resultsHref;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="sm-scrim" data-search-scrim onclick={() => close(false)}></div>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div bind:this={boxEl} id="site-search" class="sm-box" role="dialog" aria-modal="true" aria-label={$t['nav.search.aria']} onkeydown={onBoxKeydown}>
  <form class="sm-head" role="search" onsubmit={submit}>
    <span class="font-dmmono text-[15px] text-ink-mute" aria-hidden="true">⌕</span>
    <input bind:this={inputEl} value={runner.query} oninput={(e) => (runner.query = e.currentTarget.value)} type="text" inputmode="search" enterkeyhint="search" maxlength={SEARCH_MAX_LEN} autocomplete="off" placeholder={$t['nav.search.placeholder']} aria-label={$t['nav.search.aria']} class="sm-input" />
    {#if runner.query}
      <button type="button" class="sm-clear" onclick={() => { runner.query = ''; inputEl?.focus(); }} aria-label={$t['search.clear']}>×</button>
    {/if}
    <button type="button" class="sm-esc kiosk-tap" onclick={() => close(true)} aria-label={$t['nav.search.close']}>Esc</button>
  </form>
  <div class="sm-body">
    {#if !runner.normalized}
      <p class="sm-note">{$t['search.hint']}</p>
    {:else if runner.failed}
      <p class="sm-note">{$t['search.unavailable']}</p>
    {:else if runner.pending || runner.loading}
      <p class="sm-note" aria-live="polite">{$t['search.searching']}</p>
    {:else if counts && counts.total === 0}
      <p class="sm-note">{$t['search.none']}</p>
    {:else if runner.hits}
      {#each SECTIONS as section (section)}
        {@const rows = runner.hits.hits[section]}
        {#if rows.length}
          <section class="sm-group" data-modal-group={section}>
            <h3 class="sm-kicker" style="color: {SECTION_ACCENT[section]}">{$t[SECTION_LABEL_KEY[section]]} · {rows.length}</h3>
            {#each rows.slice(0, MODAL_PER_SECTION) as hit (hit.kind + hit.id)}
              <SearchHit {hit} q={runner.normalized ?? ''} compact />
            {/each}
          </section>
        {/if}
      {/each}
    {/if}
  </div>
  {#if counts && counts.total > 0}
    <a class="sm-foot" href={resultsHref}>{tStr($t['search.all'], { n: counts.total })} →</a>
  {/if}
</div>
```

- [ ] **Step 2: `global.css`** (line numbers as of `3b39ae82`; confirm `sed -n 990p` prints `.ms-strip {` and `sed -n 1027p` the reduced-motion `.ms-inline` line first) — delete lines 990–1027 (from `.ms-strip {` through the `@media (prefers-reduced-motion: reduce) { .ms-inline …}` line). Replace the header comment at 963–967 with:

```css
/* ─── Masthead search disc (2026-09-24) + search modal .sm-* (2026-09-25) ──
   Disc = sibling of .nc-bell-disc: same size, fill, frame colour token and
   bevel. The modal below replaced the strip (09-24) and the inline field
   (09-25 morning). Styles live here, not in the .svelte files (nested
   island → orphaned <style>). */
```
Then append after the `.ms-disc--active { … }` rule (the block now ends at the old line 989):

```css
/* Search modal: scrim + box are SIBLINGS (the blur must not be an ancestor
   of the fixed box — backdrop-filter containing block, root CLAUDE.md). Both
   fixed inside <header>'s z-50 stacking context (searchOpen bumps it), so
   they cover the bottom nav (z-40). Box in the upper third on phones (room
   for the keyboard), a little lower from md. Instant close, no exit motion. */
.sm-scrim {
  position: fixed; inset: 0; z-index: 60;
  background: rgb(27 26 23 / 0.35);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  animation: smFade 160ms ease-out;
}
.sm-box {
  position: fixed; z-index: 61;
  left: 16px; right: 16px; margin: 0 auto; max-width: 640px;
  top: 8vh; top: 8dvh;
  max-height: calc(100vh - 8vh - 24px); max-height: calc(100dvh - 8dvh - 24px);
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--k-paper); color: var(--k-ink);
  border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-md);
  box-shadow: 4px 4px 0 var(--k-ink);
  animation: smBoxIn 180ms cubic-bezier(0.2, 0.7, 0.3, 1);
}
@media (min-width: 768px) {
  .sm-box { top: 14vh; max-height: calc(86vh - 24px); }
}
.sm-head {
  display: flex; align-items: center; gap: 10px; flex: 0 0 auto;
  padding: 10px 14px; border-bottom: 1.5px dashed var(--k-rule); background: var(--k-paper-warm);
}
.sm-input {
  flex: 1; min-width: 0; height: 36px; background: transparent; border: 0; outline: none;
  font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-size: 16px; font-weight: 600; color: var(--k-ink);
}
.sm-input::placeholder { color: var(--k-ink-mute); font-weight: 400; }
.sm-clear {
  flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; border: 0; cursor: pointer;
  background: var(--k-ink-mute); color: var(--k-paper); font-size: 11px; font-weight: 700; line-height: 1;
}
.sm-clear:hover { background: var(--k-ink); }
.sm-esc {
  flex: 0 0 auto; height: 26px; padding: 0 8px; border-radius: 6px; cursor: pointer;
  border: 1.5px solid var(--k-ink); background: var(--k-paper); color: var(--k-ink);
  font-family: 'DM Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase;
}
.sm-esc:hover { background: var(--k-ink); color: var(--k-paper); }
.sm-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 12px; }
.sm-note { margin: 12px 0; text-align: center; font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-size: 13.5px; color: var(--k-ink-mute); }
.sm-group { display: flex; flex-direction: column; gap: 6px; }
.sm-kicker { margin: 0 0 2px; font-family: 'DM Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; }
.sm-foot {
  flex: 0 0 auto; display: block; padding: 10px 14px; border-top: 1.5px solid var(--k-ink);
  background: var(--k-ink); color: var(--k-paper); text-decoration: none;
  font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-size: 14px; font-weight: 700;
}
.sm-foot:hover, .sm-foot:focus-visible { background: var(--k-wine); outline: none; }
@keyframes smFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes smBoxIn { from { opacity: 0; transform: translateY(-8px) scale(0.985); } to { opacity: 1; transform: none; } }
/* Keep LAST among .sm-* rules — media queries add no specificity. */
@media (prefers-reduced-motion: reduce) {
  .sm-scrim, .sm-box { animation: none; }
}
```
(The `.sm-box` animation uses `transform`, which makes the box a containing block for fixed descendants — it has none; the box's own `position: fixed` is unaffected because the transform is on the box itself, not an ancestor. `box-shadow` at 4 px matches `.am-card`'s 3 px family; `--k-radius-md` is the card radius token already used by `.am-card`.)

- [ ] **Step 3: `KioskNav.svelte`** — four edits (line numbers as of `3b39ae82`; do them bottom-up — d, c, b, a — so the numbers stay valid; confirm each block by its first line before deleting):

(a) Line 15: `import MastSearch from './MastSearch.svelte';` → add below it `import SearchModal from '../../search/SearchModal.svelte';`. Line 16 `import { tick } from 'svelte';`: after edit (b), run `grep -c "tick(" src/components/forum/kiosk/KioskNav.svelte`; if `0`, delete line 16 (an unused import counts against svelte-check).

(b) Replace lines 28–85 (from `// ─── Masthead search (2026-09-24)` through the closing `});` of the Escape/pointerdown `$effect`) with:

```ts
  // ─── Site search modal (2026-09-25) ──────────────────────────────────
  // The magnifier disc opens SearchModal (centred box over a blurred scrim,
  // mounted as the last child of <header> so it shares the header's z-50
  // stacking context and covers the bottom nav). Escape / scrim / Esc button
  // close it inside the modal; the modal reports whether focus should return
  // to the disc. `searchOpen` also keeps the hide-on-scroll bar in place and
  // bumps the header's z-index (below), like the menus.
  let searchOpen = $state(false);
  function toggleSearch() { searchOpen = !searchOpen; }
  function closeSearch(restoreFocus: boolean) {
    if (!searchOpen) return;
    searchOpen = false;
    if (restoreFocus) (headerEl?.querySelector('[data-mast-search-btn]') as HTMLElement | null)?.focus({ preventScroll: true });
  }
```

(c) Delete lines 329–338 (`{#if searchOpen && wide}` … `{/if}` — the inline form). Line 339 `<MastSearch open={searchOpen} onToggle={toggleSearch} {currentPath} />` stays.

(d) Replace lines 386–396 (`{#if searchOpen && !wide}` … `{/if}` — the strip) with:

```svelte
  {#if searchOpen}
    <SearchModal onClose={closeSearch} />
  {/if}
```
Leave lines 119–127, 158–160 and 246 untouched (`searchOpen` still locks the bar and bumps `z-50`).

- [ ] **Step 4: `MastSearch.svelte`** — header comment line 5–6: replace „Click opens the strip under the bar (markup in KioskNav);" with „Click opens the search modal (SearchModal, mounted by KioskNav);". On the `<button …>` replace `aria-controls="mast-search"` with `aria-controls="site-search" aria-haspopup="dialog"`.

- [ ] **Step 5: Modal probe**

```js
// scratchpad/search-modal-probe.cjs — masthead search modal on the dev server
// :4655 at three widths + reduced motion. Password from scratchpad/devpw.txt is
// only ever passed to page.fill.
// Run: NODE_PATH=$(npm root -g)/@playwright/cli/node_modules node scratchpad/search-modal-probe.cjs
const { chromium } = require('playwright'); const fs = require('fs');
const PW = fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim();
const login = async (p) => {
  await p.goto('http://localhost:4655/login?redirect=%2Fforum');
  await p.fill('input[type="email"]', 'jonas@mahalle-dev.test'); await p.fill('input[type="password"]', PW);
  await p.keyboard.press('Enter'); await p.waitForURL((u) => u.pathname === '/forum'); await p.waitForTimeout(1500);
};
(async () => {
  const b = await chromium.launch(); let fails = 0;
  const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${x}`); if (!ok) fails++; };
  for (const [name, vw, touch] of [['desktop', { width: 1400, height: 900 }, false], ['laptop', { width: 1024, height: 800 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const p = await (await b.newContext({ viewport: vw, hasTouch: touch, deviceScaleFactor: 2 })).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await login(p);
    await p.evaluate(() => window.scrollTo(0, 400)); await p.waitForTimeout(400);
    await p.evaluate(() => window.scrollTo(0, 380)); await p.waitForTimeout(400); // scroll up a little: the bar returns
    const disc = p.locator('[data-mast-search-btn]');
    check(`${name}: one disc, aria-haspopup=dialog`, (await disc.count()) === 1 && (await disc.getAttribute('aria-haspopup')) === 'dialog');
    await disc.click(); await p.waitForTimeout(350);
    const dlg = p.locator('#site-search[role="dialog"][aria-modal="true"]');
    check(`${name}: dialog open, exactly one`, (await dlg.count()) === 1);
    check(`${name}: input focused`, await p.evaluate(() => document.activeElement?.closest('#site-search') !== null && document.activeElement?.tagName === 'INPUT'));
    check(`${name}: scrim + box are siblings, box not inside scrim`, await p.evaluate(() => { const s = document.querySelector('[data-search-scrim]'); const bx = document.getElementById('site-search'); return !!s && !!bx && s.parentElement === bx.parentElement && !s.contains(bx); }));
    check(`${name}: scrim blurs`, await p.evaluate(() => { const cs = getComputedStyle(document.querySelector('[data-search-scrim]')); return (cs.backdropFilter || cs.webkitBackdropFilter || 'none') !== 'none'; }));
    check(`${name}: page scroll locked (html only)`, await p.evaluate(() => { const y = scrollY; scrollBy(0, 300); return scrollY === y && getComputedStyle(document.documentElement).overflow === 'hidden' && document.body.style.overflow === ''; }));
    check(`${name}: header not hidden while open`, (await p.locator('header').getAttribute('data-mast-hidden')) === null);
    const box = await dlg.boundingBox();
    check(`${name}: box within viewport, ≤ 640 wide, 16 px gutters on phones`, box.x >= 16 && box.x + box.width <= vw.width - 16 + 0.5 && box.width <= 640.5 && (vw.width > 700 || Math.abs(box.width - (vw.width - 32)) < 1), `${box.x},${box.width}`);
    check(`${name}: box top in the upper third`, box.y < vw.height / 3, String(box.y));
    check(`${name}: idle hint names five sections`, /Forum · Kalender · Markt · News · Blog|Forum · Calendar/.test(await dlg.innerText()));
    await p.keyboard.type('Test'); await p.waitForTimeout(60);
    const mid = await dlg.innerText();
    check(`${name}: no stale hits / empty state mid-debounce`, !/Nichts gefunden|Nothing found/.test(mid) && (await dlg.locator('a.sh').count()) === 0);
    await p.waitForTimeout(1200);
    const groups = await dlg.locator('[data-modal-group]').evaluateAll((els) => els.map((e) => e.dataset.modalGroup));
    check(`${name}: live hits in ≥ 2 sections`, groups.length >= 2, groups.join(','));
    check(`${name}: ≤ 3 rows per section`, await dlg.locator('[data-modal-group]').evaluateAll((els) => els.every((e) => e.querySelectorAll('a.sh').length <= 3)));
    check(`${name}: footer link → /search?q=`, (await dlg.locator('a.sm-foot').getAttribute('href')) === '/search?q=Test');
    await p.screenshot({ path: `scratchpad/search-modal-${name}.png` });
    await p.keyboard.press('ArrowDown');
    check(`${name}: ArrowDown focuses the first hit`, await p.evaluate(() => document.activeElement?.classList.contains('sh') === true));
    await p.keyboard.press('ArrowUp');
    check(`${name}: ArrowUp back to the input`, await p.evaluate(() => document.activeElement?.tagName === 'INPUT'));
    await p.keyboard.press('Shift+Tab');
    check(`${name}: Shift+Tab from the input wraps to the footer link`, await p.evaluate(() => document.activeElement?.classList.contains('sm-foot') === true));
    await p.keyboard.press('Tab');
    check(`${name}: Tab from the footer wraps to the input`, await p.evaluate(() => document.activeElement?.tagName === 'INPUT'));
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    check(`${name}: Escape closes, scroll restored, focus on the disc`, (await dlg.count()) === 0 && await p.evaluate(() => getComputedStyle(document.documentElement).overflow !== 'hidden' && document.activeElement?.hasAttribute('data-mast-search-btn')));
    await disc.click(); await p.waitForTimeout(300);
    await p.mouse.click(vw.width - 8, vw.height - 8); await p.waitForTimeout(150);
    check(`${name}: scrim click closes`, (await dlg.count()) === 0);
    await disc.click(); await p.waitForTimeout(300);
    await p.keyboard.type('Test'); await p.keyboard.press('Enter');
    await p.waitForURL('**/search?q=Test**'); await p.waitForTimeout(1200);
    check(`${name}: Enter → /search with SSR hits, disc is a link there`, (await p.locator('[data-search-page] a.sh').count()) > 0 && (await p.locator('a.ms-btn[aria-current="page"]').count()) === 1 && (await p.locator('#site-search').count()) === 0);
    check(`${name}: no page errors`, errs.length === 0, errs.join(' | '));
    await p.close();
  }
  // Reduced motion: no open animation on scrim or box.
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' })).newPage();
  await login(p); await p.locator('[data-mast-search-btn]').click(); await p.waitForTimeout(200);
  check('reduced motion: no animation', await p.evaluate(() => ['[data-search-scrim]', '#site-search'].every((s) => getComputedStyle(document.querySelector(s)).animationName === 'none')));
  await p.close(); await b.close();
  console.log(fails ? `${fails} FAILED` : 'all green'); process.exit(fails ? 1 : 0);
})();
```

- [ ] **Step 6: Run the probe, look at the screenshots**

Run: `NODE_PATH=$(npm root -g)/@playwright/cli/node_modules node scratchpad/search-modal-probe.cjs` → `all green` (67 checks). `rm scratchpad/mast-search-probe.cjs`. Copy `scratchpad/search-modal-{desktop,laptop,phone}.png` to `/mnt/c/Users/atakee/Downloads/` and look at all three (Read tool): the box must read as a paper card with the ink frame and 4 px print shadow, the scrim visibly blurred, the bar visible above the scrim, hits in ≥ 2 section groups with coloured kickers. Fix and rerun until they do.

- [ ] **Step 7: Commit**

```bash
git add src/components/search/SearchModal.svelte src/components/forum/kiosk/KioskNav.svelte src/components/forum/kiosk/MastSearch.svelte src/styles/global.css
git commit -m "masthead: magnifier opens a centred search modal over a blurred scrim (all sections, live hits); strip and inline field removed"
```

---

### Task 5: Gates, docs, handoff

**Files:**
- Modify: `src/components/forum/kiosk/CLAUDE.md` (the „Search (2026-09-24)" section, lines 287–288)
- Create: `src/components/search/CLAUDE.md`
- Modify: `CLAUDE.md` (root, line 263 sentence; the `history.replaceState` offender note already excludes SearchPage)
- Modify: `.remember/remember.md`, memory `project_open_followups.md` + `MEMORY.md` (local, not in the repo)

- [ ] **Step 1: All gates**

```bash
npx tsx --test src/lib/search/siteSearch.test.ts src/lib/forum/searchQuery.test.ts   # 13 pass
pnpm type-check 2>&1 | grep -c "error TS"                                              # ≤ 23
npx -y svelte-check@4 2>&1 | tail -3                                                    # errors ≤ 89
pnpm build 2>&1 | tail -5                                                               # green
grep -c "sm-scrim" .vercel/output/static/_astro/*.css | grep -v ":0"                   # the modal CSS is in the route-linked bundle (global.css)
```
Then, with the dev server up, all three probes green again (`site-search-probe.mts`, `search-page-probe.cjs`, `search-modal-probe.cjs`). Stop the dev server: `fuser -k 4655/tcp`.

- [ ] **Step 2: Area doc** — create `src/components/search/CLAUDE.md`:

```markdown
# Site search (`/search`, masthead modal) — since 2026-09-25

One endpoint, one shape: `GET /api/search?q=` (`src/pages/api/search.ts`, members only, `normalizeQuery` 2–80 chars, 300/h per member, `no-store` + `Vary: Cookie`) answers `SiteSearchResult` — `{ q, hits: { forum, calendar, marketplace, news, blog } }`, every value an array of the unified `SiteHit` row (`section`, `kind`, `id`, `href`, `title`, `excerpt` ≤ 160 chars, `date`, `sub`, optional `tags`/`price`/`allDay`). Built by `searchSite()` in `src/lib/search/siteSearchStore.ts` (server): five legs in parallel, each under the visibility filter of its own index page — forum `searchForum()` unchanged (`src/lib/forum/searchStore.ts`), events `buildModerationFilter` with no month window, listings `buildListingsFilter(userId)` = the browse grid (21-day freshness, own listings always), news the `GET /api/news` filter (approved or own pending/rejected, no window), blog in memory over the content collection with drafts never (`searchBlogEntries()`, pure). A failing leg fails the request — user 2026-09-25: „all or nothing — a halfway search wouldnt bring anything but frustration". Pure module `src/lib/search/siteSearch.ts` (types, `SECTIONS` order, `SECTION_ACCENT`, `eventHref()` with the event day in **Europe/Berlin** — the server runs UTC, `EventDetailModal.shareUrl()` formats in the browser —, `plainMdx()`, the blog leg, the forum adapter; tests `npx tsx --test src/lib/search/siteSearch.test.ts`). `src/lib/search/blogEntries.ts` reads `astro:content` (server, not unit-testable, so it returns drafts too and the pure leg drops them).

**Islands.** `SearchPage.svelte` (`/search`, SSRs the first `?q=`, section chips ride in `?s=`, groups in nav order, `history.replaceState(history.state, …)`) and `SearchModal.svelte` (masthead) share `createSearchRunner()` in `src/lib/search/searchRunner.svelte.ts` (runes module: debounce 250 ms, last request wins, `pending` keeps the empty state off during the debounce — review 09-24) and `SearchHit.svelte` (one paper card per hit, kicker in the section accent, forum posts keep `PostTypeChip`, comments the ↪ kicker + parent title; `compact` in the modal). `search.astro` passes `tour={false}` and no `page` (ochre app-level bars).

**Modal.** Opened by the magnifier disc (`MastSearch.svelte`, `.ms-*`), mounted by `KioskNav.svelte` as the last child of `<header>` while `searchOpen` (which also bumps the header to `z-50` over the bottom nav and pins the hide-on-scroll bar). `.sm-scrim` (blur 6 px, 35 % ink) and `#site-search.sm-box` are SIBLINGS — the blur must never be an ancestor of the fixed box (root CLAUDE.md, containing block). Box `max-width 640`, 16 px gutters, top `8dvh` on phones (keyboard room), `14vh` from `md`; `lockPageScroll()` (html-only); focus into the input on open; ArrowUp/Down and a Tab trap cycle input → hits → „Alle N Treffer →"; Escape, the Esc button and a scrim click close instantly (no exit motion, the notification panel's ruling); focus returns to the disc when it closes from the keyboard or from inside the box. Up to 3 hits per section (`MODAL_PER_SECTION`), Enter → full navigation to `/search?q=`. Styles `.sm-*` in `global.css` (nested-island rule), no animation under reduced motion. Replaced the strip under the bar (09-24) and the inline field ≥ 1280 px (09-25 morning, `258ac47f`) the same day — user: „i didnt like the idea to slide to the left".

**Copy** (`search.*`, `nav.search.placeholder` in `kiosk-i18n.ts`) are drafts the user rewords. **Probes** (dev :4655, `scratchpad/`, gitignored): `site-search-probe.mts` (19, fixtures for events/listings/news in the dev DB, visibility both ways), `search-page-probe.cjs` (24), `search-modal-probe.cjs` (67 incl. reduced motion). **Known limits:** regex search (a text index is the next step when a section outgrows it); listings created before `descriptionPlainText` match on the title only; İ is not the capital of i for Mongo/JS case folding.
```

- [ ] **Step 3: Forum area doc** — replace the whole „Search (2026-09-24)" section (lines 287–288 of `src/components/forum/kiosk/CLAUDE.md`) with:

```markdown
## Search
Site-wide since 2026-09-25 — see `src/components/search/CLAUDE.md`. The forum leg is `searchForum()` in `src/lib/forum/searchStore.ts` over the pure `src/lib/forum/searchQuery.ts` (query 2–80 chars, regex-escaped, excerpt ≤ 160 chars, `splitFirstMatch()` regex-based for Turkish İ; tests `npx tsx --test src/lib/forum/searchQuery.test.ts`): three post kinds + comments under `buildModerationFilter(userId)`, a comment only with a visible parent, authors `name`/`handle` only. The masthead disc (`MastSearch.svelte`, `.ms-*`) opens the site-wide modal; the strip under the bar (09-24) and the inline field (09-25 morning) are gone. History: before 09-24 `/search` was orphaned and searched 200 discussions client-side.
```

- [ ] **Step 4: Root `CLAUDE.md`** — line 263, replace the sentence starting `**Forum search since 2026-09-24**:` with:

```markdown
**Search since 2026-09-24, site-wide since 2026-09-25**: masthead magnifier → centred modal over a blurred scrim → `/search`; one endpoint `GET /api/search` over Forum, Kalender, Markt, News and Blog, each under its own index page's visibility (`src/lib/search/`, area file `src/components/search/CLAUDE.md`).
```

- [ ] **Step 5: Commit, then memory + handoff (local)**

```bash
git add src/components/search/CLAUDE.md src/components/forum/kiosk/CLAUDE.md CLAUDE.md docs/superpowers/plans/2026-09-25-search-modal-all-sections.md
git commit -m "docs: site search modal over all sections + plan"
```
Then update `project_open_followups.md` (top entry: modal + all sections live, commit hash after push) and `.remember/remember.md`. Push only on the user's word; after the deploy: `curl -sI https://mahalle.digital/api/search?q=test | grep -i "x-vercel-id\|HTTP"` → `401` + `fra1::fra1`; then a logged-in prod check with the throwaway account through `scratchpad/prod-search-check.mjs` adapted to assert the five keys, and one screenshot of the modal on prod for the user.
