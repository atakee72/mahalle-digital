# Landing „Das Schaufenster" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the landing page's text teasers with a self-scrolling strip of six phone-shaped frames, one per main section, each drawn live from today's content (fallback: a static screenshot), so a stranger sees the app before the door.

**Architecture:** `getLandingData()` (server, 1 h Mongo cache) gains one `schaufenster` field with the newest forum post, the next event and the newest listing; `index.astro` adds the blog cover. A pure `buildFrames()` turns the payload into six frame view models with a per-frame zero rule. `LandingPage.svelte` (SSR, `client:load`) renders the strip in its own `<style>` block and drives autoplay with one `requestAnimationFrame` loop over a native scroll container (frames rendered twice for a seamless loop).

**Tech Stack:** Astro 5 SSR, Svelte 5 runes, MongoDB driver, `node:test` via `npx tsx --test`, Playwright (`@playwright/cli` bundle via `NODE_PATH`), sharp 0.34 (already in `node_modules`).

**Spec:** `docs/superpowers/specs/2026-09-28-landing-schaufenster-design.md`

## Global Constraints

- Work on branch `feat/landing-schaufenster` in a worktree; never commit to `main`; the merge is the owner's word.
- Gates on every commit: `pnpm type-check` ≤ 23 errors, `npx -y svelte-check@4` ≤ 89 errors (ratchet budgets, never raise), affected `node:test` files green.
- Commit messages: one line, no attribution footers, single-quoted, no ASCII `"` inside. Only `git add` named files; never `scratchpad/`, `.superpowers/`, `.env`.
- Frames never render a member's name, handle, avatar or e-mail. Forum: title, kind, tags only. Events: no location.
- No new HTTP endpoint; the landing reads `getLandingData()` lib-direct. `GET /api/kiez-heartbeat` keeps returning only `rows` + `computedAt`.
- No CSS `filter` / `backdrop-filter` anywhere in the strip; no carousel library; no `scroll-behavior: smooth` on the strip container.
- All strip styles live in `LandingPage.svelte`'s own `<style>` block with the `.lnd-sf-` prefix (a child `.svelte` imported only by the island loses its CSS in prod).
- Every new user-visible string is an i18n key in BOTH the `de` and `en` dictionaries of `src/lib/kiosk-i18n.ts`, marked `// DRAFT copy (2026-09-28) — the owner words UI copy himself`.
- Speed 40 px/s; pause on `pointerdown`, `touchstart`, `wheel`, `focusin`, hover, out of viewport, hidden document; resume 4 s after the last interaction with the pointer gone; nothing moves under `prefers-reduced-motion: reduce`.
- Frame geometry: phone 236 × 393 px, gap 14, left inset 16; desktop (≥ 1024 px) 200 × 333 px, gap 24, inset 48. Border 3 px section colour, radius 16, shadow `3px 3px 0 var(--k-ink)`.
- Section tints (bars): forum `var(--k-wine-deep)`, calendar `#3f7e8a`, marketplace `#d68a1a`, newsboard `var(--k-ink)` with paper lines, schillerkiez `var(--k-moss)`, blog `var(--k-rust)`.
- Fallback images: `public/assets/schaufenster/{forum,calendar,marketplace,newsboard,schillerkiez,blog}.webp`, 480 × 800.
- Dev server for probes: port 4655 (`fuser -k 4655/tcp` before starting, never `pkill`). The owner's own dev server on 3000 is not ours.

## Review Focus

1. A cached landing payload from before this release has no `schaufenster` field and its `kurier` items have no `imageUrl` — the page must render all six frames in fallback mode, never throw. (Test in Task 2.)
2. A third-party Kurier photo that 404s must not leave a broken image: the `<img>` hides itself on error and the title takes the space. (Probe in Task 7.)
3. A 140-character post title must clamp to two lines inside the fixed frame and never push the card out of its box. (Probe in Task 7 with a seeded long title.)
4. Under `prefers-reduced-motion: reduce` there are exactly six frames, no duplicate copy, and `scrollLeft` stays 0 for 3 s. (Probe in Task 7.)
5. When only one frame survives the zero rule (all other sections empty and their fallback files missing) autoplay must not start and the dots row shows one dot. (Test in Task 2 for the frame count; Task 7 gates autoplay on `frames.length >= 2`.)

---

### Task 0: Worktree and branch

**Files:** none

- [ ] **Step 1: Create the worktree**

```bash
cd /home/atakee/projects/fullstack-community-webApp-astro---v.3
git worktree add .claude/worktrees/schaufenster -b feat/landing-schaufenster main
cd .claude/worktrees/schaufenster
cp ../../.env .env
pnpm install --frozen-lockfile --offline 2>/dev/null || pnpm install --frozen-lockfile
```

- [ ] **Step 2: Confirm the gates' baseline**

Run: `pnpm type-check 2>&1 | grep -c 'error TS'` → Expected: `23`
Run: `npx -y svelte-check@4 2>&1 | tail -1` → Expected: a line ending in `89 errors`

---

### Task 1: `cloudinaryFit()` — width transform for listing photos

**Files:**
- Modify: `src/utils/cloudinary.ts`
- Test: `src/utils/cloudinary.test.ts` (create)

**Interfaces:**
- Produces: `cloudinaryFit(url: string | null | undefined, width: number): string` — returns `''` for empty input, the input unchanged for non-Cloudinary URLs, otherwise the URL with `f_auto,q_auto,w_<width>,c_fill` injected once after `/upload/`.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/cloudinary.test.ts
// Run: npx tsx --test src/utils/cloudinary.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudinaryFit, optimizeCloudinary } from './cloudinary';

const RAW = 'https://res.cloudinary.com/demo/image/upload/v123/mahalle/listings/abc.jpg';

test('cloudinaryFit injects auto format, auto quality and a width fill after /upload/', () => {
  assert.equal(cloudinaryFit(RAW, 480), 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_480,c_fill/v123/mahalle/listings/abc.jpg');
});

test('cloudinaryFit is a no-op for non-Cloudinary URLs and empty input', () => {
  assert.equal(cloudinaryFit('https://example.org/a.jpg', 480), 'https://example.org/a.jpg');
  assert.equal(cloudinaryFit('', 480), '');
  assert.equal(cloudinaryFit(null, 480), '');
  assert.equal(cloudinaryFit(undefined, 480), '');
});

test('cloudinaryFit does not double up on an already optimized URL', () => {
  const once = optimizeCloudinary(RAW);
  assert.equal(cloudinaryFit(once, 480), 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_480,c_fill/v123/mahalle/listings/abc.jpg');
  assert.equal(cloudinaryFit(cloudinaryFit(RAW, 480), 480), cloudinaryFit(RAW, 480));
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx tsx --test src/utils/cloudinary.test.ts`
Expected: FAIL — `cloudinaryFit` is not exported.

- [ ] **Step 3: Implement**

Append to `src/utils/cloudinary.ts`:

```ts
/**
 * Like optimizeCloudinary, plus a width-fill so a card never downloads the
 * original. Strips an existing `f_auto,q_auto` segment first so the call is
 * idempotent. Landing „Schaufenster" listing photo (2026-09-28).
 */
export function cloudinaryFit(url: string | undefined | null, width: number): string {
  if (!url) return '';
  if (!url.includes('res.cloudinary.com')) return url;
  const w = Math.max(1, Math.round(width));
  const bare = url.replace(/\/upload\/f_auto,q_auto(?:,w_\d+,c_fill)?\//, '/upload/');
  return bare.replace('/upload/', `/upload/f_auto,q_auto,w_${w},c_fill/`);
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npx tsx --test src/utils/cloudinary.test.ts`
Expected: `pass 3`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/utils/cloudinary.ts src/utils/cloudinary.test.ts
git commit -m 'landing: cloudinaryFit width transform for card photos' -- src/utils/cloudinary.ts src/utils/cloudinary.test.ts
```

---

### Task 2: `buildFrames()` — pure frame view models with the per-frame zero rule

**Files:**
- Create: `src/lib/landing/frames.ts`
- Test: `src/lib/landing/frames.test.ts` (create)

**Interfaces:**
- Produces (all exported from `src/lib/landing/frames.ts`, dependency-pure — no imports):

```ts
export type SectionKey = 'forum' | 'calendar' | 'marketplace' | 'newsboard' | 'schillerkiez' | 'blog';
export const SECTION_ORDER: readonly SectionKey[];
export interface ForumPeek { kind: 'discussion' | 'announcement' | 'recommendation'; title: string; tags: string[]; createdAt: string }
export interface EventPeek { title: string; startISO: string; allDay: boolean; category: string | null }
export interface ListingPeek { title: string; image: string | null; kind: 'sell' | 'exchange' | 'gift'; price: number | null }
export interface SchaufensterData { forum: ForumPeek | null; event: EventPeek | null; listing: ListingPeek | null }
export interface KurierPeek { title: string; sourceName: string; sourceUrl: string; imageUrl?: string }
export interface BlogPeek { slug: string; title: string; description: string; pubDateISO: string; coverSrc?: string }
export interface FrameInput {
  rows: { kind: string; value?: number }[];
  population: number | null;
  airGrade: number | null;
  airSpark: (number | null)[];
  kurier: KurierPeek[];
  schaufenster?: Partial<SchaufensterData> | null;
  blog: BlogPeek | null;
}
export type Live =
  | { key: 'forum'; kind: ForumPeek['kind']; title: string; tags: string[]; createdAt: string; weekCount: number }
  | { key: 'calendar'; title: string; startISO: string; allDay: boolean; category: string | null; weekendCount: number }
  | { key: 'marketplace'; title: string; image: string | null; kind: ListingPeek['kind']; price: number | null }
  | { key: 'newsboard'; lead: KurierPeek; more: KurierPeek[] }
  | { key: 'schillerkiez'; airGrade: number | null; airSpark: (number | null)[]; population: number | null }
  | { key: 'blog'; slug: string; title: string; description: string; pubDateISO: string; coverSrc?: string };
export interface Frame { key: SectionKey; href: string; live: Live | null; fallback: string | null }
export function buildFrames(input: FrameInput, fallbacks: Partial<Record<SectionKey, string>>): Frame[];
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/landing/frames.test.ts
// Run: npx tsx --test src/lib/landing/frames.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrames, SECTION_ORDER, type FrameInput } from './frames';

const FALLBACKS = {
  forum: '/assets/schaufenster/forum.webp',
  calendar: '/assets/schaufenster/calendar.webp',
  marketplace: '/assets/schaufenster/marketplace.webp',
  newsboard: '/assets/schaufenster/newsboard.webp',
  schillerkiez: '/assets/schaufenster/schillerkiez.webp',
  blog: '/assets/schaufenster/blog.webp',
};

const EMPTY: FrameInput = { rows: [], population: null, airGrade: null, airSpark: [], kurier: [], schaufenster: null, blog: null };

const FULL: FrameInput = {
  rows: [{ kind: 'forum', value: 18 }, { kind: 'events', value: 5 }],
  population: 28330,
  airGrade: 2,
  airSpark: [2, 2.4, null, 3, 2, 2, 2.1],
  kurier: [
    { title: 'Lead', sourceName: 'TAZ', sourceUrl: 'https://taz.de/x', imageUrl: 'https://img.example/a.jpg' },
    { title: 'Two', sourceName: 'BZ', sourceUrl: 'https://bz.de/y' },
    { title: 'Three', sourceName: 'RBB', sourceUrl: 'https://rbb.de/z' },
  ],
  schaufenster: {
    forum: { kind: 'announcement', title: 'Die Quartiersseite berichtet über uns.', tags: ['kiez', 'event'], createdAt: '2026-09-23T10:00:00.000Z' },
    event: { title: 'Tag der offenen Tür', startISO: '2026-09-28T13:00:00.000Z', allDay: false, category: 'kiez' },
    listing: { title: 'Bike Zipper', image: 'https://res.cloudinary.com/demo/image/upload/v1/x.jpg', kind: 'gift', price: null },
  },
  blog: { slug: 'kandidaten-check', title: 'So kam der Check zustande', description: 'Sieben Gastbeiträge.', pubDateISO: '2026-09-18T00:00:00.000Z', coverSrc: '/_astro/cover.webp' },
};

test('six frames in nav order, all live, with the count lines from the rows', () => {
  const frames = buildFrames(FULL, FALLBACKS);
  assert.deepEqual(frames.map((f) => f.key), [...SECTION_ORDER]);
  assert.deepEqual(frames.map((f) => f.href), ['/forum', '/calendar', '/marketplace', '/newsboard', '/schillerkiez', '/blog']);
  assert.ok(frames.every((f) => f.live !== null));
  const forum = frames[0].live!;
  assert.equal(forum.key, 'forum');
  if (forum.key === 'forum') assert.equal(forum.weekCount, 18);
  const cal = frames[1].live!;
  if (cal.key === 'calendar') assert.equal(cal.weekendCount, 5);
  const news = frames[3].live!;
  if (news.key === 'newsboard') { assert.equal(news.lead.title, 'Lead'); assert.deepEqual(news.more.map((m) => m.title), ['Two', 'Three']); }
});

test('an empty payload (or a pre-release cached payload without schaufenster) falls back on every frame', () => {
  const frames = buildFrames(EMPTY, FALLBACKS);
  assert.equal(frames.length, 6);
  assert.ok(frames.every((f) => f.live === null && f.fallback === FALLBACKS[f.key]));
  const legacy = { ...EMPTY } as FrameInput;
  delete (legacy as Partial<FrameInput>).schaufenster;
  assert.equal(buildFrames(legacy, FALLBACKS).length, 6);
});

test('a frame with neither live content nor a fallback file is omitted', () => {
  const frames = buildFrames(EMPTY, { forum: FALLBACKS.forum });
  assert.deepEqual(frames.map((f) => f.key), ['forum']);
});

test('kiez frame is live when any of grade, spark or population exists; blank titles do not count as live', () => {
  const sparkOnly = buildFrames({ ...EMPTY, airSpark: [null, 2, null] }, {});
  assert.deepEqual(sparkOnly.map((f) => f.key), ['schillerkiez']);
  const blankTitle = buildFrames({ ...EMPTY, schaufenster: { forum: { kind: 'discussion', title: '   ', tags: [], createdAt: '2026-01-01T00:00:00.000Z' } } }, {});
  assert.equal(blankTitle.length, 0);
});

test('tags are capped at three and the newsboard keeps at most two more titles', () => {
  const frames = buildFrames({ ...FULL, schaufenster: { ...FULL.schaufenster, forum: { ...FULL.schaufenster!.forum!, tags: ['a', 'b', 'c', 'd'] } }, kurier: [...FULL.kurier, { title: 'Four', sourceName: 'X', sourceUrl: 'https://x' }] }, FALLBACKS);
  const forum = frames[0].live!;
  if (forum.key === 'forum') assert.deepEqual(forum.tags, ['a', 'b', 'c']);
  const news = frames[3].live!;
  if (news.key === 'newsboard') assert.equal(news.more.length, 2);
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `npx tsx --test src/lib/landing/frames.test.ts`
Expected: FAIL — cannot find module `./frames`.

- [ ] **Step 3: Implement**

```ts
// src/lib/landing/frames.ts
/**
 * Landing „Das Schaufenster" (2026-09-28): six phone-shaped frames, one per
 * main section, each drawn live from the landing payload with a PER-FRAME
 * zero rule — live content, else the section's static screenshot, else the
 * frame is omitted. Dependency-pure: imported by the SSR island and tested
 * without Mongo. Never carries a member's name, handle or avatar.
 */
export type SectionKey = 'forum' | 'calendar' | 'marketplace' | 'newsboard' | 'schillerkiez' | 'blog';

export const SECTION_ORDER: readonly SectionKey[] = ['forum', 'calendar', 'marketplace', 'newsboard', 'schillerkiez', 'blog'];

export const SECTION_HREF: Record<SectionKey, string> = {
  forum: '/forum',
  calendar: '/calendar',
  marketplace: '/marketplace',
  newsboard: '/newsboard',
  schillerkiez: '/schillerkiez',
  blog: '/blog',
};

export interface ForumPeek { kind: 'discussion' | 'announcement' | 'recommendation'; title: string; tags: string[]; createdAt: string }
export interface EventPeek { title: string; startISO: string; allDay: boolean; category: string | null }
export interface ListingPeek { title: string; image: string | null; kind: 'sell' | 'exchange' | 'gift'; price: number | null }
export interface SchaufensterData { forum: ForumPeek | null; event: EventPeek | null; listing: ListingPeek | null }
export interface KurierPeek { title: string; sourceName: string; sourceUrl: string; imageUrl?: string }
export interface BlogPeek { slug: string; title: string; description: string; pubDateISO: string; coverSrc?: string }

export interface FrameInput {
  rows: { kind: string; value?: number }[];
  population: number | null;
  airGrade: number | null;
  airSpark: (number | null)[];
  kurier: KurierPeek[];
  /** Absent on payloads cached before this field existed — treated as empty. */
  schaufenster?: Partial<SchaufensterData> | null;
  blog: BlogPeek | null;
}

export type Live =
  | { key: 'forum'; kind: ForumPeek['kind']; title: string; tags: string[]; createdAt: string; weekCount: number }
  | { key: 'calendar'; title: string; startISO: string; allDay: boolean; category: string | null; weekendCount: number }
  | { key: 'marketplace'; title: string; image: string | null; kind: ListingPeek['kind']; price: number | null }
  | { key: 'newsboard'; lead: KurierPeek; more: KurierPeek[] }
  | { key: 'schillerkiez'; airGrade: number | null; airSpark: (number | null)[]; population: number | null }
  | { key: 'blog'; slug: string; title: string; description: string; pubDateISO: string; coverSrc?: string };

export interface Frame { key: SectionKey; href: string; live: Live | null; fallback: string | null }

const hasText = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;

function rowValue(rows: FrameInput['rows'], kind: string): number {
  const v = rows.find((r) => r.kind === kind)?.value;
  return typeof v === 'number' && v > 0 ? v : 0;
}

function liveFor(key: SectionKey, input: FrameInput): Live | null {
  const sf = input.schaufenster ?? {};
  switch (key) {
    case 'forum': {
      const f = sf.forum;
      if (!f || !hasText(f.title)) return null;
      return { key, kind: f.kind, title: f.title.trim(), tags: (f.tags ?? []).filter(hasText).slice(0, 3), createdAt: f.createdAt, weekCount: rowValue(input.rows, 'forum') };
    }
    case 'calendar': {
      const e = sf.event;
      if (!e || !hasText(e.title)) return null;
      return { key, title: e.title.trim(), startISO: e.startISO, allDay: e.allDay === true, category: e.category ?? null, weekendCount: rowValue(input.rows, 'events') };
    }
    case 'marketplace': {
      const l = sf.listing;
      if (!l || !hasText(l.title)) return null;
      return { key, title: l.title.trim(), image: hasText(l.image) ? l.image : null, kind: l.kind, price: l.kind === 'sell' && typeof l.price === 'number' ? l.price : null };
    }
    case 'newsboard': {
      const items = (input.kurier ?? []).filter((k) => hasText(k.title));
      if (items.length === 0) return null;
      return { key, lead: items[0], more: items.slice(1, 3) };
    }
    case 'schillerkiez': {
      const spark = input.airSpark ?? [];
      const alive = input.airGrade != null || spark.some((v) => v != null) || input.population != null;
      return alive ? { key, airGrade: input.airGrade, airSpark: spark, population: input.population } : null;
    }
    case 'blog': {
      const b = input.blog;
      if (!b || !hasText(b.title)) return null;
      return { key, slug: b.slug, title: b.title.trim(), description: b.description ?? '', pubDateISO: b.pubDateISO, coverSrc: b.coverSrc };
    }
  }
}

export function buildFrames(input: FrameInput, fallbacks: Partial<Record<SectionKey, string>>): Frame[] {
  const out: Frame[] = [];
  for (const key of SECTION_ORDER) {
    const live = liveFor(key, input);
    const fallback = hasText(fallbacks[key]) ? (fallbacks[key] as string) : null;
    if (!live && !fallback) continue;
    out.push({ key, href: SECTION_HREF[key], live, fallback });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx tsx --test src/lib/landing/frames.test.ts`
Expected: `pass 5`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/landing/frames.ts src/lib/landing/frames.test.ts
git commit -m 'landing: buildFrames view models with a per-frame zero rule' -- src/lib/landing/frames.ts src/lib/landing/frames.test.ts
```

---

### Task 3: `loop.ts` — autoplay wrap and active-dot maths

**Files:**
- Create: `src/lib/landing/loop.ts`
- Test: `src/lib/landing/loop.test.ts` (create)

**Interfaces:**
- Produces: `advance(scrollLeft: number, halfWidth: number, dx: number): number` — next scroll position, wrapped back by `halfWidth` once it reaches it (`halfWidth <= 0` → plain addition). `activeIndex(scrollLeft: number, step: number, count: number): number` — which of `count` frames is nearest the left edge (`step` = frame width + gap), wrapping over the duplicate copy; `0` when `count` or `step` is not positive.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/landing/loop.test.ts
// Run: npx tsx --test src/lib/landing/loop.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, activeIndex } from './loop';

test('advance adds dx and wraps by the half width once it reaches it', () => {
  assert.equal(advance(0, 1500, 0.64), 0.64);
  assert.ok(Math.abs(advance(1499.5, 1500, 0.64) - 0.14) < 1e-9);
  assert.equal(advance(1500, 1500, 0), 0);
});

test('advance without a half width is plain addition', () => {
  assert.equal(advance(10, 0, 5), 15);
});

test('activeIndex rounds to the nearest frame and wraps over the duplicate copy', () => {
  assert.equal(activeIndex(0, 250, 6), 0);
  assert.equal(activeIndex(130, 250, 6), 1);
  assert.equal(activeIndex(1250, 250, 6), 5);
  assert.equal(activeIndex(1500, 250, 6), 0);
  assert.equal(activeIndex(1760, 250, 6), 1);
});

test('activeIndex is 0 for a degenerate step or count', () => {
  assert.equal(activeIndex(400, 0, 6), 0);
  assert.equal(activeIndex(400, 250, 0), 0);
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `npx tsx --test src/lib/landing/loop.test.ts`
Expected: FAIL — cannot find module `./loop`.

- [ ] **Step 3: Implement**

```ts
// src/lib/landing/loop.ts
/** Autoplay maths for the landing Schaufenster strip (2026-09-28). Pure. */

/** Next scrollLeft: once the first copy has fully passed, jump back by exactly one copy — invisible because both copies are identical. */
export function advance(scrollLeft: number, halfWidth: number, dx: number): number {
  const next = scrollLeft + dx;
  return halfWidth > 0 && next >= halfWidth ? next - halfWidth : next;
}

/** Index (0..count-1) of the frame nearest the left edge; `step` = frame width + gap. */
export function activeIndex(scrollLeft: number, step: number, count: number): number {
  if (!(step > 0) || !(count > 0)) return 0;
  return ((Math.round(scrollLeft / step) % count) + count) % count;
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx tsx --test src/lib/landing/loop.test.ts`
Expected: `pass 4`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/landing/loop.ts src/lib/landing/loop.test.ts
git commit -m 'landing: autoplay wrap and active-dot maths for the Schaufenster' -- src/lib/landing/loop.ts src/lib/landing/loop.test.ts
```

---

### Task 4: Server data — `schaufenster` field, Kurier photo, blog cover

**Files:**
- Modify: `src/lib/landing.ts` (interface `LandingData`, `compute()`, the empty payload in `getLandingData()`'s catch)
- Modify: `src/pages/index.astro` (blog teaser → one post with `coverSrc`)
- Create (gitignored, not committed): `scratchpad/landing-data-probe.mts`

**Interfaces:**
- Consumes: types from `src/lib/landing/frames.ts` (Task 2): `SchaufensterData`, `ForumPeek`, `EventPeek`, `ListingPeek`, `KurierPeek`, `BlogPeek`.
- Produces: `LandingData.schaufenster: SchaufensterData | null` and `LandingData.kurier: KurierPeek[]` (with `imageUrl?`); `index.astro` passes `blog: BlogPeek[]` of length 0 or 1.

- [ ] **Step 1: Extend the interface**

In `src/lib/landing.ts`, add after the Sentry import:

```ts
import type { SchaufensterData, ForumPeek, EventPeek, ListingPeek, KurierPeek } from './landing/frames';
export type { SchaufensterData, ForumPeek, EventPeek, ListingPeek, KurierPeek } from './landing/frames';
```

Replace `kurier: { title: string; sourceName: string; sourceUrl: string }[];` in `LandingData` with:

```ts
  kurier: KurierPeek[];
  /** Landing Schaufenster peeks (2026-09-28). Absent on payloads cached before the field existed — readers treat that as empty. */
  schaufenster?: SchaufensterData | null;
```

- [ ] **Step 2: Kurier photo**

In `compute()`, the second `news` query: change the projection to `{ title: 1, sourceName: 1, sourceUrl: 1, aiRelevanceScore: 1, imageUrl: 1 }` and the mapping to:

```ts
      kurier = docs.map((d) => ({
        title: String(d.title ?? ''),
        sourceName: String(d.sourceName ?? ''),
        sourceUrl: String(d.sourceUrl ?? ''),
        ...(typeof d.imageUrl === 'string' && d.imageUrl.startsWith('http') ? { imageUrl: d.imageUrl } : {}),
      }));
```

- [ ] **Step 3: The three peeks**

In `compute()`, directly BEFORE the `// ── zero rule, SERVER-SIDE` block, add:

```ts
  // ── Schaufenster peeks (2026-09-28): newest public forum post, next public
  //    event, newest fresh listing. Titles only — never an author. Each
  //    source is fail-soft like the rows above. ──
  let sfForum: ForumPeek | null = null;
  try {
    const pick = async (col: string, kind: ForumPeek['kind']): Promise<ForumPeek | null> => {
      const d = await db
        .collection(col)
        .find(PUBLIC_MOD, { projection: { title: 1, tags: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
      const doc = d[0];
      if (!doc || typeof doc.title !== 'string' || !doc.title.trim()) return null;
      return {
        kind,
        title: doc.title,
        tags: Array.isArray(doc.tags) ? doc.tags.filter((t: unknown) => typeof t === 'string').slice(0, 3) : [],
        createdAt: new Date(doc.createdAt ?? now).toISOString(),
      };
    };
    const cands = (
      await Promise.all([pick('topics', 'discussion'), pick('announcements', 'announcement'), pick('recommendations', 'recommendation')])
    ).filter((c): c is ForumPeek => c !== null);
    cands.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    sfForum = cands[0] ?? null;
  } catch (err) {
    failures.push(['schaufenster.forum', err]);
  }

  let sfEvent: EventPeek | null = null;
  try {
    const d = await db
      .collection('events')
      .find(
        { ...PUBLIC_MOD, visibility: { $ne: 'private' }, startDate: { $gte: now } },
        { projection: { title: 1, startDate: 1, allDay: 1, category: 1 } },
      )
      .sort({ startDate: 1 })
      .limit(1)
      .toArray();
    const doc = d[0];
    if (doc && typeof doc.title === 'string' && doc.title.trim()) {
      sfEvent = {
        title: doc.title,
        startISO: new Date(doc.startDate).toISOString(),
        allDay: doc.allDay === true,
        category: typeof doc.category === 'string' ? doc.category : null,
      };
    }
  } catch (err) {
    failures.push(['schaufenster.event', err]);
  }

  let sfListing: ListingPeek | null = null;
  try {
    const freshSince = new Date(now.getTime() - 21 * 86_400_000); // same 21-day clock as the browse page
    const d = await db
      .collection('listings')
      .find(
        {
          ...PUBLIC_MOD,
          status: 'available',
          $expr: { $gte: [{ $ifNull: ['$lastBumpedAt', '$createdAt'] }, freshSince] },
        },
        { projection: { title: 1, images: 1, listingType: 1, listingKind: 1, price: 1 } },
      )
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();
    const doc = d[0];
    if (doc && typeof doc.title === 'string' && doc.title.trim()) {
      // The create route writes `listingType`; older/seeded docs carry `listingKind`.
      const raw = doc.listingType ?? doc.listingKind;
      const kind: ListingPeek['kind'] = raw === 'exchange' || raw === 'gift' ? raw : 'sell';
      const first = Array.isArray(doc.images) ? doc.images[0] : null;
      sfListing = {
        title: doc.title,
        image: typeof first === 'string' && first.startsWith('http') ? first : null,
        kind,
        price: kind === 'sell' && typeof doc.price === 'number' ? doc.price : null,
      };
    }
  } catch (err) {
    failures.push(['schaufenster.listing', err]);
  }
  const schaufenster: SchaufensterData = { forum: sfForum, event: sfEvent, listing: sfListing };
```

Change the final `return` of `compute()` to:

```ts
  return { rows, population, airGrade, airSpark, kurier, schaufenster, computedAt: now.toISOString() };
```

and the empty payload in `getLandingData()`'s catch to:

```ts
    return { rows: [], population: null, airGrade: null, airSpark: [], kurier: [], schaufenster: null, computedAt: now.toISOString() };
```

- [ ] **Step 4: Blog cover in `index.astro`**

Replace the blog block (from `let blog:` through the `catch`) with:

```ts
import { getImage } from 'astro:assets';
import type { BlogPeek } from '../lib/landing/frames';

// Blog frame: newest non-draft post with a 480 px WebP of its cover (never the
// raw asset — that is the full-size file). Fail-soft: no post → no live frame.
let blog: BlogPeek[] = [];
try {
  const entries = (await getCollection('blog', ({ data: d }) => !d.draft))
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
    .slice(0, 1);
  const e = entries[0];
  if (e) {
    let coverSrc: string | undefined;
    if (e.data.cover) {
      try {
        coverSrc = (await getImage({ src: e.data.cover, width: 480, format: 'webp' })).src;
      } catch (err) {
        console.error('[landing] blog cover failed:', err);
      }
    }
    blog = [{ slug: e.id, title: e.data.title, description: e.data.description ?? '', pubDateISO: e.data.pubDate.toISOString(), coverSrc }];
  }
} catch (err) {
  console.error('[landing] blog teaser failed:', err);
}
```

(Move the two `import` lines up into the frontmatter's import block; Astro frontmatter imports must sit at the top.)

- [ ] **Step 5: Gates**

Run: `pnpm type-check 2>&1 | grep -c 'error TS'` → Expected: `23` (no new errors; `LandingPage.svelte` still compiles because `blog[1]` access is on an array).

- [ ] **Step 6: Probe through the running dev server (the lib reads `import.meta.env`, which only exists under Vite — never import `landing.ts` from a plain `tsx` script)**

Start the dev server in the worktree (`fuser -k 4655/tcp 2>/dev/null; (pnpm dev --port 4655 > /tmp/dev4655.log 2>&1 &)`; wait until the log shows `Local`). Clear the dev cache so the next request recomputes (dev DB only):

```ts
// scratchpad/landing-cache-clear.mts — run: npx tsx scratchpad/landing-cache-clear.mts
import 'dotenv/config';
import { MongoClient } from 'mongodb';
const c = new MongoClient(process.env.MONGODB_URI!); await c.connect(); const db = c.db();
if (!db.databaseName.includes('dev')) { console.log('not a dev db, aborting'); process.exit(1); }
console.log('deleted:', (await db.collection('landingCache').deleteOne({ _id: 'landing' as any })).deletedCount);
await c.close();
```

Then read the recomputed payload back from the cache doc (field NAMES only):

```ts
// scratchpad/landing-data-probe.mts — run: curl -s -o /dev/null http://localhost:4655/ && npx tsx scratchpad/landing-data-probe.mts
import 'dotenv/config';
import { MongoClient } from 'mongodb';
const c = new MongoClient(process.env.MONGODB_URI!); await c.connect(); const db = c.db();
if (!db.databaseName.includes('dev')) { console.log('not a dev db, aborting'); process.exit(1); }
const doc = await db.collection('landingCache').findOne({ _id: 'landing' as any });
const d = doc?.payload ?? {};
console.log('keys:', Object.keys(d).join(','));
console.log('schaufenster:', d.schaufenster ? Object.fromEntries(Object.entries(d.schaufenster).map(([k, v]) => [k, v ? Object.keys(v as object).join(',') : null])) : null);
console.log('kurier with imageUrl:', (d.kurier ?? []).filter((k: { imageUrl?: string }) => k.imageUrl).length, 'of', (d.kurier ?? []).length);
await c.close();
```

Expected: `keys:` includes `schaufenster`; `forum` and `listing` are non-null with the keys `kind,title,tags,createdAt` / `title,image,kind,price`; `event` is `null` until a dev event exists (see Task 8); `kurier with imageUrl: 3 of 3`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/landing.ts src/pages/index.astro
git commit -m 'landing: schaufenster peeks (forum, event, listing), Kurier photo, blog cover at 480px' -- src/lib/landing.ts src/pages/index.astro
```

---

### Task 5: Static fallback images and the reshoot script

**Files:**
- Create: `scripts/schaufenster-fallbacks.mjs`
- Create: `public/assets/schaufenster/{forum,calendar,marketplace,newsboard,schillerkiez,blog}.webp`

**Interfaces:**
- Produces: six WebP files, 480 × 800, served at `/assets/schaufenster/<key>.webp` (the `fallbacks` map in Task 6).

- [ ] **Step 1: Write the script**

```js
// scripts/schaufenster-fallbacks.mjs
// Turns six phone screenshots (390×844 at 2×, i.e. 780×1688 PNG, taken logged
// in with the verify-e-mail banner hidden) into the landing Schaufenster
// fallback images: top 780×1300 crop → 480×800 WebP. Usage:
//   node scripts/schaufenster-fallbacks.mjs <dir with forum.png calendar.png marketplace.png newsboard.png schillerkiez.png blog.png>
// Re-run after any chrome redesign; the shots themselves are not in the repo.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/schaufenster-fallbacks.mjs <srcDir>'); process.exit(1); }
const out = path.resolve('public/assets/schaufenster');
await mkdir(out, { recursive: true });
for (const key of ['forum', 'calendar', 'marketplace', 'newsboard', 'schillerkiez', 'blog']) {
  const file = path.join(src, `${key}.png`);
  const meta = await sharp(file).metadata();
  const w = meta.width ?? 780;
  const h = Math.min(meta.height ?? 1300, Math.round((w * 5) / 3));
  const info = await sharp(file)
    .extract({ left: 0, top: 0, width: w, height: h })
    .resize(480, 800, { fit: 'cover', position: 'top' })
    .webp({ quality: 78 })
    .toFile(path.join(out, `${key}.webp`));
  console.log(key, info.size, 'bytes');
}
```

- [ ] **Step 2: Run it against this session's shots**

Run: `node scripts/schaufenster-fallbacks.mjs /home/atakee/projects/fullstack-community-webApp-astro---v.3/scratchpad/hero-src`
Expected: six lines, each under 60000 bytes; `ls public/assets/schaufenster` lists six `.webp` files.

- [ ] **Step 3: Commit**

```bash
git add scripts/schaufenster-fallbacks.mjs public/assets/schaufenster/forum.webp public/assets/schaufenster/calendar.webp public/assets/schaufenster/marketplace.webp public/assets/schaufenster/newsboard.webp public/assets/schaufenster/schillerkiez.webp public/assets/schaufenster/blog.webp
git commit -m 'landing: six Schaufenster fallback screenshots + reshoot script' -- scripts/schaufenster-fallbacks.mjs public/assets/schaufenster
```

---

### Task 6: The strip — markup, styles, copy (no motion yet)

**Files:**
- Modify: `src/components/landing/LandingPage.svelte` (script, markup, `<style>`)
- Modify: `src/lib/kiosk-i18n.ts` (`de` block after `'lnd.cta.slogan'` ~line 182; `en` block after `'lnd.cta.slogan'` ~line 2227)

**Interfaces:**
- Consumes: `buildFrames`, `SECTION_ORDER`, types from `src/lib/landing/frames.ts` (Task 2); `cloudinaryFit`, `optimizeCloudinary` from `src/utils/cloudinary.ts` (Task 1); `relTime` from `src/lib/relTime.ts` (exists); `LandingData` with `schaufenster` (Task 4).
- Produces: DOM the motion task drives — `<div class="lnd-sf-track" bind:this={trackEl}>` containing `.lnd-sf-item` children (each = one frame + its caption), rendered from `renderFrames` (see below); `.lnd-sf-dots` with one `.lnd-sf-dot` per frame; header line `.lnd-sf-head`.

- [ ] **Step 1: i18n keys (DRAFT)**

In the `de` dictionary, after the `'lnd.cta.slogan'` line:

```ts
  // DRAFT copy (2026-09-28) — the owner words UI copy himself · landing Schaufenster
  'lnd.sf.kicker': 'DAS SCHAUFENSTER · SECHS RÄUME',
  'lnd.sf.hint.phone': 'WISCHEN →',
  'lnd.sf.hint.desktop': 'ZIEHEN ZUM BLÄTTERN',
  'lnd.sf.pause': 'Anhalten',
  'lnd.sf.play': 'Weiter',
  'lnd.sf.region': 'Das Schaufenster: sechs Bereiche von Mahalle',
  'lnd.sf.bar.forum': 'FORUM',
  'lnd.sf.bar.calendar': 'KALENDER',
  'lnd.sf.bar.marketplace': 'MARKT',
  'lnd.sf.bar.newsboard': 'KURIER',
  'lnd.sf.bar.schillerkiez': 'KIEZ-DATEN',
  'lnd.sf.bar.blog': 'BEILAGE',
  'lnd.sf.title.forum': 'Was <em>reden</em> wir heute?',
  'lnd.sf.title.calendar': 'Was <em>passiert</em> im Kiez?',
  'lnd.sf.title.marketplace': 'Was <em>wechselt</em> den Besitzer?',
  'lnd.sf.title.newsboard': 'Was <em>passiert</em> heute im Kiez?',
  'lnd.sf.title.schillerkiez': 'Der Kiez, <em>gemessen</em>',
  'lnd.sf.title.blog': 'Die <em>Beilage</em>',
  'lnd.sf.cap.forum': 'Reden, fragen, empfehlen.',
  'lnd.sf.cap.calendar': 'Termine aus der Nachbarschaft.',
  'lnd.sf.cap.marketplace': 'Verkaufen, tauschen, verschenken.',
  'lnd.sf.cap.newsboard': 'Die Tagesausgabe, kuratiert.',
  'lnd.sf.cap.schillerkiez': 'Luft, Zahlen, Trends.',
  'lnd.sf.cap.blog': 'Lesen, was der Kiez schreibt.',
  'lnd.sf.today': 'HEUTE',
  'lnd.sf.forum.week': '{n} Beiträge diese Woche',
  'lnd.sf.event.weekend': '{n} Termine am Wochenende',
  'lnd.sf.allDay': 'ganztägig',
  'lnd.sf.kind.sell': 'VERKAUFEN',
  'lnd.sf.kind.exchange': 'TAUSCH',
  'lnd.sf.kind.gift': 'VERSCHENKEN',
  'lnd.sf.air': 'LUFT HEUTE',
  'lnd.sf.airMute': 'MESSUNG PAUSIERT',
  'lnd.sf.pop': 'NACHBAR:INNEN',
  'lnd.sf.more': 'AUSSERDEM',
```

In the `en` dictionary, after its `'lnd.cta.slogan'` line:

```ts
  // DRAFT copy (2026-09-28) — the owner words UI copy himself · landing Schaufenster
  'lnd.sf.kicker': 'THE SHOP WINDOW · SIX ROOMS',
  'lnd.sf.hint.phone': 'SWIPE →',
  'lnd.sf.hint.desktop': 'DRAG TO BROWSE',
  'lnd.sf.pause': 'Pause',
  'lnd.sf.play': 'Play',
  'lnd.sf.region': 'The shop window: six areas of Mahalle',
  'lnd.sf.bar.forum': 'FORUM',
  'lnd.sf.bar.calendar': 'CALENDAR',
  'lnd.sf.bar.marketplace': 'MARKET',
  'lnd.sf.bar.newsboard': 'COURIER',
  'lnd.sf.bar.schillerkiez': 'KIEZ DATA',
  'lnd.sf.bar.blog': 'SUPPLEMENT',
  'lnd.sf.title.forum': 'What are we <em>talking</em> about?',
  'lnd.sf.title.calendar': 'What is <em>happening</em> in the Kiez?',
  'lnd.sf.title.marketplace': 'What <em>changes</em> hands today?',
  'lnd.sf.title.newsboard': 'What is <em>happening</em> today?',
  'lnd.sf.title.schillerkiez': 'The Kiez, <em>measured</em>',
  'lnd.sf.title.blog': 'The <em>Supplement</em>',
  'lnd.sf.cap.forum': 'Talk, ask, recommend.',
  'lnd.sf.cap.calendar': 'Dates from the neighbourhood.',
  'lnd.sf.cap.marketplace': 'Sell, swap, give away.',
  'lnd.sf.cap.newsboard': 'The daily issue, curated.',
  'lnd.sf.cap.schillerkiez': 'Air, numbers, trends.',
  'lnd.sf.cap.blog': 'Read what the Kiez writes.',
  'lnd.sf.today': 'TODAY',
  'lnd.sf.forum.week': '{n} posts this week',
  'lnd.sf.event.weekend': '{n} events this weekend',
  'lnd.sf.allDay': 'all day',
  'lnd.sf.kind.sell': 'FOR SALE',
  'lnd.sf.kind.exchange': 'SWAP',
  'lnd.sf.kind.gift': 'FREE',
  'lnd.sf.air': 'AIR TODAY',
  'lnd.sf.airMute': 'MEASUREMENT PAUSED',
  'lnd.sf.pop': 'NEIGHBOURS',
  'lnd.sf.more': 'ALSO',
```

- [ ] **Step 2: Script additions in `LandingPage.svelte`**

Add imports after the existing two:

```ts
  import { buildFrames, type Frame, type SectionKey, type BlogPeek } from '../../lib/landing/frames';
  import { cloudinaryFit, optimizeCloudinary } from '../../utils/cloudinary';
  import { relTime } from '../../lib/relTime';
```

Change the props type to `blog: BlogPeek[]`. Then add (after `popFmt`):

```ts
  // ── Das Schaufenster (2026-09-28): six live frames, per-frame zero rule ──
  const FALLBACKS: Record<SectionKey, string> = {
    forum: '/assets/schaufenster/forum.webp',
    calendar: '/assets/schaufenster/calendar.webp',
    marketplace: '/assets/schaufenster/marketplace.webp',
    newsboard: '/assets/schaufenster/newsboard.webp',
    schillerkiez: '/assets/schaufenster/schillerkiez.webp',
    blog: '/assets/schaufenster/blog.webp',
  };
  const PAPER_LINES = 'repeating-linear-gradient(90deg, rgb(243 234 216 / 0.12) 0 1px, transparent 1px 3px)';
  const SECTION: Record<SectionKey, { tint: string; lines: string }> = {
    forum: { tint: 'var(--k-wine-deep)', lines: 'var(--k-bar-lines)' },
    calendar: { tint: '#3f7e8a', lines: 'var(--k-bar-lines)' },
    marketplace: { tint: '#d68a1a', lines: 'var(--k-bar-lines)' },
    newsboard: { tint: 'var(--k-ink)', lines: PAPER_LINES },
    schillerkiez: { tint: 'var(--k-moss)', lines: 'var(--k-bar-lines)' },
    blog: { tint: 'var(--k-rust)', lines: 'var(--k-bar-lines)' },
  };
  const frames: Frame[] = buildFrames({ ...data, blog: blog[0] ?? null }, FALLBACKS);
  // Motion (next task) renders the list twice for the loop; until then once.
  const renderFrames = $derived(frames);

  function berlinDayDisc(iso: string): { wd: string; day: string; time: string } {
    const d = new Date(iso);
    const loc = $locale === 'de' ? 'de-DE' : 'en-GB';
    const wd = new Intl.DateTimeFormat(loc, { weekday: 'short', timeZone: 'Europe/Berlin' }).format(d).replace('.', '').toUpperCase();
    const day = new Intl.DateTimeFormat(loc, { day: 'numeric', timeZone: 'Europe/Berlin' }).format(d);
    const time = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(d);
    return { wd, day, time };
  }
  function priceFmt(n: number): string {
    return new Intl.NumberFormat($locale === 'de' ? 'de-DE' : 'en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  }
  function catLabel(cat: string | null): string {
    return (cat && $t[`cal.cat.${cat}.label`]) || '';
  }
  function hideOnError(e: Event) {
    (e.currentTarget as HTMLImageElement).style.display = 'none';
  }
  function frameLabel(f: Frame): string {
    const bar = $t[`lnd.sf.bar.${f.key}`];
    const cap = $t[`lnd.sf.cap.${f.key}`];
    const title = f.live && 'title' in f.live ? f.live.title : f.live?.key === 'newsboard' ? f.live.lead.title : '';
    return title ? `${bar}: ${cap} — ${title}` : `${bar}: ${cap}`;
  }
```

- [ ] **Step 3: Markup**

Replace the whole `<!-- teaser zone — ALWAYS opaque paper (§02) -->` … `</main>` block (lines ~118–169) with NOTHING, and insert the strip between the double rule (`<div class="lnd-rule">…</div>`) and the `<!-- BANNER SLOT` comment:

```svelte
  <!-- Das Schaufenster (2026-09-28): six phone frames, live content, per-frame fallback -->
  {#if frames.length > 0}
    <section class="lnd-sf" aria-label={$t['lnd.sf.region']}>
      <div class="lnd-sf-head font-dmmono">
        <span>{$t['lnd.sf.kicker']}</span>
        <span class="lnd-sf-head-right">
          <span class="lnd-sf-hint-phone">{$t['lnd.sf.hint.phone']}</span>
          <span class="lnd-sf-hint-desktop">{$t['lnd.sf.hint.desktop']}</span>
        </span>
      </div>
      <div class="lnd-sf-track no-scrollbar" role="region" aria-label={$t['lnd.sf.region']} tabindex="0">
        {#each renderFrames as f, i (`${f.key}-${i}`)}
          {@const dup = i >= frames.length}
          {@const S = SECTION[f.key]}
          <div class="lnd-sf-item" aria-hidden={dup ? 'true' : undefined}>
            <a class="lnd-sf-frame" href={f.href} tabindex={dup ? -1 : undefined} aria-label={frameLabel(f)} style="--sf-tint:{S.tint}">
              {#if f.live}
                <div class="lnd-sf-bar" style="background: {S.lines}, var(--k-bar-wash), var(--k-bar-shade), linear-gradient(var(--sf-tint), var(--sf-tint))">
                  <span class="lnd-sf-disc font-bricolage">m</span>
                  <span class="lnd-sf-barname font-dmmono">{$t[`lnd.sf.bar.${f.key}`]}</span>
                </div>
                <div class="lnd-sf-body">
                  <div class="lnd-sf-kicker font-dmmono">{$t[`lnd.sf.bar.${f.key}`]} · {$t['lnd.sf.today']}</div>
                  <div class="lnd-sf-title font-bricolage">{@html $t[`lnd.sf.title.${f.key}`]}</div>
                  {#if f.live.key === 'forum'}
                    <div class="lnd-sf-card">
                      <div class="lnd-sf-row font-dmmono"><span class="lnd-sf-chip" style="background:var(--sf-tint)">{$t[`chip.${f.live.kind}`]}</span><span class="lnd-sf-mute">{relTime(f.live.createdAt, $locale)}</span></div>
                      <div class="lnd-sf-h2 lnd-clamp2">{f.live.title}</div>
                      {#if f.live.tags.length}<div class="lnd-sf-tags font-dmmono">{f.live.tags.map((t) => `#${t}`).join(' ')}</div>{/if}
                    </div>
                    {#if f.live.weekCount > 0}<div class="lnd-sf-count font-dmmono">{tStr($t['lnd.sf.forum.week'], { n: f.live.weekCount })}</div>{/if}
                  {:else if f.live.key === 'calendar'}
                    {@const d = berlinDayDisc(f.live.startISO)}
                    <div class="lnd-sf-card lnd-sf-card-row">
                      <div class="lnd-sf-daydisc" style="background:var(--sf-tint)"><span class="font-dmmono">{d.wd}</span><span class="font-bricolage lnd-sf-daynum">{d.day}</span></div>
                      <div class="lnd-sf-col">
                        <div class="lnd-sf-mute font-dmmono">{f.live.allDay ? $t['lnd.sf.allDay'] : d.time}{#if catLabel(f.live.category)} · {catLabel(f.live.category)}{/if}</div>
                        <div class="lnd-sf-h2 lnd-clamp2">{f.live.title}</div>
                      </div>
                    </div>
                    {#if f.live.weekendCount > 0}<div class="lnd-sf-count font-dmmono">{tStr($t['lnd.sf.event.weekend'], { n: f.live.weekendCount })}</div>{/if}
                  {:else if f.live.key === 'marketplace'}
                    <div class="lnd-sf-card lnd-sf-card-photo">
                      {#if f.live.image}<img class="lnd-sf-photo" src={cloudinaryFit(optimizeCloudinary(f.live.image), 480)} alt="" width="480" height="240" loading="lazy" decoding="async" onerror={hideOnError}>{/if}
                      <div class="lnd-sf-row font-dmmono"><span class="lnd-sf-chip" style="background:var(--sf-tint)">{$t[`lnd.sf.kind.${f.live.kind}`]}</span>{#if f.live.price != null}<span>{priceFmt(f.live.price)}</span>{/if}</div>
                      <div class="lnd-sf-h2 lnd-clamp2">{f.live.title}</div>
                    </div>
                  {:else if f.live.key === 'newsboard'}
                    <div class="lnd-sf-card lnd-sf-card-photo">
                      {#if f.live.lead.imageUrl}<img class="lnd-sf-photo" src={f.live.lead.imageUrl} alt="" width="480" height="240" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={hideOnError}>{/if}
                      <div class="lnd-sf-h2 lnd-clamp3">{f.live.lead.title}</div>
                      <div class="lnd-sf-mute font-dmmono">{f.live.lead.sourceName.toUpperCase()} ↗</div>
                    </div>
                    {#if f.live.more.length}
                      <div class="lnd-sf-more">
                        <div class="lnd-sf-mute font-dmmono">{$t['lnd.sf.more']}</div>
                        {#each f.live.more as m}<div class="lnd-sf-h3 lnd-clamp2">{m.title}</div>{/each}
                      </div>
                    {/if}
                  {:else if f.live.key === 'schillerkiez'}
                    <div class="lnd-sf-card lnd-sf-card-ink">
                      <div class="lnd-sf-mute font-dmmono">{f.live.airGrade != null ? $t['lnd.sf.air'] : $t['lnd.sf.airMute']}</div>
                      {#if f.live.airGrade != null}<div class="lnd-sf-big font-dmmono">{f.live.airGrade} · {$t[`lnd.daten.grade.${f.live.airGrade}`] ?? ''}</div>{/if}
                      {#if f.live.airSpark.some((v) => v != null)}
                        <div class="lnd-sf-bars" aria-hidden="true">
                          {#each f.live.airSpark as v}<span class="lnd-sf-barv" style="height:{v == null ? 4 : Math.round(6 + (5 - Math.min(5, Math.max(1, v))) * 6)}px; opacity:{v == null ? 0.3 : 1}"></span>{/each}
                        </div>
                      {/if}
                      {#if f.live.population != null}<div class="lnd-sf-pop font-bricolage">{new Intl.NumberFormat($locale === 'de' ? 'de-DE' : 'en-GB').format(f.live.population)}</div><div class="lnd-sf-mute font-dmmono">{$t['lnd.sf.pop']}</div>{/if}
                    </div>
                  {:else if f.live.key === 'blog'}
                    <div class="lnd-sf-card lnd-sf-card-photo">
                      {#if f.live.coverSrc}<img class="lnd-sf-photo" src={f.live.coverSrc} alt="" width="480" height="240" loading="lazy" decoding="async" onerror={hideOnError}>{/if}
                      <div class="lnd-sf-h2 lnd-clamp3">{f.live.title}</div>
                      <div class="lnd-sf-desc lnd-clamp2 font-instrument">{f.live.description}</div>
                      <div class="lnd-sf-mute font-dmmono">{fmtBlogDate(f.live.pubDateISO)}</div>
                    </div>
                  {/if}
                </div>
              {:else}
                <img class="lnd-sf-shot" src={f.fallback} alt="" width="480" height="800" loading="lazy" decoding="async">
              {/if}
            </a>
            <div class="lnd-sf-cap">
              <span class="lnd-sf-cap-label font-dmmono" style="color:{S.tint}">{$t[`lnd.sf.bar.${f.key}`]}</span>
              <span class="lnd-sf-cap-line font-instrument">{$t[`lnd.sf.cap.${f.key}`]}</span>
            </div>
          </div>
        {/each}
      </div>
      <div class="lnd-sf-dots" aria-hidden="true">
        {#each frames as f, i (f.key)}<span class="lnd-sf-dot" class:lnd-sf-dot--on={i === 0} style="background:{SECTION[f.key].tint}"></span>{/each}
      </div>
    </section>
  {/if}
```

Also delete the now-unused `lnd.kurier.note`-style markup that lived in the teaser zone (it is gone with the block). Keep the heartbeat strip, CTA and footer untouched. Remove the now-unused `.lnd-main`, `.lnd-teaser-*`, `.lnd-kicker`, `.lnd-blog*`, `.lnd-linkrow`, `.lnd-link`, `.lnd-bignum`, `.lnd-airline`, `.lnd-sparkrow`, `.lnd-head*`, `.lnd-kurier-note` rules and their mobile overrides from `<style>` (keep `.lnd-meta` and `.lnd-plain`: the CTA sub line uses `.lnd-meta`).

- [ ] **Step 4: Styles (append inside `<style>`, before the reduced-motion block; the mobile block is inside the existing `@media (max-width: 1023px)`)**

```css
  /* ── Das Schaufenster (2026-09-28) ── */
  .lnd-sf { padding: 12px 0 0; }
  .lnd-sf-head { display: flex; justify-content: space-between; align-items: baseline; padding: 0 48px 10px; font-size: 10.5px; letter-spacing: 0.14em; color: var(--k-ink-mute); }
  .lnd-sf-head-right { display: inline-flex; align-items: center; gap: 12px; }
  .lnd-sf-hint-phone { display: none; }
  .lnd-sf-track { display: flex; gap: 24px; padding: 4px 48px 6px; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x proximity; scroll-padding-left: 48px; scroll-behavior: auto; outline: none; -webkit-overflow-scrolling: touch; }
  .lnd-sf-track:focus-visible { outline: 2px dashed var(--k-ink); outline-offset: 2px; }
  .lnd-sf-item { flex: 0 0 200px; scroll-snap-align: start; display: flex; flex-direction: column; gap: 8px; }
  .lnd-sf-frame { display: flex; flex-direction: column; width: 200px; aspect-ratio: 3 / 5; box-sizing: border-box; border: 3px solid var(--sf-tint); border-radius: 16px; overflow: hidden; background: var(--k-paper); box-shadow: 3px 3px 0 var(--k-ink); text-decoration: none; color: var(--k-ink); }
  .lnd-sf-bar { flex: 0 0 44px; display: flex; align-items: center; gap: 8px; padding: 0 10px; color: var(--k-paper); }
  .lnd-sf-disc { width: 26px; height: 26px; border-radius: 50%; background: var(--k-wine); color: var(--k-paper); display: inline-flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 800; box-shadow: 0 0 0 2px var(--k-paper); }
  .lnd-sf-barname { font-size: 10px; letter-spacing: 0.16em; font-weight: 500; }
  .lnd-sf-body { flex: 1; min-height: 0; padding: 10px 10px 8px; display: flex; flex-direction: column; gap: 6px; }
  .lnd-sf-kicker { font-size: 8.5px; letter-spacing: 0.16em; color: var(--sf-tint); }
  .lnd-sf-title { font-size: 17px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.05; }
  .lnd-sf-title :global(em) { font-family: var(--k-font-serif); font-style: italic; font-weight: 400; color: var(--sf-tint); }
  .lnd-sf-card { margin-top: 4px; background: var(--k-paper-warm); border: 1.5px solid var(--k-ink); border-radius: 8px; padding: 8px 9px; display: flex; flex-direction: column; gap: 5px; box-shadow: 2px 2px 0 var(--k-ink); overflow: hidden; }
  .lnd-sf-card-row { flex-direction: row; align-items: center; gap: 9px; }
  .lnd-sf-card-photo { padding: 0; }
  .lnd-sf-card-photo > :not(img) { margin: 0 9px; }
  .lnd-sf-card-photo > :last-child { margin-bottom: 8px; }
  .lnd-sf-card-photo > .lnd-sf-row { margin-top: 7px; }
  .lnd-sf-card-photo > .lnd-sf-h2:first-child { margin-top: 8px; }
  .lnd-sf-card-ink { background: var(--k-ink); color: var(--k-paper); border-color: var(--k-ink); box-shadow: 2px 2px 0 var(--sf-tint); }
  .lnd-sf-card-ink .lnd-sf-mute { color: #9db97c; }
  .lnd-sf-photo { display: block; width: 100%; height: 96px; object-fit: cover; }
  .lnd-sf-row { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 9px; letter-spacing: 0.1em; }
  .lnd-sf-chip { color: var(--k-paper); padding: 2px 6px 3px; font-size: 8.5px; letter-spacing: 0.14em; }
  .lnd-sf-h2 { font-size: 13.5px; font-weight: 700; line-height: 1.22; letter-spacing: -0.01em; }
  .lnd-sf-h3 { font-size: 11.5px; font-weight: 600; line-height: 1.25; margin-top: 3px; }
  .lnd-sf-desc { font-style: italic; font-size: 11.5px; line-height: 1.3; color: var(--k-ink-soft); }
  .lnd-sf-tags { font-size: 8.5px; letter-spacing: 0.06em; color: var(--k-ink-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lnd-sf-mute { font-size: 8.5px; letter-spacing: 0.1em; color: var(--k-ink-mute); }
  .lnd-sf-count { margin-top: auto; font-size: 8.5px; letter-spacing: 0.1em; color: var(--k-ink-mute); padding-top: 6px; border-top: 1px dashed var(--k-rule); }
  .lnd-sf-more { margin-top: 2px; }
  .lnd-sf-daydisc { flex: 0 0 auto; width: 44px; height: 44px; border-radius: 50%; color: var(--k-paper); display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1; }
  .lnd-sf-daydisc span:first-child { font-size: 7.5px; letter-spacing: 0.1em; }
  .lnd-sf-daynum { font-size: 17px; font-weight: 800; }
  .lnd-sf-col { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .lnd-sf-big { font-size: 22px; font-weight: 500; letter-spacing: 0.02em; }
  .lnd-sf-bars { display: flex; align-items: flex-end; gap: 3px; height: 32px; }
  .lnd-sf-barv { flex: 1; background: #9db97c; border-radius: 1px; }
  .lnd-sf-pop { font-size: 24px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; margin-top: 4px; }
  .lnd-sf-shot { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
  .lnd-sf-cap { display: flex; flex-direction: column; gap: 1px; padding: 0 2px; }
  .lnd-sf-cap-label { font-size: 9px; letter-spacing: 0.16em; font-weight: 500; }
  .lnd-sf-cap-line { font-style: italic; font-size: 14px; color: var(--k-ink-soft); }
  .lnd-sf-dots { display: flex; justify-content: center; gap: 6px; padding: 10px 0 16px; }
  .lnd-sf-dot { width: 6px; height: 6px; border-radius: 3px; transition: width 240ms ease; }
  .lnd-sf-dot--on { width: 18px; }
  .lnd-sf-pausebtn { background: none; border: 1px solid var(--k-rule); border-radius: 999px; padding: 4px 10px; font: inherit; font-size: 9.5px; letter-spacing: 0.12em; color: var(--k-ink-soft); cursor: pointer; min-height: 28px; }
  .lnd-clamp2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .lnd-clamp3 { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
```

Inside the existing `@media (max-width: 1023px)` block add:

```css
    .lnd-sf-head { padding: 0 16px 10px; font-size: 10px; }
    .lnd-sf-hint-phone { display: inline; }
    .lnd-sf-hint-desktop { display: none; }
    .lnd-sf-track { gap: 14px; padding: 4px 16px 6px; scroll-padding-left: 16px; }
    .lnd-sf-item { flex-basis: 236px; }
    .lnd-sf-frame { width: 236px; }
    .lnd-sf-title { font-size: 19px; }
    .lnd-sf-h2 { font-size: 14.5px; }
    .lnd-sf-photo { height: 112px; }
```

Also add, in the same file, a `.no-scrollbar` fallback in case the global utility is scoped elsewhere: `.lnd-sf-track::-webkit-scrollbar { display: none; } .lnd-sf-track { scrollbar-width: none; }`.

- [ ] **Step 5: Gates and a look**

Run: `pnpm type-check 2>&1 | grep -c 'error TS'` → `23`. Run: `npx -y svelte-check@4 2>&1 | tail -1` → `… 89 errors` (a new error in `LandingPage.svelte` must be fixed, not budgeted).

Start the dev server: `fuser -k 4655/tcp 2>/dev/null; (pnpm dev --port 4655 > /tmp/dev4655.log 2>&1 &)` then wait for `Local` in the log. Shoot logged-out: `curl -s http://localhost:4655/ | grep -c 'lnd-sf-frame'` → Expected `6` (one copy, SSR). Then a screenshot at 390 and 1440 px via the bundled Playwright:

```js
// scratchpad/sf-look.cjs — run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/sf-look.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const [tag, w, h, dsf] of [['phone', 390, 844, 2], ['desktop', 1440, 900, 1]]) {
    const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, locale: 'de-DE' });
    const p = await c.newPage();
    await p.goto('http://localhost:4655/', { waitUntil: 'networkidle' });
    await p.screenshot({ path: `scratchpad/sf-${tag}.png`, fullPage: true });
    await c.close();
  }
  await b.close(); console.log('ok');
})();
```

Look at both PNGs (Read tool) and fix anything clipped or overflowing before committing.

- [ ] **Step 6: Commit**

```bash
git add src/components/landing/LandingPage.svelte src/lib/kiosk-i18n.ts
git commit -m 'landing: Schaufenster strip markup, styles and draft copy; text teasers removed' -- src/components/landing/LandingPage.svelte src/lib/kiosk-i18n.ts
```

---

### Task 7: Motion — autoplay loop, pause rules, dots, keyboard, pause toggle

**Files:**
- Modify: `src/components/landing/LandingPage.svelte` (script + two markup spots)
- Create (gitignored, not committed): `scratchpad/schaufenster-probe.cjs`

**Interfaces:**
- Consumes: `advance`, `activeIndex` from `src/lib/landing/loop.ts` (Task 3); the `.lnd-sf-track` / `.lnd-sf-item` / `.lnd-sf-dots` DOM from Task 6.

- [ ] **Step 1: Script**

Add imports:

```ts
  import { onMount } from 'svelte';
  import { advance, activeIndex } from '../../lib/landing/loop';
```

Replace `const renderFrames = $derived(frames);` with the motion state:

```ts
  // ── motion: one native scroll container, rAF-driven scrollLeft, frames
  //    rendered twice for a seamless wrap (loop.ts). Reduced motion: one copy,
  //    no drive. Pause on any interaction, resume 4 s after the last one. ──
  const SPEED_PX_S = 40;
  const RESUME_MS = 4000;
  let trackEl = $state<HTMLDivElement | null>(null);
  let reduced = $state(false);
  let looping = $derived(!reduced && frames.length >= 2);
  let renderFrames = $derived(looping ? [...frames, ...frames] : frames);
  let paused = $state(false);       // user-held pause (toggle button)
  let interacting = $state(false);  // pointer/touch/wheel/focus/hover hold
  let inView = $state(true);     // IntersectionObserver
  let docVisible = $state(true); // document.visibilityState
  const visible = $derived(inView && docVisible);
  let active = $state(0);
  let raf = 0;
  let last = 0;
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  let hovering = false;

  const running = $derived(looping && !paused && !interacting && visible);

  function step(): number {
    const first = trackEl?.querySelector<HTMLElement>('.lnd-sf-item');
    if (!trackEl || !first) return 0;
    const gap = parseFloat(getComputedStyle(trackEl).columnGap || getComputedStyle(trackEl).gap || '0') || 0;
    return first.offsetWidth + gap;
  }

  function tick(t: number) {
    if (!trackEl || !running) { raf = 0; return; }
    const dt = last ? Math.min(64, t - last) : 16;
    last = t;
    const half = trackEl.scrollWidth / 2;
    trackEl.scrollLeft = advance(trackEl.scrollLeft, half, (SPEED_PX_S * dt) / 1000);
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (!trackEl || raf || !running) return;
    trackEl.style.scrollSnapType = 'none'; // a snap container re-snaps on every programmatic scroll
    last = 0;
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (trackEl) trackEl.style.scrollSnapType = '';
  }
  function hold() {
    interacting = true;
    clearTimeout(resumeTimer);
  }
  function release() {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => { if (!hovering) interacting = false; }, RESUME_MS);
  }
  function onScroll() {
    if (!trackEl) return;
    const s = step();
    if (s > 0) active = activeIndex(trackEl.scrollLeft, s, frames.length);
  }
  function onKey(e: KeyboardEvent) {
    if (!trackEl || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    e.preventDefault();
    hold();
    trackEl.scrollBy({ left: e.key === 'ArrowRight' ? step() : -step(), behavior: 'auto' });
    release();
  }

  $effect(() => { if (running) start(); else stop(); });

  onMount(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mq.matches;
    const onMq = () => { reduced = mq.matches; };
    mq.addEventListener('change', onMq);
    const io = trackEl ? new IntersectionObserver((es) => { inView = es.some((e) => e.isIntersecting); }, { threshold: 0.1 }) : null;
    if (trackEl && io) io.observe(trackEl);
    const onVis = () => { docVisible = document.visibilityState === 'visible'; };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mq.removeEventListener('change', onMq);
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      clearTimeout(resumeTimer);
      stop();
    };
  });
```

Note on `onVis`: when the tab is hidden the rAF loop stops by itself (browsers throttle) but `last` must reset — `tick` clamps `dt` to 64 ms so the strip never jumps after a return. Keep the clamp.

- [ ] **Step 2: Wire the track and the toggle**

On the track `<div class="lnd-sf-track …">` add:

```svelte
        bind:this={trackEl}
        onscroll={onScroll}
        onpointerdown={hold} onpointerup={release} onpointercancel={release}
        ontouchstart={hold} ontouchend={release} ontouchcancel={release}
        onwheel={() => { hold(); release(); }} onmouseenter={() => { hovering = true; hold(); }} onmouseleave={() => { hovering = false; release(); }}
        onfocusin={hold} onfocusout={release}
        onkeydown={onKey}
```

(A wheel has no end event, hence `hold()` + `release()` in one handler.)

Inside `.lnd-sf-head-right`, after the desktop hint, add the toggle:

```svelte
        {#if looping}
          <button type="button" class="lnd-sf-pausebtn font-dmmono" aria-pressed={paused} onclick={() => { paused = !paused; }}>{paused ? $t['lnd.sf.play'] : $t['lnd.sf.pause']}</button>
        {/if}
```

Dots: replace `class:lnd-sf-dot--on={i === 0}` with `class:lnd-sf-dot--on={i === active}`.

- [ ] **Step 3: Gates**

Run: `pnpm type-check 2>&1 | grep -c 'error TS'` → `23`. Run: `npx -y svelte-check@4 2>&1 | tail -1` → `… 89 errors`.

- [ ] **Step 4: Browser probe**

```js
// scratchpad/schaufenster-probe.cjs — run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/schaufenster-probe.cjs
const { chromium } = require('playwright');
const BASE = 'http://localhost:4655/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push([ok ? 'PASS' : 'FAIL', name, detail]); };
(async () => {
  const b = await chromium.launch();
  for (const [tag, w, h, mobile] of [['phone', 390, 844, true], ['desktop', 1440, 900, false]]) {
    const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: 'de-DE' });
    const p = await c.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await p.goto(BASE, { waitUntil: 'networkidle' });
    const items = await p.locator('.lnd-sf-item').count();
    check(`${tag}: 12 items (6 frames × 2)`, items === 12, String(items));
    const hidden = await p.locator('.lnd-sf-item[aria-hidden="true"]').count();
    check(`${tag}: duplicate copy aria-hidden`, hidden === 6, String(hidden));
    const sl0 = await p.evaluate(() => document.querySelector('.lnd-sf-track').scrollLeft);
    await sleep(3000);
    const sl1 = await p.evaluate(() => document.querySelector('.lnd-sf-track').scrollLeft);
    check(`${tag}: autoplay moved ~120 px in 3 s`, sl1 - sl0 > 80 && sl1 - sl0 < 200, `${(sl1 - sl0).toFixed(1)} px`);
    const box = await p.locator('.lnd-sf-track').boundingBox();
    await p.mouse.move(box.x + 100, box.y + 100);
    await p.mouse.down();
    await sleep(120);
    const a = await p.evaluate(() => document.querySelector('.lnd-sf-track').scrollLeft);
    await sleep(500);
    const b2 = await p.evaluate(() => document.querySelector('.lnd-sf-track').scrollLeft);
    check(`${tag}: pointerdown pauses within 120 ms`, Math.abs(b2 - a) < 1, `${(b2 - a).toFixed(2)} px drift`);
    await p.mouse.up();
    await p.mouse.move(0, 0);
    await sleep(4600);
    const c2 = await p.evaluate(() => document.querySelector('.lnd-sf-track').scrollLeft);
    check(`${tag}: resumes after 4 s with the pointer gone`, c2 - b2 > 10, `${(c2 - b2).toFixed(1)} px`);
    // wrap: jump near the half and watch two consecutive frames
    const wrap = await p.evaluate(async () => {
      const t = document.querySelector('.lnd-sf-track');
      const half = t.scrollWidth / 2;
      t.scrollLeft = half - 5;
      await new Promise((r) => setTimeout(r, 400));
      return { half, after: t.scrollLeft };
    });
    check(`${tag}: wrapped back below the half width`, wrap.after < wrap.half - 100, `half ${wrap.half.toFixed(0)}, after ${wrap.after.toFixed(0)}`);
    const dots = await p.locator('.lnd-sf-dot').count();
    check(`${tag}: six dots`, dots === 6, String(dots));
    const overflow = await p.evaluate(() => [...document.querySelectorAll('.lnd-sf-frame')].some((f) => f.scrollHeight > f.clientHeight + 1));
    check(`${tag}: no frame content overflows its box`, !overflow);
    const cls = await p.evaluate(() => new Promise((res) => { let v = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) v += e.value; }).observe({ type: 'layout-shift', buffered: true }); setTimeout(() => res(v), 800); }));
    check(`${tag}: CLS < 0.02`, cls < 0.02, cls.toFixed(4));
    check(`${tag}: no console/page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await p.screenshot({ path: `scratchpad/sf-${tag}-motion.png`, fullPage: false });
    await c.close();
  }
  // reduced motion
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', locale: 'de-DE' });
  const p = await c.newPage();
  await p.goto(BASE, { waitUntil: 'networkidle' });
  const n = await p.locator('.lnd-sf-item').count();
  check('reduced motion: six frames, no duplicate copy', n === 6, String(n));
  await sleep(3000);
  const sl = await p.evaluate(() => document.querySelector('.lnd-sf-track').scrollLeft);
  check('reduced motion: nothing moves', sl === 0, String(sl));
  const btn = await p.locator('.lnd-sf-pausebtn').count();
  check('reduced motion: no pause toggle', btn === 0, String(btn));
  await c.close();
  await b.close();
  for (const r of results) console.log(r.join('  '));
  process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
})();
```

Run it against the dev server on 4655. Expected: every line `PASS`. Read both `sf-*-motion.png` files.

For Review Focus 2 and 3, add to the dev DB (dev writes are fine, use the seed admin `admin@mahalle-dev.test`, password in `scratchpad/devpw.txt`, never printed) one topic with a 140-character title and re-run the probe: the „no frame content overflows" line must stay `PASS`. For the broken photo, temporarily set a Kurier `imageUrl` on dev to `https://mahalle.digital/does-not-exist.jpg` (dev DB only), delete the `landingCache` doc, reload: the frame shows the title without a broken image; restore the value afterwards.

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/LandingPage.svelte
git commit -m 'landing: Schaufenster autoplay loop, pause rules, dots, keyboard and pause toggle' -- src/components/landing/LandingPage.svelte
```

---

### Task 8: Dev event, privacy sentence, docs, prod-build check

**Files:**
- Modify: `src/pages/datenschutz.astro` (one sentence, DRAFT — find the paragraph about what members' content is visible to whom and add after it)
- Modify: `CLAUDE.md` (root: the „Landing ribbons" paragraph in Project Overview gains the Schaufenster; the `landingCache` collection line mentions `schaufenster`)
- Modify: `docs/superpowers/specs/2026-09-28-landing-schaufenster-design.md` (status line → implemented on branch)

- [ ] **Step 1: One upcoming dev event**

Log in on the dev server as `admin@mahalle-dev.test` (password from `scratchpad/devpw.txt`, read into the form, never printed) and create one public event three days ahead titled `Tag der offenen Tür · Karlsgarten`, category `kiez`, 15:00–17:00. Delete the `landingCache` doc on the dev DB (`db.collection('landingCache').deleteOne({ _id: 'landing' })` via a scratchpad script that refuses a non-dev db). Reload `/` logged out: the Kalender frame is live. Re-run `scratchpad/schaufenster-probe.cjs`: all `PASS`.

- [ ] **Step 2: Privacy sentence (DRAFT)**

`src/pages/datenschutz.astro` is German-only. Its line ~32 („… Mitglieder dich in der Vorschlagsliste finden – sichtbar sind dabei nur dein Anzeigename …") sits in the paragraph about what other members see; append one paragraph after that paragraph, in the same markup style:

```html
<p><!-- DRAFT copy (2026-09-28) — the owner words UI copy himself -->Titel neuer Beiträge, Termine und Anzeigen können bis zu eine Stunde nach dem Veröffentlichen im „Schaufenster" auf der Startseite erscheinen — ohne Namen, Profilbilder oder Adressen.</p>
```

(No English twin: the page has no English block.)

- [ ] **Step 3: Docs**

Root `CLAUDE.md`, Project Overview, after the „Kiosk footer (2026-09-28)" sentence, add:

`**Landing Schaufenster (2026-09-28):** the text teasers are gone; under the wordmark a self-scrolling strip of six phone-shaped frames shows each section LIVE (newest forum post title, next event, newest listing, Kurier lead, air + population, newest Beilage post — never a member's name; per-frame zero rule → static screenshot in `public/assets/schaufenster/`, reshoot with `scripts/schaufenster-fallbacks.mjs`). Data: `LandingData.schaufenster` in `src/lib/landing.ts` (1 h cache, fail-soft), pure view models `src/lib/landing/frames.ts`, loop maths `src/lib/landing/loop.ts`; one native scroll container, frames rendered twice, rAF at 40 px/s, snap off while driving, pause on any interaction, nothing under reduced motion. Spec: `docs/superpowers/specs/2026-09-28-landing-schaufenster-design.md`.`

`landingCache` line in Database Collections: append ` Since 2026-09-28 the payload also carries `schaufenster` (forum/event/listing peeks) and `kurier[].imageUrl`; a payload cached before that renders every frame in fallback mode.`

Spec file: change `**Status:** draft for the owner's review` to `**Status:** implemented on branch feat/landing-schaufenster (2026-09-28), owner's copy pending`.

- [ ] **Step 4: Production build pass**

Run: `pnpm build 2>&1 | tail -5` → Expected: no error. Then the orphan-CSS check for the island: `grep -o '[A-Za-z0-9_-]*\.css' .vercel/output/_functions/manifest_*.mjs | sort | uniq -c | sort -n | head -3` — every stylesheet listed must appear more than once (a count of `1` means an orphaned chunk; the strip's CSS lives in `LandingPage.svelte`, which is page-mounted, so none is expected).

- [ ] **Step 5: Gates and commit**

Run: `pnpm type-check 2>&1 | grep -c 'error TS'` → `23`; `npx -y svelte-check@4 2>&1 | tail -1` → `… 89 errors`; `npx tsx --test src/lib/landing/frames.test.ts src/lib/landing/loop.test.ts src/utils/cloudinary.test.ts` → all pass.

```bash
git add src/pages/datenschutz.astro CLAUDE.md docs/superpowers/specs/2026-09-28-landing-schaufenster-design.md
git commit -m 'landing: privacy sentence for the Schaufenster (draft), docs' -- src/pages/datenschutz.astro CLAUDE.md docs/superpowers/specs/2026-09-28-landing-schaufenster-design.md
```

---

## Handoff to the owner (after the final review)

Push the branch (`git push -u origin feat/landing-schaufenster`) — Vercel builds a preview on the dev DB — and give the owner the preview URL plus `scratchpad/sf-phone-motion.png` and `scratchpad/sf-desktop-motion.png`. The merge to `main` is his word.
