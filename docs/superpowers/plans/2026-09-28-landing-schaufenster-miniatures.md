# Schaufenster Miniatures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the six live Schaufenster frames into faithful miniatures of each section's real phone screen (bar, kicker, title, count line, pills, first card) drawn from today's content.

**Architecture:** The data layer grows a handful of fail-soft fields on the cached `schaufenster` payload (counts, month days, air components, Kiez stand). The pure `buildFrames()` view models carry them. In `LandingPage.svelte` every live frame body becomes a 390 × 650 px replica authored at real phone size with the sections' own Tailwind class strings (phone variants only) and i18n keys, scaled into the frame with `transform: scale()`. Strip, motion, fallbacks and privacy stay as built on `feat/landing-schaufenster`.

**Tech Stack:** Astro 5 SSR, Svelte 5 runes, Tailwind 3.4 utilities (global), MongoDB driver, `node:test` via `npx tsx --test`, Playwright via `NODE_PATH="$(npm root -g)/@playwright/cli/node_modules"`.

**Spec:** `docs/superpowers/specs/2026-09-28-landing-schaufenster-miniatures-delta.md` (amends `2026-09-28-landing-schaufenster-design.md`)

## Global Constraints

- Branch `feat/landing-schaufenster` in worktree `.claude/worktrees/schaufenster`; never main. Merge is the owner's word.
- Gates on every commit: `npx astro sync` first; `pnpm type-check 2>&1 | grep -c 'error TS'` → 23; `npx -y svelte-check@4 2>&1 | tail -1` → ≤ 87 errors and no new diagnostic in `LandingPage.svelte`; affected `node:test` files green.
- Commit messages: ONE line, single-quoted, no ASCII `"`, NO trailer of any kind (no Co-Authored-By, no Generated-with). `git add` only named files; never `scratchpad/`, `.superpowers/`, `.env`.
- Privacy: no member name, handle, avatar or e-mail; forum card author row → kind chip + relative time; no event location; no seller. The blog byline (editorial) stays.
- Every number shown must be real; a number that cannot be computed is omitted, never invented; a real 0 is shown as „0".
- Replica box: `390 × 650` CSS px, `transform-origin: top left`, `transform: scale(var(--sf-scale))`; `--sf-scale: calc(194 / 390)` in the base rule, `calc(230 / 390)` inside the `max-width: 1023px` block (frame inner widths after the 3 px border).
- Copy the sections' Tailwind class strings but DROP every responsive variant (`md:`, `lg:`, `min-[…]:`, `max-[…]:`) and every `sticky`/`transition`/`hover:`/`focus:` utility: the replica is always the phone rendering, static.
- No new copy: reuse the sections' keys; the DRAFT keys `lnd.sf.title.*`, `lnd.sf.today`, `lnd.sf.air`, `lnd.sf.airMute`, `lnd.sf.pop`, `lnd.sf.more`, `lnd.sf.kind.*`, `lnd.sf.forum.week`, `lnd.sf.event.weekend` are deleted from BOTH dictionaries in Task 6. `lnd.sf.kicker`, `lnd.sf.hint.*`, `lnd.sf.pause/play`, `lnd.sf.region`, `lnd.sf.bar.*`, `lnd.sf.cap.*` stay.
- All styles in `LandingPage.svelte`'s `<style>` with the `.lnd-sf-` prefix (Tailwind utilities inline are fine); no child `.svelte`; no `filter`.
- Kicker date and time in the replicas are formatted from the payload's `computedAt` (Europe/Berlin), never from `Date.now()` — SSR and hydration must print the same string.
- Dev server for probes: port 4655 from this worktree (`fuser -k 4655/tcp 2>/dev/null; (pnpm dev --port 4655 > /tmp/dev4655.log 2>&1 &)`); dev-DB writes limited to `scratchpad/landing-cache-clear.mts`.

## Review Focus

1. A pre-release cached payload (no `forumStats`, `calendar`, `marketStats`, `kurierStats`, `kiez`) must still render every frame: live where the old fields suffice, the count lines simply omitted. (Test in Task 1.)
2. A month whose first day is a Sunday (the grid must start on Monday and pad six cells) and a 31-day month starting on Saturday (six rows) must both render without a shifted weekday column. (Test in Task 1 via `monthCells()`.)
3. A forum post with no image and a listing whose `images` array is empty must render the card without an empty image box. (Probe in Task 3/4.)
4. An air reading whose components are all `null` (station silent) must show the muted strip with dashes, never „null". (Test in Task 1 for the view model, probe in Task 5.)
5. Long titles at 390 px replica width: a 140-character forum title clamps to two lines and the first card still starts above 650 px. (Probe in Task 3.)

---

### Task 1: View models — new peek fields, month cells, tests

**Files:**
- Modify: `src/lib/landing/frames.ts`
- Test: `src/lib/landing/frames.test.ts` (extend)

**Interfaces:**
- Produces (all exported from `frames.ts`, still dependency-pure):

```ts
export interface ForumStats { total: number; newSinceYesterday: number; discussedToday: number }
export interface ForumPeek { kind: 'discussion' | 'announcement' | 'recommendation'; title: string; tags: string[]; createdAt: string; image?: string; likes?: number; comments?: number; views?: number }
export interface CalendarPeek { monthCount: number; days: { day: number; category: string }[] }
export interface MarketStats { available: number; newSinceYesterday: number; fresh: number }
export interface ListingPeek { title: string; image: string | null; kind: 'sell' | 'exchange' | 'gift'; price: number | null; photos?: number; createdAt?: string }
export interface KurierStats { issue: number; articles: number; sources: number }
export interface KurierPeek { title: string; sourceName: string; sourceUrl: string; imageUrl?: string; sektion?: string }
export interface AirComponents { pm10: number | null; no2: number | null; o3: number | null; co: number | null }
export interface KiezPeek { stand: string | null; areas: number | null; kw: number; lqiWeekMean: number | null; components: AirComponents | null; readingAt: string | null }
export interface SchaufensterData {
  forum: ForumPeek | null; forumStats?: ForumStats | null;
  event: EventPeek | null; calendar?: CalendarPeek | null;
  listing: ListingPeek | null; marketStats?: MarketStats | null;
  kurierStats?: KurierStats | null;
  kiez?: KiezPeek | null;
}
export interface BlogPeek { slug: string; title: string; description: string; pubDateISO: string; coverSrc?: string; author?: string; minutes?: number }
export interface BlogMeta { total: number; latestISO: string | null; tags: { tag: string; n: number }[] }
export interface FrameInput { …as before…; blog: BlogPeek | null; blogMeta?: BlogMeta | null; computedAt?: string }
export type Live =
  | { key: 'forum'; kind; title; tags; createdAt; image?: string; likes?: number; comments?: number; views?: number; stats: ForumStats | null }
  | { key: 'calendar'; monthCount: number | null; days: { day: number; category: string }[]; next: EventPeek | null }
  | { key: 'marketplace'; title; image; kind; price; photos: number | null; createdAt: string | null; stats: MarketStats | null }
  | { key: 'newsboard'; lead: KurierPeek; more: KurierPeek[]; stats: KurierStats | null }
  | { key: 'schillerkiez'; airGrade; airSpark; population; kiez: KiezPeek | null }
  | { key: 'blog'; slug; title; description; pubDateISO; coverSrc?; author?: string; minutes?: number; meta: BlogMeta | null };
export function monthCells(year: number, month1to12: number, days: { day: number; category: string }[]): { day: number | null; category: string | null }[]  // 42 cells, Monday-first, null = padding
export function berlinYearMonth(iso: string): { year: number; month: number; day: number }  // Europe/Berlin parts of an ISO instant
```
- The calendar frame is live when `calendar` is present (the grid is real even with 0 events) OR `event` is present (old payload): `monthCount` is `null` and `days` empty on an old payload.

- [ ] **Step 1: Write the failing tests (append to `frames.test.ts`)**

```ts
import { monthCells, berlinYearMonth } from './frames';

test('new stats ride on the live view models and are null on an old payload', () => {
  const frames = buildFrames({ ...FULL, schaufenster: { ...FULL.schaufenster, forumStats: { total: 17, newSinceYesterday: 2, discussedToday: 1 }, calendar: { monthCount: 26, days: [{ day: 4, category: 'kiez' }] }, marketStats: { available: 1, newSinceYesterday: 0, fresh: 0 }, kurierStats: { issue: 269, articles: 6, sources: 9 }, kiez: { stand: '30.06.2026', areas: 4, kw: 40, lqiWeekMean: 2.4, components: { pm10: 2, no2: 1, o3: 3, co: 1 }, readingAt: '2026-09-28T17:00:00.000Z' } }, blogMeta: { total: 11, latestISO: '2026-09-23T00:00:00.000Z', tags: [{ tag: 'wahl2026', n: 9 }] } }, FALLBACKS);
  const f = frames[0].live!; if (f.key === 'forum') assert.equal(f.stats?.total, 17);
  const c = frames[1].live!; if (c.key === 'calendar') { assert.equal(c.monthCount, 26); assert.equal(c.days[0].day, 4); }
  const m = frames[2].live!; if (m.key === 'marketplace') assert.equal(m.stats?.available, 1);
  const n = frames[3].live!; if (n.key === 'newsboard') assert.equal(n.stats?.issue, 269);
  const k = frames[4].live!; if (k.key === 'schillerkiez') assert.equal(k.kiez?.components?.o3, 3);
  const b = frames[5].live!; if (b.key === 'blog') assert.equal(b.meta?.total, 11);
  const old = buildFrames(FULL, FALLBACKS); // no new fields
  const of = old[0].live!; if (of.key === 'forum') assert.equal(of.stats, null);
  const oc = old[1].live!; if (oc.key === 'calendar') { assert.equal(oc.monthCount, null); assert.deepEqual(oc.days, []); assert.equal(oc.next?.title, 'Tag der offenen Tür'); }
});

test('calendar frame is live from the month data alone, even with zero events', () => {
  const frames = buildFrames({ ...EMPTY, schaufenster: { forum: null, event: null, listing: null, calendar: { monthCount: 0, days: [] } } }, {});
  assert.deepEqual(frames.map((f) => f.key), ['calendar']);
});

test('monthCells is Monday-first with 42 cells', () => {
  // February 2026 starts on a Sunday → 6 leading blanks; 28 days; padding to 42
  const feb = monthCells(2026, 2, [{ day: 3, category: 'kiez' }]);
  assert.equal(feb.length, 42);
  assert.deepEqual(feb.slice(0, 7).map((c) => c.day), [null, null, null, null, null, null, 1]);
  assert.equal(feb[8].category, 'kiez'); // index 6 = day 1, index 8 = day 3
  // August 2026 starts on a Saturday, 31 days → 5 leading blanks, still 42 cells, last day at index 35
  const aug = monthCells(2026, 8, []);
  assert.equal(aug[5].day, 1); assert.equal(aug[35].day, 31); assert.equal(aug[36].day, null);
});

test('berlinYearMonth reads Europe/Berlin parts', () => {
  assert.deepEqual(berlinYearMonth('2026-09-30T22:30:00.000Z'), { year: 2026, month: 10, day: 1 }); // 00:30 Berlin on 1 Oct
});

test('kiez components all null stay null (muted strip), never zeroed', () => {
  const frames = buildFrames({ ...EMPTY, airSpark: [2], schaufenster: { forum: null, event: null, listing: null, kiez: { stand: null, areas: null, kw: 40, lqiWeekMean: null, components: { pm10: null, no2: null, o3: null, co: null }, readingAt: null } } }, {});
  const k = frames[0].live!; if (k.key === 'schillerkiez') assert.equal(k.kiez?.components?.pm10, null);
});
```

- [ ] **Step 2: Run, expect failure** — `npx tsx --test src/lib/landing/frames.test.ts` → FAIL (`monthCells` not exported).

- [ ] **Step 3: Implement**

Extend the interfaces exactly as in the Interfaces block. In `liveFor()`:

```ts
    case 'forum': {
      const f = sf.forum; if (!f || !hasText(f.title)) return null;
      return { key, kind: f.kind, title: f.title.trim(), tags: (f.tags ?? []).filter(hasText).slice(0, 3), createdAt: f.createdAt,
        image: hasText(f.image) ? f.image : undefined, likes: num(f.likes), comments: num(f.comments), views: num(f.views), stats: sf.forumStats ?? null };
    }
    case 'calendar': {
      const cal = sf.calendar ?? null; const e = sf.event ?? null;
      if (!cal && !(e && hasText(e.title))) return null;
      return { key, monthCount: cal ? cal.monthCount : null, days: cal?.days ?? [], next: e && hasText(e.title) ? { ...e, title: e.title.trim() } : null };
    }
    case 'marketplace': {
      const l = sf.listing; if (!l || !hasText(l.title)) return null;
      return { key, title: l.title.trim(), image: hasText(l.image) ? l.image : null, kind: l.kind, price: l.kind === 'sell' && typeof l.price === 'number' ? l.price : null,
        photos: typeof l.photos === 'number' ? l.photos : null, createdAt: hasText(l.createdAt) ? l.createdAt : null, stats: sf.marketStats ?? null };
    }
    case 'newsboard': { …as before…; return { key, lead: items[0], more: items.slice(1, 3), stats: sf.kurierStats ?? null }; }
    case 'schillerkiez': { …alive check as before…; return { key, airGrade: input.airGrade, airSpark: spark, population: input.population, kiez: sf.kiez ?? null }; }
    case 'blog': { …; return { key, slug: b.slug, title: b.title.trim(), description: b.description ?? '', pubDateISO: b.pubDateISO, coverSrc: b.coverSrc, author: b.author, minutes: b.minutes, meta: input.blogMeta ?? null }; }
```
with `const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);`. Keep `EventPeek` as is; `weekendCount`/`weekCount` are removed from the Live types (their lines are gone from the replica).

Add:

```ts
/** Europe/Berlin calendar parts of an ISO instant. */
export function berlinYearMonth(iso: string): { year: number; month: number; day: number } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { year: g('year'), month: g('month'), day: g('day') };
}

/** 42 month-grid cells, Monday first; `null` day = padding. Category = the first event's category that day. */
export function monthCells(year: number, month1to12: number, days: { day: number; category: string }[]): { day: number | null; category: string | null }[] {
  const first = new Date(Date.UTC(year, month1to12 - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // 0 = Monday
  const count = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  const byDay = new Map<number, string>();
  for (const d of days) if (!byDay.has(d.day)) byDay.set(d.day, d.category);
  const cells: { day: number | null; category: string | null }[] = [];
  for (let i = 0; i < 42; i++) {
    const day = i - lead + 1;
    cells.push(day >= 1 && day <= count ? { day, category: byDay.get(day) ?? null } : { day: null, category: null });
  }
  return cells;
}
```

- [ ] **Step 4: Run, expect pass** — `npx tsx --test src/lib/landing/frames.test.ts` → all pass (old tests may need `weekCount`/`weekendCount` assertions removed — replace them with `stats === null` / `monthCount === null` checks).

- [ ] **Step 5: Commit** — `git add src/lib/landing/frames.ts src/lib/landing/frames.test.ts && git commit -m 'landing: miniature view models (stats, month cells, air components, blog meta)' -- src/lib/landing/frames.ts src/lib/landing/frames.test.ts`

---

### Task 2: Data — counts, month days, air components, Kiez stand, blog meta

**Files:**
- Modify: `src/lib/landing.ts` (`compute()`)
- Modify: `src/lib/kiez/airLog.ts` (`getAirHistory().lastReading` gains the four component grades)
- Modify: `src/types/kiezStats.ts` (the `lastReading` type)
- Modify: `src/lib/kiez/kiezViewModel.ts` (`export` the existing `formatStand`)
- Modify: `src/pages/index.astro` (blog meta + author + minutes)

**Interfaces:**
- Consumes: Task 1 types; `resolveSektion(aiCategory)` from `src/lib/newsboard/newsTaxonomy.ts`; `computeIssueNumber(now)` from `src/lib/newsboard/newsFormat.ts`; `getISOWeek` from `date-fns`; `readingMinutes(body)` + `compareNewest` from `src/lib/blog/beilage.ts`.
- Produces: `LandingData.schaufenster` with the Task 1 shape; `index.astro` passes `blog` (with `author`, `minutes`) and `blogMeta`.

- [ ] **Step 1: `lastReading` carries components**

`src/types/kiezStats.ts`: `lastReading: { ts: string; lqi: number; pm10?: number | null; no2?: number | null; o3?: number | null; co?: number | null } | null;`. In `getAirHistory()` (airLog.ts ~L157–185) project `pm10, no2, o3, co` in the `last` query and spread them into the returned object (`pm10: last[0].pm10 ?? null`, …).

- [ ] **Step 2: export `formatStand`** — change `function formatStand(` to `export function formatStand(` in `kiezViewModel.ts` (no other change).

- [ ] **Step 3: `compute()` additions (each in its own try/catch pushing `['schaufenster.<name>', err]` to `failures`)**

```ts
  const dayMs = 86_400_000;
  const sinceYesterday = new Date(now.getTime() - dayMs);      // the pages use rolling 24 h
  const since3h = new Date(now.getTime() - 3 * 3_600_000);
  const NO_WARN = { hasWarningLabel: { $ne: true } };

  // forum stats — „Themen" = the full public feed; „diskutiert heute" = posts whose newest visible comment is < 24 h old
  let forumStats: ForumStats | null = null;
  try {
    const cols = ['topics', 'announcements', 'recommendations'];
    const [totals, news] = await Promise.all([
      Promise.all(cols.map((c) => db.collection(c).countDocuments({ ...PUBLIC_MOD, ...NO_WARN }))),
      Promise.all(cols.map((c) => db.collection(c).countDocuments({ ...PUBLIC_MOD, ...NO_WARN, createdAt: { $gte: sinceYesterday } }))),
    ]);
    const recent = await db.collection('comments').aggregate([
      { $match: { createdAt: { $gte: sinceYesterday }, moderationStatus: { $nin: ['pending', 'rejected'] } } },
      { $group: { _id: '$relevantPostId' } }, { $count: 'n' },
    ]).toArray();
    forumStats = { total: totals.reduce((a, b) => a + b, 0), newSinceYesterday: news.reduce((a, b) => a + b, 0), discussedToday: recent[0]?.n ?? 0 };
  } catch (err) { failures.push(['schaufenster.forumStats', err]); }

  // calendar — current Berlin month: count + one entry per day with a public event (first category)
  let calendar: CalendarPeek | null = null;
  try {
    const { year, month } = berlinYearMonth(now.toISOString());
    const from = berlinMidnightUTC(year, month, 1);
    const to = berlinMidnightUTC(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1);
    const docs = await db.collection('events').find(
      { ...PUBLIC_MOD, ...NO_WARN, visibility: { $ne: 'private' }, startDate: { $gte: from, $lt: to } },
      { projection: { startDate: 1, category: 1 } }).sort({ startDate: 1 }).toArray();
    const seen = new Map<number, string>();
    for (const d of docs) { const day = berlinYearMonth(new Date(d.startDate).toISOString()).day; if (!seen.has(day)) seen.set(day, typeof d.category === 'string' ? d.category : 'kiez'); }
    calendar = { monthCount: docs.length, days: [...seen].map(([day, category]) => ({ day, category })) };
  } catch (err) { failures.push(['schaufenster.calendar', err]); }

  // market stats — the browse page's list (available, fresh ≤ 21 d) and its two windows
  let marketStats: MarketStats | null = null;
  try {
    const base = { ...PUBLIC_MOD, ...NO_WARN, status: 'available', $expr: { $gte: [{ $ifNull: ['$lastBumpedAt', '$createdAt'] }, new Date(now.getTime() - 21 * dayMs)] } };
    const [available, newSince, fresh] = await Promise.all([
      db.collection('listings').countDocuments(base),
      db.collection('listings').countDocuments({ ...base, createdAt: { $gte: sinceYesterday } }),
      db.collection('listings').countDocuments({ ...base, createdAt: { $gte: since3h } }),
    ]);
    marketStats = { available, newSinceYesterday: newSince, fresh };
  } catch (err) { failures.push(['schaufenster.marketStats', err]); }
```
Extend the existing listing peek with `photos: Array.isArray(doc.images) ? doc.images.length : 0, createdAt: new Date(doc.createdAt ?? now).toISOString()` (projection gains `createdAt`), and the forum `pick()` with projection `images, likes, views` plus a comments count: after picking the newest post, `comments: await db.collection('comments').countDocuments({ relevantPostId: doc._id, moderationStatus: { $nin: ['pending', 'rejected'] } })`, `likes: typeof doc.likes === 'number' ? doc.likes : 0`, `views: typeof doc.views === 'number' ? doc.views : 0`, `image: first images[].url when it is an https string`.

Kurier: inside the existing kurier block, after `kurier = docs.map(...)`, add `sektion: resolveSektion(typeof d.category === 'string' ? d.category : null)` to each item (projection gains `category`), and compute `kurierStats = { issue: computeIssueNumber(now), articles: await db.collection('news').countDocuments({ fetchDate: issueDay, moderationStatus: 'approved' }), sources: (await db.collection('news').distinct('sourceName', { fetchDate: issueDay, moderationStatus: 'approved' })).length }` in its own try (`null` when there is no issue).

Kiez:
```ts
  let kiez: KiezPeek | null = null;
  try {
    const latest = await db.collection('schillerkiez_demographics').aggregate([
      { $sort: { period: -1 } }, { $group: { _id: '$period', areas: { $addToSet: '$plr_code' }, date: { $first: '$date' } } }, { $sort: { _id: -1 } }, { $limit: 1 },
    ]).toArray();
    const valid = airSpark.filter((v): v is number => typeof v === 'number');
    const lr = freshReading; // set in the air block (see below)
    kiez = {
      stand: latest[0]?.date ? formatStand(String(latest[0].date)) : null,
      areas: Array.isArray(latest[0]?.areas) ? latest[0].areas.length : null,
      kw: getISOWeek(now),
      lqiWeekMean: valid.length ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10 : null,
      components: lr ? { pm10: lr.pm10 ?? null, no2: lr.no2 ?? null, o3: lr.o3 ?? null, co: lr.co ?? null } : null,
      readingAt: lr?.ts ?? null,
    };
  } catch (err) { failures.push(['schaufenster.kiez', err]); }
```
(`formatStand` expects the same string `kiez-stats.ts` puts in `lastUpdated` — `latestDemo.date`, the `date` field of the newest demographics period; the aggregate above reads it with `$first: '$date'`.) The muted rule stays the landing's: in the existing air block declare `let freshReading: AirHistoryResponse['lastReading'] = null;` before the `try` and set `freshReading = hist.lastReading;` inside the `if (fresh && hist.lastReading)` branch (import the `AirHistoryResponse` type from `../types/kiezStats`); stale → `freshReading` stays `null`, so `components: null`, while `readingAt` uses `hist.lastReading?.ts ?? null` (hoist `hist` the same way as `let lastTs: string | null = null`).

`schaufenster` becomes `{ forum: sfForum, forumStats, event: sfEvent, calendar, listing: sfListing, marketStats, kurierStats, kiez }`. Import `berlinYearMonth` and the new types from `./landing/frames`, `resolveSektion`, `computeIssueNumber`, `getISOWeek`, `formatStand`.

- [ ] **Step 4: `index.astro`** — replace the blog block with:

```ts
import { compareNewest, readingMinutes } from '../lib/blog/beilage';
import type { BlogPeek, BlogMeta } from '../lib/landing/frames';
let blog: BlogPeek[] = []; let blogMeta: BlogMeta | null = null;
try {
  const entries = (await getCollection('blog', ({ data: d }) => !d.draft))
    .map((e) => ({ e, id: e.id, pubDateISO: e.data.pubDate.toISOString(), sortISO: e.data.sortDate?.toISOString() }))
    .sort(compareNewest);
  const first = entries[0]?.e;
  const counts = new Map<string, number>();
  for (const { e } of entries) for (const t of e.data.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  blogMeta = { total: entries.length, latestISO: entries[0]?.pubDateISO ?? null, tags: [...counts].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n).slice(0, 4) };
  if (first) {
    let coverSrc: string | undefined;
    if (first.data.cover) { try { coverSrc = (await getImage({ src: first.data.cover, width: 480, format: 'webp' })).src; } catch (err) { console.error('[landing] blog cover failed:', err); } }
    blog = [{ slug: first.id, title: first.data.title, description: first.data.description ?? '', pubDateISO: first.data.pubDate.toISOString(), coverSrc, author: first.data.author, minutes: readingMinutes(first.body ?? '') }];
  }
} catch (err) { console.error('[landing] blog teaser failed:', err); }
```
(check the collection schema for the tags field name — `tags` in `src/content.config.ts`; if it is named differently, use that name) and pass `{blogMeta}` to `<LandingPage client:load {data} {blog} {blogMeta} />`. In `LandingPage.svelte` add the prop `blogMeta: BlogMeta | null` and pass `blogMeta` and `computedAt: data.computedAt` into `buildFrames`.

- [ ] **Step 5: Gates + probe** — `npx astro sync`; tsc 23; svelte-check ≤ 87. Clear the dev cache, curl `/` once, run `scratchpad/landing-data-probe.mts`: `schaufenster` keys now include `forumStats,calendar,marketStats,kurierStats,kiez`; print key NAMES only.

- [ ] **Step 6: Commit** — `git add src/lib/landing.ts src/lib/kiez/airLog.ts src/types/kiezStats.ts src/lib/kiez/kiezViewModel.ts src/pages/index.astro src/components/landing/LandingPage.svelte` (the last one only for the prop) `&& git commit -m 'landing: miniature data (counts, month days, air components, Kiez stand, blog meta)' -- <same files>`

---

### Task 3: Replica shell + Forum and Kalender miniatures

**Files:**
- Modify: `src/components/landing/LandingPage.svelte` (markup + `<style>`)
- Read for recipes (phone variants only): `src/components/forum/kiosk/KioskNav.svelte` L253–375 (bar), `src/components/forum/kiosk/ForumIndexInner.svelte` L620–660 (title block + stats), `src/components/forum/kiosk/TagBar.svelte` L86–165 (pills), `src/components/forum/kiosk/ForumPostCard.svelte` L232–420 (card), `src/components/calendar/kiosk/CalendarTitleBlock.svelte`, `CalendarSidebar.svelte` L60–130 (month grid), `CalCategoryRail.svelte` (category pills), `src/lib/calendar/categories.ts` (category colours).

**Interfaces:**
- Consumes: `Live` view models from Task 1; `monthCells`, `berlinYearMonth`; i18n keys `forum.stats.*`, `filter.all`, `chip.*`, `card.strap.*`, `cal.view.*`, `cal.mobile.statsMonthEvents`, `cal.cat.<key>.label`, the forum and calendar title keys (`forum.title.prefix/accent/suffix`, find the calendar's equivalents in `CalendarTitleBlock.svelte`).
- Produces: the shell used by Tasks 4–5: `.lnd-sf-repbox > .lnd-sf-rep` (390 × 650), the bar snippet `{@render bar(key)}` (Svelte 5 snippet), the kicker helper `kickerDate(iso)` → `{ dow: 'MONTAG', dm: '28. SEP.', hhmm: '19:32' }` from `computedAt` in Europe/Berlin.

- [ ] **Step 1: Shell**

Replace the live-frame body (`{#if f.live} <div class="lnd-sf-bar">…</div><div class="lnd-sf-body">…</div> {:else} <img …> {/if}`) with:

```svelte
{#if f.live}
  <div class="lnd-sf-repbox"><div class="lnd-sf-rep">
    {@render bar(f.key)}
    {#if f.live.key === 'forum'}{@render forumRep(f.live)}
    {:else if f.live.key === 'calendar'}{@render calendarRep(f.live)}
    {:else if f.live.key === 'marketplace'}{@render marketRep(f.live)}
    {:else if f.live.key === 'newsboard'}{@render kurierRep(f.live)}
    {:else if f.live.key === 'schillerkiez'}{@render kiezRep(f.live)}
    {:else if f.live.key === 'blog'}{@render blogRep(f.live)}{/if}
  </div></div>
{:else}
  <img class="lnd-sf-shot" …unchanged…>
{/if}
```
Snippets are declared at the top level of the markup (`{#snippet bar(key: SectionKey)} … {/snippet}` etc.); Tasks 4–5 fill `marketRep`, `kurierRep`, `kiezRep`, `blogRep` — in this task declare them with the old card markup moved inside so nothing breaks, and finish them in their own tasks.

Bar snippet — the real anatomy from `KioskNav.svelte`, decorative:

```svelte
{#snippet bar(key: SectionKey)}
  {@const S = SECTION[key]}
  <div class="lnd-sf-repbar border-b-2 border-ink" style="background: {S.lines}, var(--k-bar-wash), var(--k-bar-shade), linear-gradient({S.tint}, {S.tint})" aria-hidden="true">
    <div class="px-4 py-2 flex items-center justify-between">
      <span class="w-9 h-9 rounded-full bg-wine text-paper flex items-center justify-center font-bricolage font-bold text-xl leading-none" style="box-shadow: 0 0 0 2px var(--k-paper), inset 0 -0.25px 0 1.75px var(--k-wine), inset 0 0 0 2px var(--k-ink)">m</span>
      <span class="flex items-center gap-2">
        <span class="inline-flex items-center h-[25px] rounded-full border-2 border-paper font-dmmono text-[11px] uppercase tracking-[0.12em] bg-ink"><span class="inline-flex items-center justify-center h-[21px] px-2.5 leading-none rounded-l-full bg-paper text-ink">DE</span><span class="inline-flex items-center justify-center h-[21px] px-2.5 leading-none rounded-r-full bg-ink text-paper">EN</span></span>
        <span class="w-9 h-9 rounded-full border-2 border-paper bg-paper"></span>
        <span class="w-9 h-9 rounded-full border-2 border-paper bg-paper"></span>
        <span class="w-9 h-9 rounded-full border-2 border-paper bg-paper"></span>
      </span>
    </div>
  </div>
{/snippet}
```
(Audit-verified against `KioskNav.svelte` L312–330: the ACTIVE locale is the paper-filled half (`bg-paper text-ink`), the other half `bg-ink text-paper`; on the landing the active half follows `$locale` — swap the two class sets when `$locale === 'en'`. Copy the search/bell glyph SVGs from `MastSearch.svelte` / `NotificationBell.svelte` into the second and third discs so they read as the real discs; the fourth disc stays an empty paper disc.)

Kicker helper in the script:
```ts
  function kickerDate(iso: string | undefined): { dow: string; dm: string; hhmm: string } {
    const d = new Date(iso ?? Date.now());
    const loc = $locale === 'de' ? 'de-DE' : 'en-GB';
    const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(loc, { timeZone: 'Europe/Berlin', ...o }).format(d);
    return { dow: f({ weekday: 'long' }).toUpperCase(), dm: f({ day: 'numeric', month: 'short' }).toUpperCase(), hhmm: f({ hour: '2-digit', minute: '2-digit' }) };
  }
```
Use `data.computedAt` everywhere (never `Date.now()` in the template; the `?? Date.now()` is only the type guard).

CSS (replace the old `.lnd-sf-bar/.lnd-sf-body/.lnd-sf-card*/.lnd-sf-title/.lnd-sf-kicker…` rules — delete every rule the old bodies used and Tasks 3–5 no longer reference):
```css
  .lnd-sf-frame { --sf-scale: calc(194 / 390); }
  .lnd-sf-repbox { width: 100%; aspect-ratio: 390 / 650; overflow: hidden; position: relative; background: var(--k-paper); }
  .lnd-sf-rep { position: absolute; top: 0; left: 0; width: 390px; height: 650px; transform-origin: top left; transform: scale(var(--sf-scale)); overflow: hidden; background: var(--k-paper); color: var(--k-ink); font-size: 14px; line-height: 1.5; }
  .lnd-sf-repbar { height: 54px; }
  @media (max-width: 1023px) { .lnd-sf-frame { --sf-scale: calc(230 / 390); } }
```

- [ ] **Step 2: Forum miniature** (`{#snippet forumRep(l)}`) — the title block and stats copied from `ForumIndexInner.svelte` L624–660 with the phone variants only, then the filter rail (five pills with the TagBar phone pill class, „Alle" in the active state, `# Tags` chip as in `ForumIndexInner` L798), then ONE `ForumPostCard` replica: root `<article>` classes for the post's kind (discussion: paper-warm + 1.5 px ink border, no strap; announcement: ink background + paper text + teal strap `card.strap.announcement`; recommendation: paper-warm + moss strap `card.strap.recommendation` — read the header comment L1–30 and the markup), kind chip + `relTime(l.createdAt, $locale)` where the author row was, the image (`cloudinaryFit(optimizeCloudinary(l.image), 480)`, the card's image box classes) only when `l.image`, the `<h3>` title with the card's clamp classes, the tags line, and the footer `♥ {l.likes ?? 0} · 💬 {l.comments ?? 0} · 👁 {l.views ?? 0}` left and `→ lesen` (the card's own key) right. Count line: render only when `l.stats` (three numbers with `forum.stats.topics/new/discussed`).

- [ ] **Step 3: Kalender miniature** (`{#snippet calendarRep(l)}`) — kicker + title from `CalendarTitleBlock.svelte` (phone), `{l.monthCount} {$t['cal.mobile.statsMonthEvents']}` when `monthCount != null`, the view switch (three pills, „Monat" active), the month nav row `‹ {MONTH YEAR} ›` (month name via `Intl` from `computedAt`, Berlin), the category rail (`CalCategoryRail.svelte` phone pills: „Alle" active + the first three categories from `CATEGORY_ORDER` with their labels), then the grid: header row `M D M D F S S` (DE) / `M T W T F S S` (EN) with the sidebar's classes, then `{#each monthCells(y, m, l.days) as c}` 42 cells — day number, today's cell = the teal filled disc (the calendar's today recipe: `CalendarSidebar.svelte` L84–100, `isTodayDate` → the disc classes since 2026-09-22) and it carries the extra marker class `lnd-sf-today` (the probe counts exactly one); a dot under days with `c.category` coloured by `CATEGORY_STYLE[c.category].bgClass` (from `categories.ts`; unknown category → `kiez`) — but NOT under today (the sidebar hides the dot on the today cell: `dotClass && !today`, L100). „Today" = `berlinYearMonth(data.computedAt).day`. Below the grid the sidebar's hint sentence (its i18n key). `y, m` come from `berlinYearMonth(data.computedAt)`.

- [ ] **Step 4: Gates + look** — tsc 23; svelte-check ≤ 87 (no new LandingPage diagnostic); `curl -s http://localhost:4655/ | grep -c 'lnd-sf-rep"'` → ≥ 6; screenshots via `scratchpad/sf-look.cjs` at 390 and 1440, read both: forum and calendar frames look like the screenshots (bar with discs, kicker, title, pills, card / grid with today's disc). Fix overflow before committing. The four unfinished sections still render their old bodies.

- [ ] **Step 5: Commit** — `git add src/components/landing/LandingPage.svelte && git commit -m 'landing: replica shell, Forum and Kalender miniatures' -- src/components/landing/LandingPage.svelte`

---

### Task 4: Markt and Kurier miniatures

**Files:**
- Modify: `src/components/landing/LandingPage.svelte`
- Read for recipes: `src/components/marketplace/kiosk/browse/MarketTitleBlock.svelte`, `MarketFilterRail.svelte`, `ListingLead.svelte`; `src/components/newsboard/kiosk/browse/NewsTitleBlock.svelte`, `NewsMasthead.svelte`, `NewsFilterRail.svelte`, `NewsCard.svelte`, `primitives/SektionTag.svelte`, `primitives/ArticleImage.svelte`.

**Interfaces:**
- Consumes: the shell and `kickerDate` from Task 3; `Live` marketplace/newsboard from Task 1; keys `market.titlemeta.*`, `market.filter.kind.*`, `market.cat.*`, `market.lead.banner`, `news.masthead.*`, `news.filter.*`, `news.sektion.<key>`, the title keys in the two title blocks.

- [ ] **Step 1: Markt** (`{#snippet marketRep(l)}`) — kicker `MARKT · {dow} {dm}` (check `MarketTitleBlock` for its exact kicker composition), title, the two meta lines when `l.stats` (`{available} Anzeigen · {newSinceYesterday} neu seit gestern` / `{fresh} frisch im Kiez` with their dot glyphs as in the page), the ART rail (label + four pills, „Alle" active), a decorative search field (the rail's input classes, placeholder text from the page's key, `readonly`, `tabindex="-1"`, `aria-hidden`), the KATEGORIE rail (label + „Alle Kategorien" active + two category pills), then the `ListingLead` replica: banner strip `● {market.lead.banner} · {DD. MMM.} EINGESTELLT` only when `l.createdAt` is today (Berlin) — otherwise the plain date line the lead shows — the photo (`cloudinaryFit(optimizeCloudinary(l.image), 480)`, the lead's image box), title, kind chip (`market.filter.kind.<verkaufen|tausch|verschenken>` mapped from `sell|exchange|gift`), and the `n Fotos` strip when `l.photos` (find the lead's photo-count text key).

- [ ] **Step 2: Kurier** (`{#snippet kurierRep(l)}`) — the ink bar variant already comes from `bar('newsboard')`; then `NewsTitleBlock` (kicker `NEWS · AUS DEM KIEZ`, title), `NewsMasthead` phone layout: the italic nameplate „Schillerkiez Kurier", the line `{news.masthead.edition} · {issueAbbr} {stats.issue} · {stats.articles} {articles} · {stats.sources} {sources}` (only when `l.stats`), the SEKTION rail (`news.filter.sektion` label, „Alle" active + Politik/Kultur/Lokales pills) and the ZEITRAUM rail (Heute / Diese Woche / Diesen Monat), the „HEUTE" date-divider (`DateDivider.svelte` phone recipe), then the lead `NewsCard` replica: `ArticleImage` box with `l.lead.imageUrl` (`referrerpolicy="no-referrer"`, `onerror` hide), the `SektionTag` chip with `$t['news.sektion.' + (l.lead.sektion ?? 'lokales')]`, the title (card's clamp), the source line.

- [ ] **Step 3: Gates + look** — as in Task 3; both frames compared to the screenshots; the Kurier lead title must be fully visible with a 120-character title injected via the probe (the C1 lesson: no shrinking children).

- [ ] **Step 4: Commit** — `git add src/components/landing/LandingPage.svelte && git commit -m 'landing: Markt and Kurier miniatures' -- src/components/landing/LandingPage.svelte`

---

### Task 5: Kiez-Daten and Beilage miniatures

**Files:**
- Modify: `src/components/landing/LandingPage.svelte`
- Read for recipes: `src/components/kiez/kiosk/KzInstrumentStrip.svelte` (the ink air strip), `KzTitleBlock.svelte` (kicker/title/dek/facts/ZDW card), `src/components/blog/kiosk/BlMasthead.svelte`, `BeilageIndex.svelte` (tag chips, search, „NEU IN DER BEILAGE" card), `BlPostMeta.svelte`.

**Interfaces:**
- Consumes: Task 3 shell; `Live` schillerkiez/blog from Task 1; keys `kiez.strip.station`, `kiez.strip.live`, `kiez.kicker` (`{stand}`), `kiez.dek` (`{pop}`), `kiez.fact.areas`, `kiez.zdw.label`, `kiez.zdw.kw`, `kiez.zdw.read.airWeekMean`, `lnd.daten.grade.*`, `blog.mast.strap/from/posts/latest`, `blog.search.placeholder`, the „NEU IN DER BEILAGE" key from `BeilageIndex.svelte`, `BlPostMeta`'s minute key.

- [ ] **Step 1: Kiez-Daten** (`{#snippet kiezRep(l)}`) — the strip: `{kiez.strip.station} · {kiez.strip.live}` line, `Luftgüte: {airGrade} · {grade word}` + the reading time (`l.kiez.readingAt` Berlin `dd.mm. · HH:MM`) when `airGrade != null`, else the strip's muted state text (find its key in `KzInstrumentStrip.svelte` — the page's own „Messung pausiert" wording, NOT `lnd.sf.airMute`); the four boxes `PM10 · NO₂ · O₃ · CO` showing `l.kiez.components.<x>` or „–"; the 7-day bars from `airSpark` (the strip's bar recipe, `7-TAGE-VERLAUF` label). Then the title block: kicker `tStr($t['kiez.kicker'], { stand: l.kiez.stand })` (omit the `STAND` part when `stand` is null — split on ` · STAND` if needed), title, dek `tStr($t['kiez.dek'], { pop: formatted population })`, fact line `{pop} Einwohner · {areas} {kiez.fact.areas} · 2×/Jahr AfS-Sync` (find the exact keys; omit a fact whose value is null), then the ZDW card: `{kiez.zdw.label}` + `{tStr($t['kiez.zdw.kw'], { kw })}`, the big figure `LQI Ø {lqiWeekMean}` (locale decimal comma) + `$t['kiez.zdw.read.airWeekMean']` — only when `lqiWeekMean != null`.

- [ ] **Step 2: Beilage** (`{#snippet blogRep(l)}`) — `BlMasthead` phone recipe: strap, „Die Beilage" carved title, `{blog.mast.from} · {meta.total} {blog.mast.posts}`, `{blog.mast.latest}: {date}` (when `meta`), the tag chips row `#alle` + `#{tag} {n}` for `meta.tags`, the decorative search field with `blog.search.placeholder`, then the „NEU IN DER BEILAGE" chip + the newest post card as `BeilageIndex.svelte` renders its first item (cover when `coverSrc`, title, description clamp, `BlPostMeta` line `{date} · {author} · {minutes} Min`).

- [ ] **Step 3: Gates + look** — as before; both frames compared with the screenshots; muted air state checked by temporarily reading a payload with `components: null` (the dev station is currently paused, so this is the live case).

- [ ] **Step 4: Commit** — `git add src/components/landing/LandingPage.svelte && git commit -m 'landing: Kiez-Daten and Beilage miniatures' -- src/components/landing/LandingPage.svelte`

---

### Task 6: Cleanup, probe, docs, build

**Files:**
- Modify: `src/lib/kiosk-i18n.ts` (delete the unused DRAFT keys in both dictionaries), `src/components/landing/LandingPage.svelte` (dead CSS/script), `CLAUDE.md` (one sentence), the two specs' status lines, `scratchpad/schaufenster-probe.cjs` (gitignored).

- [ ] **Step 1: Sweep** — remove from BOTH dictionaries: `lnd.sf.title.*` (6), `lnd.sf.today`, `lnd.sf.air`, `lnd.sf.airMute`, `lnd.sf.pop`, `lnd.sf.more`, `lnd.sf.kind.*` (3), `lnd.sf.forum.week`, `lnd.sf.event.weekend`; grep `LandingPage.svelte` for each before deleting (zero hits required). Remove `berlinDayDisc`, `priceFmt`, `catLabel` from the script if unused, and every `.lnd-sf-*` CSS rule no snippet references (grep each class name).

- [ ] **Step 2: Probe additions** (in `scratchpad/schaufenster-probe.cjs`, both widths): `.lnd-sf-rep` count ≥ 6; for each live frame the replica's first card/grid top is < 650 (replica coordinates: `el.offsetTop` inside `.lnd-sf-rep`); the calendar grid shows the current Berlin month name and exactly one `.lnd-sf-today` cell; the Kurier masthead line contains `Nr. <computeIssueNumber(now)>` (recompute in the probe: copy the function's arithmetic from `newsFormat.ts` or read the SSR value and assert it is a positive integer); forum count line has three numbers; 140-char forum title injected → the h3 clamps and `.lnd-sf-rep` scrollHeight ≤ 650 + 1; all earlier checks stay green (autoplay, pause, wrap, reduced motion, CLS < 0.03 desktop / < 0.02 phone).

- [ ] **Step 3: Docs** — root `CLAUDE.md`, Project Overview Schaufenster sentence: append „Since the same night the six live frames are faithful 390 × 650 px miniatures of each section's phone top (bar, kicker, title, count line, pills, first card), scaled into the frame with `transform: scale()`; the sections' Tailwind classes and i18n keys are reused with responsive variants dropped." Spec status lines: both → „implemented on branch feat/landing-schaufenster (2026-09-29), owner's copy pending".

- [ ] **Step 4: Build + gates** — `pnpm build` green; manifest orphan check; `npx tsx --test src/lib/landing/frames.test.ts src/lib/landing/loop.test.ts src/utils/cloudinary.test.ts`; tsc 23; svelte-check ≤ 87.

- [ ] **Step 5: Commit** — `git add src/lib/kiosk-i18n.ts src/components/landing/LandingPage.svelte CLAUDE.md docs/superpowers/specs/2026-09-28-landing-schaufenster-design.md docs/superpowers/specs/2026-09-28-landing-schaufenster-miniatures-delta.md && git commit -m 'landing: miniature cleanup, probe, docs' -- <same files>`

---

## Handoff

Push the branch (`git push origin feat/landing-schaufenster`), give the owner the preview URL and the two final screenshots. Merge on his word.
