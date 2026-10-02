# „New since your last visit" (tab dots + card markers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member sees a dot on the Forum, Kalender, Markt and Blog tabs when something was published there since they last opened that section, and a „neu" chip on the cards published since their previous visit.

**Architecture:** One stamp per section on the user document (`users.lastVisit.<section>: Date`), written by `POST /api/profile/visit` when an index island mounts (the route answers with the PREVIOUS stamp = this visit's baseline). The nav island asks `GET /api/profile/section-news` once per page load (one `findOne` per collection, public content of other members only). Islands and cards share a tiny Svelte store (`visitClient.ts`); the pure rules (`visitRules.ts`) are tested with `node:test`.

**Tech Stack:** Astro 5 SSR + Svelte 5 islands, MongoDB driver, Zod, node:test via tsx.

**Spec:** `docs/superpowers/specs/2026-10-03-unread-and-forum-notifications-design.md` (section A). Every code block below was run on a throwaway branch (`scratch/plan-check`, commit `f28e5f4e`): tests green, tsc 16 / svelte-check 81, browser probe 13/13 on the local production build.

## Global Constraints

- Error budgets stay EXACTLY at `pnpm type-check` 16 errors and `npx -y svelte-check@4` 81 errors (ratchet-only, CI gates them).
- `pnpm test` must stay green (301 tests before this plan; +16 after Task 2).
- Commit messages: plain and concise. NO „🤖 Generated with Claude Code" line, NO „Co-Authored-By" footer.
- Never stage secrets; never print any `.env` value. The dev password lives in `scratchpad/devpw.txt` — read by probes, never printed.
- Files that are imported by islands must stay dependency-pure (no `mongodb`, no `astro:*`): `visitRules.ts`, `visitClient.ts`.
- `NewMark.svelte` is reached only through other islands → Tailwind classes only, NO `<style>` block (nested-island CSS orphan rule, root CLAUDE.md).
- Copy: DE first, EN mirror, both dicts in `src/lib/kiosk-i18n.ts`; new keys are draft copy for the owner to reword.
- Section ids are exactly `'forum' | 'kalender' | 'markt' | 'blog'` (`VISIT_SECTIONS`).

## Review Focus

1. A logged-out blog reader: `POST /api/profile/visit` answers 401 and the island must stay silent (no toast, no markers) — pinned by `markVisit()` returning on `!res.ok` (Task 3) and the probe's logged-out step is not needed: the blog island passes `me = null` and the route refuses without a session.
2. Astro's dev server preloads `client:only` pages in a hidden iframe — that must not count as a visit (`window.top !== window.self` guard in `markVisit()` and in the nav fetch, Task 3/4).
3. A member's own post must never show a chip or raise a dot — `isNewItem()` test „own content is never new" (Task 1) and the `author: { $ne: me }` / `sellerId: { $ne: me }` filters (Task 1 test „the dot filters…").
4. A reload inside a visit must keep the chips (otherwise they vanish before the member read the page) — `pickBaseline()` test „a reload inside the visit keeps the baseline" (Task 1), probe step „a reload keeps the markers" (Task 5).
5. A draft listing published after weeks must count as new AND must not be hidden as stale — `createdAt: new Date()` on publish (Task 4), checked by hand in Task 5.

---

### Task 1: Pure rules (`visitRules.ts`)

**Files:**
- Create: `src/lib/visits/visitRules.ts`
- Test: `src/lib/visits/visitRules.test.ts`

**Interfaces:**
- Produces: `VISIT_SECTIONS`, `VisitSection`, `SectionNews`, `NO_NEWS`, `VISIT_SESSION_MS`, `toMs(v)`, `isNewItem(created, authorId, since, me)`, `Baseline`, `pickBaseline(stored, serverPrevious, nowMs)`, `parseBaseline(raw)`, `forumNewsFilter(sinceMs, me)`, `eventNewsFilter(sinceMs, me, nowMs)`, `listingNewsFilter(sinceMs, me)`, `blogHasNews(pubDates, sinceMs, nowMs)` — exactly as in the file below; Tasks 2–4 import them.

- [ ] **Step 1: Write the failing tests**

`src/lib/visits/visitRules.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VISIT_SESSION_MS, NO_NEWS, toMs, isNewItem, pickBaseline, parseBaseline,
  forumNewsFilter, eventNewsFilter, listingNewsFilter, blogHasNews,
} from './visitRules';

const T0 = Date.parse('2026-10-03T08:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

test('toMs reads numbers, dates and ISO strings and refuses the rest', () => {
  assert.equal(toMs(T0), T0);
  assert.equal(toMs(new Date(T0)), T0);
  assert.equal(toMs(iso(T0)), T0);
  for (const bad of [null, undefined, '', 'gestern', NaN, new Date('x'), {}, true]) assert.equal(toMs(bad), null);
});

test('an item is new only when it is younger than the baseline', () => {
  assert.equal(isNewItem(T0 + 1, 'a', iso(T0), 'me'), true);
  assert.equal(isNewItem(T0, 'a', iso(T0), 'me'), false);
  assert.equal(isNewItem(T0 - 1, 'a', iso(T0), 'me'), false);
});

test('without a baseline nothing is new (first visit)', () => {
  assert.equal(isNewItem(T0 + 1, 'a', null, 'me'), false);
  assert.equal(isNewItem(T0 + 1, 'a', undefined, 'me'), false);
});

test('own content is never new; an item without author or a logged-out viewer still can be', () => {
  assert.equal(isNewItem(T0 + 1, 'me', iso(T0), 'me'), false);
  assert.equal(isNewItem(T0 + 1, null, iso(T0), 'me'), true);
  assert.equal(isNewItem(T0 + 1, 'a', iso(T0), null), true);
});

test('an unreadable creation date is not new', () => {
  assert.equal(isNewItem(undefined, 'a', iso(T0), 'me'), false);
  assert.equal(isNewItem('kaputt', 'a', iso(T0), 'me'), false);
});

test('a reload inside the visit keeps the baseline, a later visit takes the server stamp', () => {
  const first = pickBaseline(null, iso(T0), T0 + 1000);
  assert.deepEqual(first, { since: iso(T0), at: T0 + 1000 });
  const reload = pickBaseline(first, iso(T0 + 1000), T0 + 60_000);
  assert.deepEqual(reload, first);
  const later = pickBaseline(first, iso(T0 + 60_000), first.at + VISIT_SESSION_MS);
  assert.deepEqual(later, { since: iso(T0 + 60_000), at: first.at + VISIT_SESSION_MS });
});

test('a stored baseline from the future (clock change) is dropped', () => {
  const b = pickBaseline({ since: iso(T0), at: T0 + 5000 }, null, T0);
  assert.deepEqual(b, { since: null, at: T0 });
});

test('parseBaseline accepts its own output and refuses anything else', () => {
  const b = { since: iso(T0), at: T0 };
  assert.deepEqual(parseBaseline(JSON.stringify(b)), b);
  assert.deepEqual(parseBaseline(JSON.stringify({ since: null, at: T0 })), { since: null, at: T0 });
  for (const bad of [null, '', '{', '[]', '{"since":"x","at":1}', '{"since":null,"at":"1"}', '{"since":5,"at":1}']) {
    assert.equal(parseBaseline(bad), null);
  }
});

test('the dot filters look only at public content of other members', () => {
  const f = forumNewsFilter(T0, 'me');
  assert.deepEqual(f.date, { $gt: T0 });
  assert.deepEqual(f.author, { $ne: 'me' });
  assert.deepEqual(f.$or, [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }]);

  const e = eventNewsFilter(T0, 'me', T0 + 5);
  assert.deepEqual(e.endDate, { $gte: new Date(T0 + 5) });
  assert.deepEqual(e.author, { $ne: 'me' });

  const l = listingNewsFilter(T0, 'me');
  assert.deepEqual(l.createdAt, { $gt: new Date(T0) });
  assert.deepEqual(l.sellerId, { $ne: 'me' });
  assert.deepEqual(l.status, { $in: ['available', 'reserved'] });
});

test('the blog has news when a post is dated after the visit, but not for a future-dated post', () => {
  assert.equal(blogHasNews([iso(T0 - 1), new Date(T0 + 10)], T0, T0 + 100), true);
  assert.equal(blogHasNews([iso(T0 - 1), iso(T0)], T0, T0 + 100), false);
  assert.equal(blogHasNews([iso(T0 + 500)], T0, T0 + 100), false);
  assert.equal(blogHasNews([], T0, T0 + 100), false);
  assert.equal(blogHasNews(['kaputt', null], T0, T0 + 100), false);
});

test('NO_NEWS names all four sections', () => {
  assert.deepEqual(NO_NEWS, { forum: false, kalender: false, markt: false, blog: false });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test src/lib/visits/visitRules.test.ts`
Expected: fails with `Cannot find module './visitRules'`.

- [ ] **Step 3: Write the rules**

`src/lib/visits/visitRules.ts`:

```ts
/**
 * „New since your last visit" — pure rules shared by the server routes and the islands.
 * NO imports: this file ends up in client bundles (see root CLAUDE.md, „Server-only modules").
 *
 * A member's last visit of a section is stored as `users.lastVisit.<section>: Date`.
 * No stamp ⇒ nothing is „new" (the first visit only sets the baseline).
 * A member's own content never counts.
 */
export const VISIT_SECTIONS = ['forum', 'kalender', 'markt', 'blog'] as const;
export type VisitSection = (typeof VISIT_SECTIONS)[number];
export type SectionNews = Record<VisitSection, boolean>;
export const NO_NEWS: SectionNews = { forum: false, kalender: false, markt: false, blog: false };

/** How long one visit lasts for the card markers: a reload inside it keeps the same baseline. */
export const VISIT_SESSION_MS = 30 * 60 * 1000;

/** Milliseconds of a stored date in any of the shapes the collections use (number, Date, ISO string). */
export function toMs(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === 'string' && v !== '') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** Does a card get the „neu" marker? `since` = the baseline of this visit, `me` = the viewer's id. */
export function isNewItem(
  created: unknown,
  authorId: string | null | undefined,
  since: string | null | undefined,
  me: string | null | undefined,
): boolean {
  const sinceMs = toMs(since);
  const at = toMs(created);
  if (sinceMs === null || at === null) return false;
  if (me && authorId && authorId === me) return false;
  return at > sinceMs;
}

export interface Baseline {
  /** ISO time of the PREVIOUS visit, or null when there was none. */
  since: string | null;
  /** When this visit began (ms). */
  at: number;
}

/** Keep the baseline of a running visit; otherwise start a new visit from the server's previous stamp. */
export function pickBaseline(stored: Baseline | null, serverPrevious: string | null, nowMs: number): Baseline {
  if (stored && Number.isFinite(stored.at) && nowMs >= stored.at && nowMs - stored.at < VISIT_SESSION_MS) {
    return stored;
  }
  return { since: serverPrevious, at: nowMs };
}

export function parseBaseline(raw: string | null): Baseline | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { since?: unknown; at?: unknown };
    if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
    if (v.since !== null && (typeof v.since !== 'string' || toMs(v.since) === null)) return null;
    return { since: v.since as string | null, at: v.at };
  } catch {
    return null;
  }
}

// ── Query filters for the tab dots (public content only, never the member's own) ──────────

const PUBLIC_OR = [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }];

/** topics / announcements / recommendations: `date` is Date.now() at creation, `author` a user-id string. */
export function forumNewsFilter(sinceMs: number, me: string) {
  return { date: { $gt: sinceMs }, author: { $ne: me }, $or: PUBLIC_OR };
}

/** events: created since the visit and not over yet. */
export function eventNewsFilter(sinceMs: number, me: string, nowMs: number) {
  return { date: { $gt: sinceMs }, author: { $ne: me }, endDate: { $gte: new Date(nowMs) }, $or: PUBLIC_OR };
}

/** listings: published since the visit and still on offer. */
export function listingNewsFilter(sinceMs: number, me: string) {
  return {
    createdAt: { $gt: new Date(sinceMs) },
    sellerId: { $ne: me },
    status: { $in: ['available', 'reserved'] },
    $or: PUBLIC_OR,
  };
}

/** blog: any published post dated after the visit (and not in the future). */
export function blogHasNews(pubDates: unknown[], sinceMs: number, nowMs: number): boolean {
  return pubDates.some((d) => {
    const t = toMs(d);
    return t !== null && t > sinceMs && t <= nowMs;
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test src/lib/visits/visitRules.test.ts`
Expected: `ℹ tests 11` / `ℹ pass 11`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/visits/visitRules.ts src/lib/visits/visitRules.test.ts
git commit -m "feat: visit rules — new since last visit, baselines, dot filters"
```

---

### Task 2: Server side — section news + the two routes

**Files:**
- Create: `src/lib/visits/sectionNews.ts`, `src/pages/api/profile/visit.ts`, `src/pages/api/profile/section-news.ts`
- Test: `src/lib/visits/sectionNews.test.ts`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `getSectionNews(db, userId, lastVisit, blogPubDates, nowMs): Promise<SectionNews>`; `POST /api/profile/visit` body `{ section }` → `{ previous: ISO | null }` (401 without session, 400 on an unknown section); `GET /api/profile/section-news` → `SectionNews` (401 without session; `NO_NEWS` with 200 on any failure). Both routes send `Cache-Control: no-store`. `/api/profile/*` is NOT in the middleware's `GATED_APIS`, so the routes answer their own 401.

- [ ] **Step 1: Write the failing tests**

`src/lib/visits/sectionNews.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from 'mongodb';
import { getSectionNews } from './sectionNews';

const NOW = Date.parse('2026-10-03T08:00:00.000Z');
const HOUR = 3_600_000;

/** A Db double: `hits` names the collections whose query finds a document; every call is recorded. */
function fakeDb(hits: string[]) {
  const calls: { collection: string; filter: Record<string, any> }[] = [];
  const db = {
    collection: (name: string) => ({
      findOne: async (filter: Record<string, any>) => {
        calls.push({ collection: name, filter });
        return hits.includes(name) ? { _id: 'x' } : null;
      },
    }),
  } as unknown as Db;
  return { db, calls };
}

test('a member without any visit stamp gets no dot and no query', async () => {
  const { db, calls } = fakeDb(['topics', 'events', 'listings']);
  const news = await getSectionNews(db, 'me', undefined, [new Date(NOW - HOUR)], NOW);
  assert.deepEqual(news, { forum: false, kalender: false, markt: false, blog: false });
  assert.equal(calls.length, 0);
});

test('only sections with a stamp are asked, each with its own stamp', async () => {
  const { db, calls } = fakeDb(['announcements']);
  const forumAt = new Date(NOW - 5 * HOUR);
  const news = await getSectionNews(db, 'me', { forum: forumAt }, [], NOW);
  assert.deepEqual(news, { forum: true, kalender: false, markt: false, blog: false });
  assert.deepEqual(calls.map((c) => c.collection).sort(), ['announcements', 'recommendations', 'topics']);
  for (const c of calls) {
    assert.deepEqual(c.filter.date, { $gt: forumAt.getTime() });
    assert.deepEqual(c.filter.author, { $ne: 'me' });
  }
});

test('calendar, market and blog each follow their own stamp', async () => {
  const { db, calls } = fakeDb(['events', 'listings']);
  const news = await getSectionNews(
    db, 'me',
    { kalender: new Date(NOW - HOUR), markt: new Date(NOW - 2 * HOUR).toISOString(), blog: new Date(NOW - 3 * HOUR) },
    [new Date(NOW - 2 * HOUR)],
    NOW,
  );
  assert.deepEqual(news, { forum: false, kalender: true, markt: true, blog: true });
  assert.deepEqual(calls.map((c) => c.collection).sort(), ['events', 'listings']);
  const listing = calls.find((c) => c.collection === 'listings')!;
  assert.deepEqual(listing.filter.createdAt, { $gt: new Date(NOW - 2 * HOUR) });
});

test('a blog post older than the blog visit raises no dot', async () => {
  const { db } = fakeDb([]);
  const news = await getSectionNews(db, 'me', { blog: new Date(NOW - HOUR) }, [new Date(NOW - 2 * HOUR)], NOW);
  assert.equal(news.blog, false);
});

test('an unreadable stamp counts as no stamp', async () => {
  const { db, calls } = fakeDb(['topics']);
  const news = await getSectionNews(db, 'me', { forum: 'kaputt' }, [], NOW);
  assert.equal(news.forum, false);
  assert.equal(calls.length, 0);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test src/lib/visits/sectionNews.test.ts`
Expected: fails with `Cannot find module './sectionNews'`.

- [ ] **Step 3: Write the server helper**

`src/lib/visits/sectionNews.ts`:

```ts
/**
 * Tab dots: is there public content of OTHER members in a section that is younger than the
 * member's last visit of it? SERVER-ONLY (takes a Db). One cheap existence query per collection,
 * all in parallel; a section the member never opened has no dot.
 */
import type { Db } from 'mongodb';
import {
  NO_NEWS, toMs, forumNewsFilter, eventNewsFilter, listingNewsFilter, blogHasNews,
  type SectionNews, type VisitSection,
} from './visitRules';

export type LastVisit = Partial<Record<VisitSection, unknown>>;

const ID_ONLY = { projection: { _id: 1 } } as const;

export async function getSectionNews(
  db: Db,
  userId: string,
  lastVisit: LastVisit | null | undefined,
  blogPubDates: unknown[],
  nowMs: number,
): Promise<SectionNews> {
  const since = (s: VisitSection) => toMs(lastVisit?.[s]);
  const forum = since('forum');
  const kalender = since('kalender');
  const markt = since('markt');
  const blog = since('blog');

  const exists = async (collection: string, filter: Record<string, unknown>) =>
    (await db.collection(collection).findOne(filter, ID_ONLY)) !== null;

  const [topics, announcements, recommendations, events, listings] = await Promise.all([
    forum === null ? false : exists('topics', forumNewsFilter(forum, userId)),
    forum === null ? false : exists('announcements', forumNewsFilter(forum, userId)),
    forum === null ? false : exists('recommendations', forumNewsFilter(forum, userId)),
    kalender === null ? false : exists('events', eventNewsFilter(kalender, userId, nowMs)),
    markt === null ? false : exists('listings', listingNewsFilter(markt, userId)),
  ]);

  return {
    ...NO_NEWS,
    forum: topics || announcements || recommendations,
    kalender: events,
    markt: listings,
    blog: blog === null ? false : blogHasNews(blogPubDates, blog, nowMs),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test src/lib/visits/sectionNews.test.ts`
Expected: `ℹ tests 5` / `ℹ pass 5`.

- [ ] **Step 5: Write the visit route**

`src/pages/api/profile/visit.ts` (sibling of `tour.ts`, same session check, deliberately not ban-gated — reading is allowed while banned):

```ts
import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { connectDB } from '../../../lib/mongodb';
import { VISIT_SECTIONS, toMs } from '../../../lib/visits/visitRules';

// „New since your last visit": opening a section's index page stamps
// users.lastVisit.<section> and answers with the PREVIOUS stamp — the baseline
// for that visit's card markers. Not ban-gated (reading is allowed while banned).
const BodySchema = z.object({ section: z.enum(VISIT_SECTIONS) });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id || !ObjectId.isValid(session.user.id)) return json({ error: 'Unauthorized' }, 401);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid section' }, 400);
  const { section } = parsed.data;

  const db = await connectDB();
  const before = await db.collection('users').findOneAndUpdate(
    { _id: new ObjectId(session.user.id) },
    { $set: { [`lastVisit.${section}`]: new Date() } },
    { returnDocument: 'before', projection: { lastVisit: 1 } },
  );
  const previousMs = toMs(before?.lastVisit?.[section]);
  return json({ previous: previousMs === null ? null : new Date(previousMs).toISOString() });
};
```

- [ ] **Step 6: Write the section-news route**

`src/pages/api/profile/section-news.ts`:

```ts
import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { getCollection } from 'astro:content';
import { ObjectId } from 'mongodb';
import * as Sentry from '@sentry/astro';
import { connectDB } from '../../../lib/mongodb';
import { getSectionNews } from '../../../lib/visits/sectionNews';
import { NO_NEWS } from '../../../lib/visits/visitRules';

// Tab dots for the nav: which sections hold something newer than the member's
// last visit. A failure answers „nothing new" — a dot is never worth an error.
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id || !ObjectId.isValid(session.user.id)) return json({ error: 'Unauthorized' }, 401);
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(session.user.id) },
      { projection: { lastVisit: 1 } },
    );
    const posts = await getCollection('blog', ({ data }) => !data.draft);
    const news = await getSectionNews(
      db, session.user.id, user?.lastVisit, posts.map((p) => p.data.pubDate), Date.now(),
    );
    return json(news);
  } catch (err) {
    console.error('[section-news] failed:', err);
    Sentry.captureException(err);
    await Sentry.flush(2000);
    return json(NO_NEWS);
  }
};
```

- [ ] **Step 7: Type-check**

Run: `pnpm type-check 2>&1 | grep -c "error TS"`
Expected: `16` (unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/lib/visits/sectionNews.ts src/lib/visits/sectionNews.test.ts src/pages/api/profile/visit.ts src/pages/api/profile/section-news.ts
git commit -m "feat: visit stamps and section-news routes"
```

---

### Task 3: Client store, the „neu" chip, and the four index pages

**Files:**
- Create: `src/lib/visits/visitClient.ts`, `src/components/forum/kiosk/NewMark.svelte`
- Modify: `src/lib/kiosk-i18n.ts` (two keys in each dict), `src/components/forum/kiosk/ForumIndexInner.svelte`, `src/components/forum/kiosk/ForumPostCard.svelte`, `src/components/marketplace/kiosk/browse/MarketplaceBrowseInner.svelte`, `src/components/marketplace/kiosk/browse/ListingCard.svelte`, `src/components/calendar/kiosk/CalendarPageInner.svelte`, `src/components/calendar/kiosk/AgendaRow.svelte`, `src/components/blog/kiosk/BeilageIndex.svelte`

**Interfaces:**
- Consumes: `isNewItem`, `pickBaseline`, `parseBaseline`, `VisitSection` (Task 1); the route `POST /api/profile/visit` (Task 2).
- Produces: `visitState` store `{ me, since: { [section]: ISO | null } }`, `markVisit(section, me)`; `<NewMark section created authorId? invert? />`.

- [ ] **Step 1: Write the client store**

`src/lib/visits/visitClient.ts`:

```ts
/**
 * Client side of „new since your last visit". An index island calls markVisit() once on
 * mount; the cards read `visitState` through NewMark.svelte. One module instance is shared
 * by all islands of a page (like the kiosk-i18n stores).
 */
import { writable } from 'svelte/store';
import { parseBaseline, pickBaseline, type VisitSection } from './visitRules';

export interface VisitState {
  me: string | null;
  since: Partial<Record<VisitSection, string | null>>;
}

export const visitState = writable<VisitState>({ me: null, since: {} });

const storageKey = (section: VisitSection) => `mahalle:visit:${section}`;

function readStored(section: VisitSection) {
  try { return parseBaseline(sessionStorage.getItem(storageKey(section))); } catch { return null; }
}

/** Stamp the visit on the server and publish this visit's baseline. Never throws. */
export async function markVisit(section: VisitSection, me: string | null): Promise<void> {
  if (typeof window === 'undefined') return;
  // Astro's dev server preloads client:only pages in a hidden iframe — that is not a visit.
  if (window.top !== window.self) return;
  const publish = (since: string | null) =>
    visitState.update((s) => ({ me, since: { ...s.since, [section]: since } }));

  // A running visit shows its markers at once, before the request returns.
  const stored = readStored(section);
  const running = stored ? pickBaseline(stored, null, Date.now()) : null;
  if (stored && running === stored) publish(stored.since);

  try {
    const res = await fetch('/api/profile/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section }),
    });
    if (!res.ok) return; // logged out (401) or a hiccup: no markers, nothing stored
    const data = (await res.json()) as { previous?: string | null };
    const baseline = pickBaseline(stored, data.previous ?? null, Date.now());
    try { sessionStorage.setItem(storageKey(section), JSON.stringify(baseline)); } catch { /* private mode */ }
    publish(baseline.since);
  } catch {
    /* offline: keep whatever is shown */
  }
}
```

- [ ] **Step 2: Write the chip**

`src/components/forum/kiosk/NewMark.svelte` (note the `let {...}: {...} = $props()` form — the `$props<{...}>()` generic form made svelte-check type the store index as `any`, +1 error):

```svelte
<script lang="ts">
  // „neu" chip on a card that was published since the member's previous visit of the
  // section (and is not the member's own). Tailwind classes only — no <style> block:
  // this component is reached only through other islands (see root CLAUDE.md,
  // „Nested-island Svelte <style> blocks get orphaned").
  import { t } from '../../../lib/kiosk-i18n';
  import { visitState } from '../../../lib/visits/visitClient';
  import { isNewItem, type VisitSection } from '../../../lib/visits/visitRules';

  let { section, created, authorId = null, invert = false }: {
    section: VisitSection;
    created: unknown;
    authorId?: string | null;
    /** paper chip for a card with an ink background */
    invert?: boolean;
  } = $props();

  const show = $derived(isNewItem(created, authorId, $visitState.since[section], $visitState.me));
</script>

{#if show}
  <span
    data-new-mark
    class="inline-block shrink-0 align-middle font-dmmono text-[9.5px] leading-none uppercase tracking-[0.12em] px-1.5 py-[3px] rounded-[3px] {invert ? 'bg-paper text-ink' : 'bg-ink text-paper'}"
  >{$t['common.new']}</span>
{/if}
```

- [ ] **Step 3: Add the copy**

Apply to `src/lib/kiosk-i18n.ts` (DE block near `'common.cancel'`, EN block near its mirror):

```diff
diff --git a/src/lib/kiosk-i18n.ts b/src/lib/kiosk-i18n.ts
index 6a9637e4..7ccb94a7 100644
--- a/src/lib/kiosk-i18n.ts
+++ b/src/lib/kiosk-i18n.ts
@@ -89,6 +89,8 @@ const de = {
   'common.confirm.title': 'Bist du sicher?',
   'common.confirm.cta': 'Bestätigen',
   'common.cancel': 'Abbrechen',
+  'common.new': 'neu',
+  'nav.newDot': 'Neues seit deinem letzten Besuch',
   'nav.menu.abmelden': 'Abmelden',
   'nav.menu.seit': 'IM KIEZ SEIT',
 
@@ -2187,6 +2189,8 @@ const en: Dict = {
   'common.confirm.title': 'Are you sure?',
   'common.confirm.cta': 'Confirm',
   'common.cancel': 'Cancel',
+  'common.new': 'new',
+  'nav.newDot': 'New since your last visit',
   'nav.menu.abmelden': 'Sign out',
   'nav.menu.seit': 'IN THE KIEZ SINCE',
```

(The `nav.newDot` keys are read by Task 4; add them now so the dict is complete.)

- [ ] **Step 4: Forum — one call on mount, chip in the card's right cluster**

```diff
diff --git a/src/components/forum/kiosk/ForumIndexInner.svelte b/src/components/forum/kiosk/ForumIndexInner.svelte
index 47b824f7..0b25b9e4 100644
--- a/src/components/forum/kiosk/ForumIndexInner.svelte
+++ b/src/components/forum/kiosk/ForumIndexInner.svelte
@@ -49,6 +49,7 @@
   import OwnStatusBanner from './states/OwnStatusBanner.svelte';
   import FeedStatusFooter from './states/FeedStatusFooter.svelte';
   import ForumDraftsSection from './ForumDraftsSection.svelte';
+  import { markVisit } from '../../../lib/visits/visitClient';
 
   let { initialItems = [], currentUserId = null } = $props<{
     initialItems?: any[];
@@ -64,6 +65,7 @@
   let savedIds = $state<Set<string>>(new Set());
 
   onMount(() => {
+    void markVisit('forum', currentUserId);
     const url = new URL(window.location.href);
     if (url.searchParams.get('just_posted') === '1') {
       showToast($t['forum.compose.success'], { type: 'success' });
```

```diff
diff --git a/src/components/forum/kiosk/ForumPostCard.svelte b/src/components/forum/kiosk/ForumPostCard.svelte
index cc78c36e..b7072106 100644
--- a/src/components/forum/kiosk/ForumPostCard.svelte
+++ b/src/components/forum/kiosk/ForumPostCard.svelte
@@ -34,6 +34,7 @@
   import { relTime as relTimeFor } from '../../../lib/relTime';
   import { optimizeCloudinary } from '../../../utils/cloudinary';
   import { shortenUrlsInText } from '../../../lib/linkify';
+  import NewMark from './NewMark.svelte';
 
   let {
     topic,
@@ -302,6 +303,7 @@
            layout. Order matches the visual hierarchy: kind first, state
            below as a modifier. -->
       <div class="flex flex-col items-end gap-1.5 shrink-0">
+        <NewMark section="forum" created={topic.date} {authorId} invert={isInkCard} />
         {#if !strapLabel}
           <!-- Card kind-chip — direct port of the design HTML
                (Mahalle Redesign.html). Filled with the kind color
```

`isInkCard` already exists in the card (dark official cards) — the chip inverts there so it stays readable.

- [ ] **Step 5: Markt — call on mount, chip beside the relative time**

```diff
diff --git a/src/components/marketplace/kiosk/browse/MarketplaceBrowseInner.svelte b/src/components/marketplace/kiosk/browse/MarketplaceBrowseInner.svelte
index afa62f24..43cb1713 100644
--- a/src/components/marketplace/kiosk/browse/MarketplaceBrowseInner.svelte
+++ b/src/components/marketplace/kiosk/browse/MarketplaceBrowseInner.svelte
@@ -30,6 +30,7 @@
   import MarketEmpty from '../states/MarketEmpty.svelte';
   import MarketSearchEmpty from '../states/MarketSearchEmpty.svelte';
   import MarketError from '../states/MarketError.svelte';
+  import { markVisit } from '../../../../lib/visits/visitClient';
 
   // ── Props ────────────────────────────────────────────────────────────
   let { initialData, currentUserId }: {
@@ -282,6 +283,7 @@
 
   // ── Mount: hydrate from URL if not default + consume flash params ───
   onMount(() => {
+    void markVisit('markt', currentUserId);
     // ── Flash toasts from compose / edit redirects ─────────────────────
     const url = new URL(window.location.href);
     const params = url.searchParams;
```

```diff
diff --git a/src/components/marketplace/kiosk/browse/ListingCard.svelte b/src/components/marketplace/kiosk/browse/ListingCard.svelte
index d24451cc..ca6dbd0f 100644
--- a/src/components/marketplace/kiosk/browse/ListingCard.svelte
+++ b/src/components/marketplace/kiosk/browse/ListingCard.svelte
@@ -12,6 +12,7 @@
   import MarketStrap from '../primitives/MarketStrap.svelte';
   import KioskAvatar from '../../../forum/kiosk/KioskAvatar.svelte';
   import StatusBadge from '../../../forum/kiosk/StatusBadge.svelte';
+  import NewMark from '../../../forum/kiosk/NewMark.svelte';
 
   let {
     listing,
@@ -226,12 +227,15 @@
       "
     >
       <CategoryChip id={listing.category} mini={true} />
-      <span
-        style="
-          font-family: var(--k-font-mono); font-size: 10px;
-          color: var(--k-ink-mute);
-        "
-      >{relTime}</span>
+      <span style="display: inline-flex; align-items: center; gap: 6px;">
+        <NewMark section="markt" created={listing.createdAt} authorId={String(listing.sellerId ?? '')} />
+        <span
+          style="
+            font-family: var(--k-font-mono); font-size: 10px;
+            color: var(--k-ink-mute);
+          "
+        >{relTime}</span>
+      </span>
     </div>
 
     <!-- Title -->
```

No chip on `ListingLead.svelte`: the lead card already wears the „frisch im Kiez heute" strap.

- [ ] **Step 6: Kalender — call on mount, chip after the title in both agenda row variants**

```diff
diff --git a/src/components/calendar/kiosk/CalendarPageInner.svelte b/src/components/calendar/kiosk/CalendarPageInner.svelte
index b1e06704..3063ad3e 100644
--- a/src/components/calendar/kiosk/CalendarPageInner.svelte
+++ b/src/components/calendar/kiosk/CalendarPageInner.svelte
@@ -41,12 +41,16 @@
   import { createSavedEventsQuery, createSaveEventMutation } from '../../../lib/savedEventsQueries';
   import { showToast, showSuccess } from '../../../utils/toast';
   import type { EventCategory, Event as EventDoc } from '../../../types';
+  import { onMount } from 'svelte';
+  import { markVisit } from '../../../lib/visits/visitClient';
 
   let { initialEvents = [], currentUserId = null } = $props<{
     initialEvents?: any[];
     currentUserId?: string | null;
   }>();
 
+  onMount(() => { void markVisit('kalender', currentUserId); });
+
   // useQueryClient must be called during component setup (it reads from
   // QueryClientProvider context). Used by the flash-effect below to
   // cache-bust the events query so the UI catches up to the DB write.
```

```diff
diff --git a/src/components/calendar/kiosk/AgendaRow.svelte b/src/components/calendar/kiosk/AgendaRow.svelte
index 90889e3e..1a5b3921 100644
--- a/src/components/calendar/kiosk/AgendaRow.svelte
+++ b/src/components/calendar/kiosk/AgendaRow.svelte
@@ -14,6 +14,7 @@
   import { showError } from '../../../utils/toast';
   import StatusBadge from '../../forum/kiosk/StatusBadge.svelte';
   import type { Event as EventDoc, EventCategory } from '../../../types';
+  import NewMark from '../../forum/kiosk/NewMark.svelte';
 
   let {
     ev,
@@ -177,6 +178,7 @@
         >
           {ev.title}
         </button>
+        <NewMark section="kalender" created={(ev as any).date} {authorId} invert={!!today} />
       </h4>
 
       {#if ev.location}
@@ -274,6 +276,7 @@
         >
           {ev.title}
         </button>
+        <NewMark section="kalender" created={(ev as any).date} {authorId} invert={!!today} />
       </h4>
 
       <!-- Meta line: time + location + organizer.
```

`ev.date` is the creation timestamp (`Date.now()` in `events/create.ts`); the `Event` type does not declare it, hence `(ev as any).date`. The month grid pills get no chip (too small); the agenda rows are what phones show.

- [ ] **Step 7: Blog — call on mount (no account authors), chip in the column cards and on the lead**

```diff
diff --git a/src/components/blog/kiosk/BeilageIndex.svelte b/src/components/blog/kiosk/BeilageIndex.svelte
index 9b7ddb52..5cbf3604 100644
--- a/src/components/blog/kiosk/BeilageIndex.svelte
+++ b/src/components/blog/kiosk/BeilageIndex.svelte
@@ -25,9 +25,16 @@
   import BlPostMeta from './BlPostMeta.svelte';
   import BlLayoutBadge from './BlLayoutBadge.svelte';
   import { initialsOf } from '../../../lib/initials';
+  import { onMount } from 'svelte';
+  import NewMark from '../../forum/kiosk/NewMark.svelte';
+  import { markVisit } from '../../../lib/visits/visitClient';
 
   let { posts }: { posts: BeilagePost[] } = $props();
 
+  // Blog authors are plain names, not accounts — nothing is „own" here. Logged-out
+  // readers get a 401 from the visit route and simply see no markers.
+  onMount(() => { void markVisit('blog', null); });
+
   // ── State ────────────────────────────────────────────────────────
   let query = $state('');
   let activeTag = $state<string | null>(null);
@@ -205,6 +212,7 @@
     <div class="flex items-center" style="gap: 8px;">
       <span class="font-dmmono" style="font-size: 9.5px; letter-spacing: 0.12em; color: var(--k-rust);">{fmtDateKicker(post.pubDateISO, $locale)}</span>
       <BlLayoutBadge layout={post.layout} />
+      <NewMark section="blog" created={post.pubDateISO} />
     </div>
     <h3 class="font-bricolage" style="font-size: 18px; font-weight: 700; letter-spacing: -0.015em; line-height: 1.15; margin: 5px 0 6px;">{post.title}</h3>
     <div style="font-size: 12.5px; line-height: 1.45; color: var(--k-ink-soft); margin-bottom: 8px;">{post.description}</div>
@@ -360,6 +368,7 @@
                   class="font-dmmono inline-block"
                   style="font-size: 10px; letter-spacing: 0.14em; background: var(--k-rust); color: var(--k-paper); padding: 3px 10px; border-radius: 4px; border: 1px solid var(--k-ink);"
                 >{$t['blog.lead.strap']}</span>
+                <NewMark section="blog" created={lead.pubDateISO} />
                 <h2 class="font-bricolage text-[21px] md:text-[33px]" style="font-weight: 800; letter-spacing: -0.025em; line-height: 1.04; margin: 12px 0 8px;">{lead.title}</h2>
                 <div class="font-instrument italic" style="font-size: 16.5px; line-height: 1.45; color: var(--k-ink-soft); margin-bottom: 10px;">{lead.description}</div>
                 <BlPostMeta post={lead} />
```

- [ ] **Step 8: Check the budgets**

Run: `pnpm type-check 2>&1 | grep -c "error TS"` → `16`.
Run: `npx -y svelte-check@4 2>&1 | tail -1` → `… 81 ERRORS …`.
If svelte-check reports 82, the extra one is in a file you touched — fix it, never raise the budget.

- [ ] **Step 9: Commit**

```bash
git add src/lib/visits/visitClient.ts src/components/forum/kiosk/NewMark.svelte src/lib/kiosk-i18n.ts src/components/forum/kiosk/ForumIndexInner.svelte src/components/forum/kiosk/ForumPostCard.svelte src/components/marketplace/kiosk/browse/MarketplaceBrowseInner.svelte src/components/marketplace/kiosk/browse/ListingCard.svelte src/components/calendar/kiosk/CalendarPageInner.svelte src/components/calendar/kiosk/AgendaRow.svelte src/components/blog/kiosk/BeilageIndex.svelte
git commit -m "feat: „neu" chips on cards published since the member's last visit"
```

---

### Task 4: Tab dots, the avatar-menu blog dot, tombstone, listing publish stamp

**Files:**
- Modify: `src/components/forum/kiosk/KioskNav.svelte`, `src/components/forum/kiosk/AvatarMenu.svelte`, `src/lib/auth/accountDeletion.ts`, `src/pages/api/listings/draft/[id]/publish.ts`

**Interfaces:**
- Consumes: `GET /api/profile/section-news` (Task 2), `NO_NEWS`, `SectionNews`, `VisitSection` (Task 1), the `nav.newDot` key (Task 3).
- Produces: `AvatarMenu` prop `blogNew?: boolean`.

- [ ] **Step 1: KioskNav — fetch once, `section` on the items, inline dot after the label**

```diff
diff --git a/src/components/forum/kiosk/KioskNav.svelte b/src/components/forum/kiosk/KioskNav.svelte
index a777c559..f56185b6 100644
--- a/src/components/forum/kiosk/KioskNav.svelte
+++ b/src/components/forum/kiosk/KioskNav.svelte
@@ -15,7 +15,8 @@
   import MastSearch from './MastSearch.svelte';
   import SearchModal from '../../search/SearchModal.svelte';
   import { navigate } from 'astro:transitions/client';
-  import { untrack } from 'svelte';
+  import { untrack, onMount } from 'svelte';
+  import { NO_NEWS, type SectionNews, type VisitSection } from '../../../lib/visits/visitRules';
   import { initialMastState, nextMastState, MAST_HIDE_QUERY } from '../../../lib/nav/hideOnScroll';
 
   let { currentPath = '/', user = null } = $props<{
@@ -23,6 +24,17 @@
     user?: { name?: string; image?: string | null; role?: string } | null;
   }>();
 
+  // „New since your last visit" dots (one read per page load, members only). The
+  // tab of the section that is open never shows one — opening it is the visit.
+  let news = $state<SectionNews>(NO_NEWS);
+  onMount(() => {
+    if (!user || window.top !== window.self) return;
+    fetch('/api/profile/section-news')
+      .then((r) => (r.ok ? r.json() : null))
+      .then((d) => { if (d) news = { ...NO_NEWS, ...d }; })
+      .catch(() => {});
+  });
+
   let menuOpen = $state(false);
   let bellOpen = $state(false);
 
@@ -207,21 +219,25 @@
   const CALENDAR_MATCH = ['/calendar', '/events'];
 
   const topNav = $derived([
-    { href: '/forum',        label: $t['nav.forum'],       match: FORUM_MATCH },
-    { href: '/calendar',     label: $t['nav.calendar'],    match: CALENDAR_MATCH },
-    { href: '/newsboard',    label: $t['nav.news'],        match: ['/newsboard'] },
-    { href: '/marketplace',  label: $t['nav.marketplace'], match: ['/marketplace'] },
-    { href: '/schillerkiez', label: $t['nav.kiez'],        match: ['/schillerkiez'] },
-    { href: '/blog',         label: $t['nav.blog'],        match: ['/blog'] }
-  ]);
+    { href: '/forum',        label: $t['nav.forum'],       match: FORUM_MATCH,       section: 'forum' },
+    { href: '/calendar',     label: $t['nav.calendar'],    match: CALENDAR_MATCH,    section: 'kalender' },
+    { href: '/newsboard',    label: $t['nav.news'],        match: ['/newsboard'],    section: null },
+    { href: '/marketplace',  label: $t['nav.marketplace'], match: ['/marketplace'],  section: 'markt' },
+    { href: '/schillerkiez', label: $t['nav.kiez'],        match: ['/schillerkiez'], section: null },
+    { href: '/blog',         label: $t['nav.blog'],        match: ['/blog'],         section: 'blog' }
+  ] as { href: string; label: string; match: string[]; section: VisitSection | null }[]);
 
   const bottomNav = $derived([
-    { href: '/forum',        label: $t['nav.short.forum'],       match: FORUM_MATCH },
-    { href: '/calendar',     label: $t['nav.short.calendar'],    match: CALENDAR_MATCH },
-    { href: '/newsboard',    label: $t['nav.short.news'],        match: ['/newsboard'] },
-    { href: '/marketplace',  label: $t['nav.short.marketplace'], match: ['/marketplace'] },
-    { href: '/schillerkiez', label: $t['nav.short.kiez'],        match: ['/schillerkiez'] }
-  ]);
+    { href: '/forum',        label: $t['nav.short.forum'],       match: FORUM_MATCH,       section: 'forum' },
+    { href: '/calendar',     label: $t['nav.short.calendar'],    match: CALENDAR_MATCH,    section: 'kalender' },
+    { href: '/newsboard',    label: $t['nav.short.news'],        match: ['/newsboard'],    section: null },
+    { href: '/marketplace',  label: $t['nav.short.marketplace'], match: ['/marketplace'],  section: 'markt' },
+    { href: '/schillerkiez', label: $t['nav.short.kiez'],        match: ['/schillerkiez'], section: null }
+  ] as { href: string; label: string; match: string[]; section: VisitSection | null }[]);
+
+  function hasDot(item: { match: string[]; section: VisitSection | null }): boolean {
+    return item.section !== null && news[item.section] && !isActive(item.match);
+  }
 
   function isActive(matches: string[]): boolean {
     return matches.some((m) => currentPath === m || (m !== '/' && currentPath.startsWith(m + '/')));
@@ -290,7 +306,7 @@
           }"
           aria-current={isActive(item.match) ? 'page' : undefined}
         >
-          {item.label}
+          {item.label}{#if hasDot(item)}<span data-nav-dot class="inline-block w-[7px] h-[7px] ml-1.5 rounded-full bg-[color:var(--k-bar-fg)] align-middle" aria-hidden="true"></span><span class="sr-only">{$t['nav.newDot']}</span>{/if}
         </a>
       {/each}
     </nav>
@@ -358,7 +374,7 @@
             ></span>
           </a>
           {#if menuOpen}
-            <AvatarMenu {user} onClose={closeMenu} />
+            <AvatarMenu {user} onClose={closeMenu} blogNew={news.blog && !isActive(['/blog'])} />
           {/if}
         </div>
       {:else}
@@ -398,7 +414,7 @@
         }"
         aria-current={isActive(item.match) ? 'page' : undefined}
       >
-        {item.label}
+        {item.label}{#if hasDot(item)}<span data-nav-dot class="inline-block w-[6px] h-[6px] ml-1 rounded-full bg-[color:var(--k-bar-fg)] align-middle" aria-hidden="true"></span><span class="sr-only">{$t['nav.newDot']}</span>{/if}
       </a>
     {/each}
   </div>
```

The dot is an INLINE 7 px (desktop) / 6 px (phone) disc in the bar's text colour — no absolute positioning, so it reads on every bar tint. The open section's tab never shows one (`hasDot()` tests `!isActive`).

- [ ] **Step 2: AvatarMenu — the Beilage row carries the blog dot (phones have no Blog tab)**

```diff
diff --git a/src/components/forum/kiosk/AvatarMenu.svelte b/src/components/forum/kiosk/AvatarMenu.svelte
index 7a017594..010a0168 100644
--- a/src/components/forum/kiosk/AvatarMenu.svelte
+++ b/src/components/forum/kiosk/AvatarMenu.svelte
@@ -13,10 +13,12 @@
   // (AdmAvatar in the admin masthead). Admin context adds a „Bereiche" group
   // so the admin can jump to any member surface from the back-office, and
   // drops the „Admin-Bereich" row (you're already there).
-  let { user, onClose, context = 'app' } = $props<{
+  let { user, onClose, context = 'app', blogNew = false } = $props<{
     user: { name?: string | null; role?: string };
     onClose: (restoreFocus: boolean) => void;
     context?: 'app' | 'admin';
+    /** phones have no Blog tab — the menu row carries the „new" dot there */
+    blogNew?: boolean;
   }>();
 
   const isAdmin = $derived(user?.role === 'admin');
@@ -140,7 +142,7 @@
       <a role="menuitem" href="/entwuerfe" class="am-row font-bricolage">{$t['nav.menu.entwuerfe']}</a>
       <a role="menuitem" href="/profile?filter=gespeichert" class="am-row font-bricolage">{$t['nav.menu.gespeichert']}<span class="am-icon font-dmmono">◈</span></a>
       <button role="menuitem" class="am-row font-bricolage" onclick={() => { close(); (window as any).__mahalleTourStart?.(); }}>{$t['nav.menu.tour']}<span class="am-icon font-dmmono">◎</span></button>
-      <a role="menuitem" href="/blog" class="am-row font-bricolage">{$t['nav.menu.beilage']}<span class="am-icon font-dmmono">❡</span></a>
+      <a role="menuitem" href="/blog" class="am-row font-bricolage">{$t['nav.menu.beilage']}{#if blogNew}<span data-nav-dot class="inline-block w-[7px] h-[7px] ml-2 rounded-full bg-ink align-middle" aria-hidden="true"></span><span class="sr-only">{$t['nav.newDot']}</span>{/if}<span class="am-icon font-dmmono">❡</span></a>
     </div>
     {#if isAdmin && context !== 'admin'}
       <div class="am-group am-admin">
```

- [ ] **Step 3: Account deletion unsets the stamps**

```diff
diff --git a/src/lib/auth/accountDeletion.ts b/src/lib/auth/accountDeletion.ts
index c990a631..d3497417 100644
--- a/src/lib/auth/accountDeletion.ts
+++ b/src/lib/auth/accountDeletion.ts
@@ -446,6 +446,7 @@ export async function runDeletionPipeline(
           deletionScheduledAt: '',
           tours: '',
           tourHelloDismissedAt: '',
+          lastVisit: '',
           deletionClaimedAt: '',
         },
       }
```

(Plan 2 adds its own `forumNotify: ''` line right under it.)

- [ ] **Step 4: A published draft listing becomes public NOW**

```diff
diff --git a/src/pages/api/listings/draft/[id]/publish.ts b/src/pages/api/listings/draft/[id]/publish.ts
index 5ad574f9..2e5648fd 100644
--- a/src/pages/api/listings/draft/[id]/publish.ts
+++ b/src/pages/api/listings/draft/[id]/publish.ts
@@ -104,6 +104,10 @@ export const POST: APIRoute = async ({ request, params }) => {
         $set: {
           status: 'available',
           moderationStatus,
+          // The listing becomes public NOW: the 21-day freshness clock and „new since
+          // your last visit" both read createdAt — a draft kept for weeks must not
+          // arrive already stale.
+          createdAt: new Date(),
           updatedAt: new Date()
         }
       }
```

- [ ] **Step 5: Budgets + tests**

Run: `pnpm type-check 2>&1 | grep -c "error TS"` → `16`; `npx -y svelte-check@4 2>&1 | tail -1` → `81 ERRORS`; `pnpm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → all pass (317 with Tasks 1–2).

- [ ] **Step 6: Commit**

```bash
git add src/components/forum/kiosk/KioskNav.svelte src/components/forum/kiosk/AvatarMenu.svelte src/lib/auth/accountDeletion.ts "src/pages/api/listings/draft/[id]/publish.ts"
git commit -m "feat: new-since-last-visit dots on the nav tabs; published drafts count as new"
```

---

### Task 5: Browser gate on the local production build + docs

**Files:**
- Probe (gitignored, already on disk in the main checkout): `scratchpad/plan-unread/probe.cjs`, helper `scratchpad/plan-unread/stamp.mjs` (dev-DB only, refuses any db name without „dev").
- Modify: `CLAUDE.md` (root), `src/components/forum/kiosk/CLAUDE.md`

- [ ] **Step 1: Build and serve the production bundle**

```bash
npx astro build --config scratchpad/astro.config.preview.mjs
PORT=4655 HOST=127.0.0.1 node --env-file=.env dist/server/entry.mjs   # in the background
```

- [ ] **Step 2: Age the test member's stamps, run the probe**

```bash
node --env-file=.env scratchpad/plan-unread/stamp.mjs ayse@mahalle-dev.test 400
NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/plan-unread/probe.cjs http://127.0.0.1:4655
```
Expected: `ALL PASS` (13 checks: four desktop dots on `/newsboard`, no dot on the open section, forum chips > 0 and none on Ayşe's own card, a reload keeps the chips, the forum dot gone after the visit, market + blog chips > 0, no dot left after all four visits, phone bottom-tab dots, no sideways scroll, the account menu marks the Beilage row). The probe logs in with `?redirect=/newsboard` on purpose — landing on `/forum` would already be a visit.

- [ ] **Step 3: Stop the server** (its own call): `fuser -k 4655/tcp`

- [ ] **Step 4: Docs**

Root `CLAUDE.md`, „Database Collections" → `users`: add „plus `lastVisit?: { forum?, kalender?, markt?, blog?: Date }` — last opening of each section's index page (`POST /api/profile/visit`), drives the „new since your last visit" tab dots (`GET /api/profile/section-news`) and the „neu" chips; absent = nothing new; unset by the deletion tombstone." In `src/components/forum/kiosk/CLAUDE.md` add a section „New since your last visit" (stamp semantics, 30-minute visit session in `sessionStorage` key `mahalle:visit:<section>`, the iframe guard, the inline dot, NewMark has no `<style>` on purpose, no chip on the market lead / month grid, the approval gap from the spec).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md src/components/forum/kiosk/CLAUDE.md
git commit -m "docs: new-since-last-visit dots and chips"
```
