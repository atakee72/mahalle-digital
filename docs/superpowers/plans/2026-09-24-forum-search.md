# Forum Search (server-side) + Masthead Magnifier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the orphaned `/search` page find every visible forum post (Diskussion, Empfehlung, Ankündigung) and comment through a server query, and give it an entry point: a magnifier disc in the masthead that opens a search strip under the bar.

**Architecture:** A pure helper module (`searchQuery.ts`: query normalisation, regex escaping, Mongo filter, excerpts) tested with `node:test`; a server module (`searchStore.ts`) that runs the three post collections + comments in parallel under the caller's moderation filter and returns slim result rows (excerpt, not full body; parent title for comments); a gated `GET /api/search?q=` route with a per-member rate limit; the existing `SearchPage.svelte` rewired to fetch from that route (debounced) with SSR of the first query; a new `MastSearch.svelte` disc + strip inside `KioskNav`'s sticky header so hide-on-scroll and `--k-mast-offset` keep working.

**Tech Stack:** Astro 5 SSR (Vercel, fra1), Svelte 5 runes, MongoDB driver (no Mongoose), `node:test` via `npx tsx --test`, Playwright (global CLI bundle) for probes on the dev server :4655.

**Spec:** No separate spec file. The decisions come from the conversation of 2026-09-24 (user: „forum only, server-side, strip under the bar, ship now") and the prod check that preceded it (recorded in `.remember/today-2026-09-24.md`). The header of this plan is the spec.

## Global Constraints

- **Forum only.** Search covers `topics`, `announcements`, `recommendations` and `comments`. Not events, listings, news, blog.
- **Visibility = the forum's own rule.** Every post query goes through `buildModerationFilter(userId)` (`src/lib/topicsQuery.ts:26`): approved / absent / pending-and-reported, plus the caller's own pending+rejected. Comments: `approved` or absent, AND their parent post must pass the same filter (a comment on a rejected post must not surface).
- **Authors only through the allowlist**: `populateAuthors()` (`src/lib/topicsQuery.ts:68`, uses `PUBLIC_AUTHOR_PROJECTION`). Never `{ password: 0 }`, never raw user docs. Comments ship NO author (design: the comment card has no author line).
- **Query rules**: trimmed, 2–80 characters, otherwise 400 / no request. Regex-escaped before `$regex`, flag `i`. Bodies never leave the server whole: an excerpt of ≤ 160 characters around the first match.
- **Caps**: 20 hits per post kind (newest first), merged and cut to 30 posts; 20 comments. `Cache-Control: no-store`.
- **Gate**: `/api/search` is added to `GATED_APIS` in `src/middleware.ts:70` AND the route checks the session itself (401 `{ error: 'Unauthorized' }`), like every route in the repo.
- **Rate limit**: `consumeRateLimit(\`search:${userId}\`, 300, 60 * 60 * 1000)` → 429 `{ error: 'rate_limited' }`.
- **History**: `history.replaceState(history.state, '', url)` — never `{}` (root CLAUDE.md, „Astro Script + ViewTransitions"). `SearchPage.svelte:64` is a known offender and gets fixed here.
- **Masthead rules** (root CLAUDE.md „Masthead + bottom nav", area CLAUDE.md „frames and bevelled edges"): the new disc is a sibling of the bell disc — 36 px, `--k-paper-warm` fill, `2px solid var(--k-bar-pill-border, var(--k-ink))` frame, the inset bevel `inset -1px 0 1.5px rgb(27 26 23 / .55), inset 1px 0 1.5px rgb(245 239 224 / .8)`, 44 px hit area. The header moves by `top`, never `transform`. The strip lives INSIDE `<header>` so the `ResizeObserver` re-measures `mastH`.
- **Styles of a nested island go in `global.css`** (root CLAUDE.md „Nested-island Svelte `<style>` blocks get orphaned"): `MastSearch.svelte` gets a `.ms-*` block in `src/styles/global.css`, no `<style>` in the component.
- **Copy**: new i18n keys in `src/lib/kiosk-i18n.ts`, DE and EN. The user words UI copy himself; the strings below are drafts he may change before push.
- **Commits**: one line, no footer, only named files staged (gitleaks pre-commit). Push only on the user's word. Stand freeze Fri 25 Sept evening → Sat 16:30: everything ships before Friday evening or waits until Sunday.
- **Gates before push**: `pnpm type-check` ≤ 23 errors, `npx -y svelte-check@4` ≤ 89, `pnpm build` green; the new `node:test` file passes; dev probes 4 and 5 green.

## Review Focus

1. **A query that is only whitespace or 1 character** (`"  "`, `"a"`): no request from the island, 400 from the route, the page shows the idle state, never „0 Treffer". Pinned in Task 1 (`normalizeQuery`) and Task 3 (route 400).
2. **Regex metacharacters in the query** (`"c++"`, `"(", "[a-z]"`, `".*"`): must search literally, never throw, never match everything. Pinned in Task 1 (`escapeRegex`, `buildSearchFilter`) and Task 3 (route returns 200 with 0 hits for `"("`).
3. **A comment whose parent is not visible** (parent rejected, or parent deleted → orphan): the comment must not appear. Pinned in Task 2's probe (dev DB fixture).
4. **The caller's own pending post**: visible to its author, invisible to another member — same as the feed. Pinned in Task 3's probe (two accounts).
5. **Escape / outside click / navigation while the strip is open**: strip closes, focus returns to the disc, the bar is not left in a hidden-while-focused state; on `/search` itself the disc leads to the page's own box instead of opening a second input. Pinned in Task 5's Playwright probe.

---

### Task 1: Pure search helpers (`searchQuery.ts`) — TDD

**Files:**
- Create: `src/lib/forum/searchQuery.ts`
- Test: `src/lib/forum/searchQuery.test.ts`

**Interfaces:**
- Produces:
  - `SEARCH_MIN_LEN = 2`, `SEARCH_MAX_LEN = 80`, `EXCERPT_LEN = 160`
  - `normalizeQuery(raw: unknown): string | null` — trims, collapses inner whitespace to one space, returns `null` when not a string, shorter than 2 or longer than 80 characters.
  - `escapeRegex(s: string): string`
  - `buildSearchRegex(q: string): RegExp` — `new RegExp(escapeRegex(q), 'i')`
  - `buildPostSearchFilter(q: string): Record<string, unknown>` — `{ $or: [{ title: rx }, { body: rx }, { tags: rx }] }` where `rx` is the RegExp from `buildSearchRegex`
  - `excerptAround(text: unknown, q: string, len = EXCERPT_LEN): string` — plain string around the first case-insensitive match, `…` on cut sides, whitespace collapsed; when no match: the first `len` characters; non-strings → `''`.
  - `type PostKind = 'discussion' | 'announcement' | 'recommendation'`
  - The result row types (pure, so the island can import them without touching the driver module): `SearchPost`, `SearchComment`, `SearchResult` — shapes as listed under Task 2's Interfaces.
  - `KIND_BY_COLLECTION: Record<'topics' | 'announcements' | 'recommendations', PostKind>` and `PATH_BY_KIND: Record<PostKind, '/topics' | '/announcements' | '/recommendations'>`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/forum/searchQuery.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeQuery, escapeRegex, buildSearchRegex, buildPostSearchFilter,
  excerptAround, KIND_BY_COLLECTION, PATH_BY_KIND, SEARCH_MAX_LEN,
} from './searchQuery';

test('normalizeQuery: trims, collapses whitespace, enforces 2–80', () => {
  assert.equal(normalizeQuery('  Schiller   markt '), 'Schiller markt');
  assert.equal(normalizeQuery('a'), null);
  assert.equal(normalizeQuery('   '), null);
  assert.equal(normalizeQuery(''), null);
  assert.equal(normalizeQuery(undefined), null);
  assert.equal(normalizeQuery(42), null);
  assert.equal(normalizeQuery('x'.repeat(SEARCH_MAX_LEN)), 'x'.repeat(SEARCH_MAX_LEN));
  assert.equal(normalizeQuery('x'.repeat(SEARCH_MAX_LEN + 1)), null);
  assert.equal(normalizeQuery('ab'), 'ab');
});

test('escapeRegex: metacharacters search literally', () => {
  assert.equal(escapeRegex('c++'), 'c\\+\\+');
  assert.equal(escapeRegex('(a) [b] {c} .*?^$|\\/'), '\\(a\\) \\[b\\] \\{c\\} \\.\\*\\?\\^\\$\\|\\\\\\/');
  assert.equal(buildSearchRegex('c++').test('I love C++ and Rust'), true);
  assert.equal(buildSearchRegex('.*').test('anything'), false);
  assert.equal(buildSearchRegex('.*').test('a .* b'), true);
  assert.doesNotThrow(() => buildSearchRegex('('));
});

test('buildPostSearchFilter: title, body, tags, case-insensitive', () => {
  const f = buildPostSearchFilter('Fahrrad') as { $or: Array<Record<string, RegExp>> };
  assert.equal(f.$or.length, 3);
  assert.deepEqual(f.$or.map((c) => Object.keys(c)[0]), ['title', 'body', 'tags']);
  for (const c of f.$or) {
    const rx = Object.values(c)[0];
    assert.ok(rx instanceof RegExp);
    assert.equal(rx.flags, 'i');
    assert.equal(rx.test('mein FAHRRAD ist weg'), true);
  }
});

test('excerptAround: window around the first match, ellipses, whitespace collapsed', () => {
  const body = 'A'.repeat(300) + ' Schillermarkt am Herrfurthplatz ' + 'B'.repeat(300);
  const ex = excerptAround(body, 'schillermarkt', 60);
  assert.ok(ex.length <= 60 + 2, ex);
  assert.ok(/Schillermarkt/.test(ex));
  assert.ok(ex.startsWith('…') && ex.endsWith('…'));
  assert.equal(excerptAround('kurz und gut', 'gut', 160), 'kurz und gut');
  assert.equal(excerptAround('line one\n\n   line two', 'two', 160), 'line one line two');
  assert.equal(excerptAround('no match here at all', 'zzz', 8), 'no matc…'); // len-1 chars + ellipsis
  assert.equal(excerptAround(null, 'x'), '');
  assert.equal(excerptAround(12, 'x'), '');
});

test('kind and path maps agree with the detail routes', () => {
  assert.equal(KIND_BY_COLLECTION.topics, 'discussion');
  assert.equal(KIND_BY_COLLECTION.announcements, 'announcement');
  assert.equal(KIND_BY_COLLECTION.recommendations, 'recommendation');
  assert.equal(PATH_BY_KIND.discussion, '/topics');
  assert.equal(PATH_BY_KIND.announcement, '/announcements');
  assert.equal(PATH_BY_KIND.recommendation, '/recommendations');
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `npx tsx --test src/lib/forum/searchQuery.test.ts`
Expected: FAIL — `Cannot find module './searchQuery'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/forum/searchQuery.ts
// Pure helpers for the forum search (dependency-free: imported by the
// server store AND the search island). Rules: trimmed query of 2–80
// characters, regex-escaped before it reaches Mongo, bodies never leave
// the server whole — an excerpt around the first match does.

export const SEARCH_MIN_LEN = 2;
export const SEARCH_MAX_LEN = 80;
export const EXCERPT_LEN = 160;

export type PostKind = 'discussion' | 'announcement' | 'recommendation';
export type PostCollection = 'topics' | 'announcements' | 'recommendations';

export const KIND_BY_COLLECTION: Record<PostCollection, PostKind> = {
  topics: 'discussion',
  announcements: 'announcement',
  recommendations: 'recommendation',
};

export const PATH_BY_KIND: Record<PostKind, '/topics' | '/announcements' | '/recommendations'> = {
  discussion: '/topics',
  announcement: '/announcements',
  recommendation: '/recommendations',
};

export interface SearchPost {
  _id: string; kind: PostKind; href: string; title: string; excerpt: string;
  tags: string[]; date: string | null;
  author: { name: string | null; handle: string | null } | null;
}
export interface SearchComment {
  _id: string; href: string; excerpt: string; date: string | null; parentTitle: string;
}
export interface SearchResult { q: string; posts: SearchPost[]; comments: SearchComment[] }

export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const q = raw.replace(/\s+/g, ' ').trim();
  if (q.length < SEARCH_MIN_LEN || q.length > SEARCH_MAX_LEN) return null;
  return q;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

export function buildSearchRegex(q: string): RegExp {
  return new RegExp(escapeRegex(q), 'i');
}

export function buildPostSearchFilter(q: string): Record<string, unknown> {
  const rx = buildSearchRegex(q);
  return { $or: [{ title: rx }, { body: rx }, { tags: rx }] };
}

export function excerptAround(text: unknown, q: string, len = EXCERPT_LEN): string {
  if (typeof text !== 'string' || !text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= len) return flat;
  const idx = q ? flat.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (idx === -1) return flat.slice(0, len - 1).trimEnd() + '…';
  const half = Math.floor((len - q.length) / 2);
  let start = Math.max(0, idx - half);
  let end = Math.min(flat.length, start + len);
  if (end - start < len) start = Math.max(0, end - len);
  let out = flat.slice(start, end).trim();
  if (start > 0) out = '…' + out;
  if (end < flat.length) out = out + '…';
  return out;
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx tsx --test src/lib/forum/searchQuery.test.ts`
Expected: 5 passing. If `excerptAround` length assertions fail by one or two characters because of the ellipses, adjust the slice math, not the test (the test allows `len + 2`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/forum/searchQuery.ts src/lib/forum/searchQuery.test.ts
git commit -m "forum search: pure query helpers (normalise, escape, filter, excerpt) with tests"
```

---

### Task 2: Server store `searchForum()` + dev-DB probe

**Files:**
- Create: `src/lib/forum/searchStore.ts`
- Create: `scratchpad/search-store-probe.mts` (dev DB only, refuses any db name without `dev`)

**Interfaces:**
- Consumes: Task 1 helpers; `buildModerationFilter`, `mergeModerationFilter`, `populateAuthors` from `src/lib/topicsQuery.ts`; `connectDB` from `src/lib/mongodb.ts`.
- Produces:
  ```ts
  export interface SearchPost {
    _id: string; kind: PostKind; href: string; title: string; excerpt: string;
    tags: string[]; date: string | null;                 // ISO
    author: { name: string | null; handle: string | null } | null;
  }
  export interface SearchComment {
    _id: string; href: string;                            // `${parentHref}#comment-${_id}`
    excerpt: string; date: string | null; parentTitle: string;
  }
  export interface SearchResult { q: string; posts: SearchPost[]; comments: SearchComment[] }
  export async function searchForum(db: Db, q: string, userId?: string): Promise<SearchResult>
  ```
  `q` is already normalised by the caller (route / page); `searchForum` trusts it.

- [ ] **Step 1: Implement the store**

```ts
// src/lib/forum/searchStore.ts
// SERVER-ONLY (imports the driver). Runs the three post collections and the
// comments in parallel under the caller's moderation filter and returns
// slim rows: excerpt instead of body, allowlisted author, comment parent
// title. Regex search is fine at today's size (hundreds of posts); a text
// index is the next step when it isn't.
import type { Db, Document } from 'mongodb';
import { ObjectId } from 'mongodb';
import { buildModerationFilter, mergeModerationFilter, populateAuthors } from '../topicsQuery';
import {
  buildPostSearchFilter, buildSearchRegex, excerptAround,
  KIND_BY_COLLECTION, PATH_BY_KIND, type PostCollection, type PostKind,
  type SearchPost, type SearchComment, type SearchResult,
} from './searchQuery';
export type { SearchPost, SearchComment, SearchResult };

export const SEARCH_PER_KIND = 20;
export const SEARCH_POSTS_MAX = 30;
export const SEARCH_COMMENTS_MAX = 20;

const COLLECTIONS: PostCollection[] = ['topics', 'announcements', 'recommendations'];

function toIso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' || typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

async function searchPosts(db: Db, q: string, userId?: string): Promise<SearchPost[]> {
  const perKind = await Promise.all(
    COLLECTIONS.map(async (name) => {
      const filter = buildPostSearchFilter(q) as Record<string, any>;
      mergeModerationFilter(filter, buildModerationFilter(userId));
      const docs = await db
        .collection(name)
        .find(filter)
        .sort({ date: -1 })
        .limit(SEARCH_PER_KIND)
        .project({ title: 1, body: 1, tags: 1, author: 1, date: 1, createdAt: 1 })
        .toArray();
      return docs.map((d) => ({ ...d, __kind: KIND_BY_COLLECTION[name] }));
    })
  );
  const merged = (perKind.flat() as Document[])
    .sort((a, b) => (toIso(b.date ?? b.createdAt) ?? '').localeCompare(toIso(a.date ?? a.createdAt) ?? ''))
    .slice(0, SEARCH_POSTS_MAX);
  const populated = await populateAuthors(merged as any[]);
  return populated.map((d: any) => ({
    _id: String(d._id),
    kind: d.__kind as PostKind,
    href: `${PATH_BY_KIND[d.__kind as PostKind]}/${String(d._id)}`,
    title: typeof d.title === 'string' ? d.title : '',
    excerpt: excerptAround(d.body, q),
    tags: Array.isArray(d.tags) ? d.tags.filter((t: unknown) => typeof t === 'string') : [],
    date: toIso(d.date ?? d.createdAt),
    author: d.author && typeof d.author === 'object'
      ? { name: typeof d.author.name === 'string' ? d.author.name : null, handle: typeof d.author.handle === 'string' ? d.author.handle : null }
      : null,
  }));
}

async function searchComments(db: Db, q: string, userId?: string): Promise<SearchComment[]> {
  const rx = buildSearchRegex(q);
  const comments = await db
    .collection('comments')
    .find({
      body: rx,
      $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }],
    })
    .sort({ date: -1 })
    .limit(SEARCH_COMMENTS_MAX * 2) // headroom: some parents will be filtered out below
    .project({ body: 1, relevantPostId: 1, date: 1, createdAt: 1 })
    .toArray();
  if (comments.length === 0) return [];

  const parentIds = [...new Set(comments.map((c) => String(c.relevantPostId)).filter((id) => ObjectId.isValid(id)))]
    .map((id) => new ObjectId(id));
  // Parent must be visible to the caller — same rule as the feed. A comment
  // on a rejected or deleted post never surfaces.
  const parents = await Promise.all(
    COLLECTIONS.map(async (name) => {
      const filter: Record<string, any> = { _id: { $in: parentIds } };
      mergeModerationFilter(filter, buildModerationFilter(userId));
      const docs = await db.collection(name).find(filter).project({ title: 1 }).toArray();
      return docs.map((d) => [String(d._id), { title: String(d.title ?? ''), kind: KIND_BY_COLLECTION[name] }] as const);
    })
  );
  const parentMap = new Map(parents.flat());

  const out: SearchComment[] = [];
  for (const c of comments) {
    const p = parentMap.get(String(c.relevantPostId));
    if (!p) continue;
    out.push({
      _id: String(c._id),
      href: `${PATH_BY_KIND[p.kind]}/${String(c.relevantPostId)}#comment-${String(c._id)}`,
      excerpt: excerptAround(c.body, q),
      date: toIso(c.date ?? c.createdAt),
      parentTitle: p.title,
    });
    if (out.length >= SEARCH_COMMENTS_MAX) break;
  }
  return out;
}

export async function searchForum(db: Db, q: string, userId?: string): Promise<SearchResult> {
  const [posts, comments] = await Promise.all([searchPosts(db, q, userId), searchComments(db, q, userId)]);
  return { q, posts, comments };
}
```

`populateAuthors` (`topicsQuery.ts:68–134`) replaces the string id on `doc.author` with the user doc projected through `PUBLIC_AUTHOR_PROJECTION` (`name`, `image`, `userPicture`, `createdAt`, `verified`, `role`, `handle`, `_id`), or `null` when the user is gone. The mapping above reads `name` and `handle` from that and ships nothing else.

- [ ] **Step 2: Write the dev-DB probe** (read-only apart from two fixture docs it inserts and removes itself; refuses a non-dev database)

```ts
// scratchpad/search-store-probe.mts — run: npx tsx scratchpad/search-store-probe.mts
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import { searchForum } from '../src/lib/forum/searchStore';

const uri = process.env.MONGODB_URI!;
const client = await MongoClient.connect(uri);
const db = client.db();
if (!/dev/i.test(db.databaseName)) { console.error('refusing non-dev db'); process.exit(2); }

const tag = `probe-${Date.now()}`;
const author = String((await db.collection('users').findOne({}, { projection: { _id: 1 } }))!._id);
const okPost = await db.collection('announcements').insertOne({ title: `Alpha ${tag}`, body: `Der Schillermarkt ${tag} findet statt`, tags: ['probe'], author, date: Date.now(), createdAt: new Date(), moderationStatus: 'approved' });
const badPost = await db.collection('topics').insertOne({ title: `Beta ${tag}`, body: `versteckt ${tag}`, tags: [], author, date: Date.now(), createdAt: new Date(), moderationStatus: 'rejected' });
const okComment = await db.collection('comments').insertOne({ body: `Kommentar sichtbar ${tag}`, author, relevantPostId: okPost.insertedId, date: Date.now(), createdAt: new Date(), moderationStatus: 'approved' });
const badComment = await db.collection('comments').insertOne({ body: `Kommentar verwaist ${tag}`, author, relevantPostId: badPost.insertedId, date: Date.now(), createdAt: new Date(), moderationStatus: 'approved' });
const orphan = await db.collection('comments').insertOne({ body: `Kommentar ohne Eltern ${tag}`, author, relevantPostId: new ObjectId(), date: Date.now(), createdAt: new Date() });

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };
try {
  const r = await searchForum(db, tag, 'someone-else');
  check('announcement found by body', r.posts.some((p) => p._id === String(okPost.insertedId) && p.kind === 'announcement' && p.href === `/announcements/${okPost.insertedId}`));
  check('rejected post hidden from others', !r.posts.some((p) => p._id === String(badPost.insertedId)));
  check('excerpt contains the match, not the whole body', r.posts.every((p) => p.excerpt.length <= 162 && !('body' in p)));
  check('author allowlisted (name/handle only)', r.posts.every((p) => p.author === null || Object.keys(p.author).sort().join(',') === 'handle,name'));
  check('visible comment found with parent title + anchor', r.comments.some((c) => c._id === String(okComment.insertedId) && c.parentTitle.startsWith('Alpha') && c.href === `/announcements/${okPost.insertedId}#comment-${okComment.insertedId}`));
  check('comment on rejected post hidden', !r.comments.some((c) => c._id === String(badComment.insertedId)));
  check('orphan comment hidden', !r.comments.some((c) => c._id === String(orphan.insertedId)));
  const own = await searchForum(db, tag, author);
  check('own rejected post visible to its author', own.posts.some((p) => p._id === String(badPost.insertedId)));
  const meta = await searchForum(db, '(', 'someone-else');
  check('metacharacter query does not throw', Array.isArray(meta.posts));
} finally {
  await db.collection('announcements').deleteOne({ _id: okPost.insertedId });
  await db.collection('topics').deleteOne({ _id: badPost.insertedId });
  await db.collection('comments').deleteMany({ _id: { $in: [okComment.insertedId, badComment.insertedId, orphan.insertedId] } });
  await client.close();
}
console.log(fails ? `${fails} FAILED` : 'all green');
process.exit(fails ? 1 : 0);
```

- [ ] **Step 3: Run the probe**

Run: `npx tsx scratchpad/search-store-probe.mts`
Expected: 9 × PASS, `all green`. If `populateAuthors` needs `connectDB()` env (it does — it opens its own connection), the probe's `dotenv/config` import covers it. If „own rejected post visible" fails, check that the fixture's `author` is the STRING id (the feed stores author as a string id — `comments/create.ts:72`).

- [ ] **Step 4: Type-check**

Run: `pnpm type-check 2>&1 | grep -c "error TS"`
Expected: ≤ 23 (the baseline; the new file must add none — `grep searchStore` in the output must be empty).

- [ ] **Step 5: Commit**

```bash
git add src/lib/forum/searchStore.ts scratchpad/search-store-probe.mts
git commit -m "forum search: server store over three post kinds + comments under the caller's moderation filter"
```

---

### Task 3: `GET /api/search` + middleware gate + API probe

**Files:**
- Create: `src/pages/api/search.ts`
- Modify: `src/middleware.ts:70-74` (add `'/api/search'` to `GATED_APIS`)
- Create: `scratchpad/search-api-probe.mjs` (dev server :4655, two accounts)

**Interfaces:**
- Consumes: `searchForum` (Task 2), `normalizeQuery` (Task 1), `getSession` from `auth-astro/server`, `connectDB`, `consumeRateLimit` (`src/lib/auth/rateLimit.ts:62`, signature `(baseKey, max, windowMs) → Promise<RateLimitResult>`; `RateLimitResult = { limited: boolean; retryAfterSec: number }`, line 31).
- Produces: `GET /api/search?q=<text>` → 200 `SearchResult` JSON; 400 `{ error: 'query_invalid' }`; 401 `{ error: 'Unauthorized' }`; 429 `{ error: 'rate_limited' }`. Header `Cache-Control: no-store`.

- [ ] **Step 1: Add the gate**

In `src/middleware.ts` the `GATED_APIS` array (line 70) becomes:

```ts
    const GATED_APIS = [
      '/api/topics', '/api/announcements', '/api/recommendations',
      '/api/events', '/api/news', '/api/comments', '/api/listings',
      '/api/users', // profiles batch-read: only consumer is the gated calendar modal
      '/api/search', // forum search: members only, like the feed it reads
    ];
```

- [ ] **Step 2: Write the route**

```ts
// src/pages/api/search.ts
import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../lib/mongodb';
import { consumeRateLimit } from '../../lib/auth/rateLimit';
import { normalizeQuery } from '../../lib/forum/searchQuery';
import { searchForum } from '../../lib/forum/searchStore';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// Forum search. Members only (middleware gates the prefix too). 300 queries
// per member and hour — the island debounces, a person cannot reach that.
export const GET: APIRoute = async ({ request, url }) => {
  const session = await getSession(request);
  const userId = session?.user?.id;
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const q = normalizeQuery(url.searchParams.get('q'));
  if (!q) return json({ error: 'query_invalid' }, 400);

  const rl = await consumeRateLimit(`search:${userId}`, 300, 60 * 60 * 1000);
  if (rl.limited) return json({ error: 'rate_limited' }, 429);

  const db = await connectDB();
  return json(await searchForum(db, q, userId));
};
```

- [ ] **Step 3: Write the API probe** (dev server on :4655; two accounts from the seeded dev DB — the seed writes credentials to `scratchpad/devpw.txt` for the first account; for the second account use `PROBE2_EMAIL` + `PROBE2_PW_FILE` env, both read with `fs.readFileSync`, never printed)

```js
// scratchpad/search-api-probe.mjs — run: node scratchpad/search-api-probe.mjs (dev :4655 running)
import fs from 'node:fs';
const BASE = 'http://localhost:4655';
const login = async (email, pwFile) => {
  const c = {}; const store = (r) => { for (const s of r.headers.getSetCookie()) { const [pair] = s.split(';'); const i = pair.indexOf('='); c[pair.slice(0, i)] = pair.slice(i + 1); } };
  const H = () => ({ cookie: Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ') });
  const cs = await fetch(`${BASE}/api/auth/csrf`); store(cs); const { csrfToken } = await cs.json();
  const lr = await fetch(`${BASE}/api/auth/callback/credentials`, { method: 'POST', redirect: 'manual', headers: { ...H(), 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE }, body: new URLSearchParams({ csrfToken, email, password: fs.readFileSync(pwFile, 'utf8').trim() }) });
  store(lr);
  const s = await (await fetch(`${BASE}/api/auth/session`, { headers: H() })).json();
  if (!s?.user?.id) throw new Error('login failed for ' + email);
  return { H, id: s.user.id };
};
let fails = 0; const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${x}`); if (!ok) fails++; };

const anon = await fetch(`${BASE}/api/search?q=test`);
check('logged out → 401', anon.status === 401);

const a = await login(process.env.PROBE_EMAIL, 'scratchpad/devpw.txt');
check('1 char → 400', (await fetch(`${BASE}/api/search?q=a`, { headers: a.H() })).status === 400);
check('whitespace → 400', (await fetch(`${BASE}/api/search?q=%20%20`, { headers: a.H() })).status === 400);
check('81 chars → 400', (await fetch(`${BASE}/api/search?q=${'x'.repeat(81)}`, { headers: a.H() })).status === 400);
const meta = await fetch(`${BASE}/api/search?q=${encodeURIComponent('(')}`, { headers: a.H() });
check('"(" → 200 and no throw', meta.status === 200, String((await meta.json()).posts.length));
const r = await fetch(`${BASE}/api/search?q=der`, { headers: a.H() });
const body = await r.json();
check('common word → 200 with hits', r.status === 200 && body.posts.length > 0, `${body.posts.length} posts, ${body.comments.length} comments`);
check('no-store', r.headers.get('cache-control') === 'no-store');
check('rows are slim: no body, author allowlisted', body.posts.every((p) => !('body' in p) && (p.author === null || Object.keys(p.author).sort().join(',') === 'handle,name')));
check('every post kind has a matching href', body.posts.every((p) => p.href.startsWith({ discussion: '/topics/', announcement: '/announcements/', recommendation: '/recommendations/' }[p.kind])));
check('comments carry parent title + anchor', body.comments.every((c) => c.parentTitle && /#comment-[0-9a-f]{24}$/.test(c.href)));

// Own pending post visible to its author only: create one as A (goes through moderation → may land pending or approved);
// if it lands approved this check is skipped honestly.
const mk = await fetch(`${BASE}/api/topics/create`, { method: 'POST', headers: { ...a.H(), 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `Probe Suche ${Date.now()} zqxv`, body: 'Ein Testbeitrag für die Suche zqxv, bitte ignorieren.', tags: ['probe'] }) });
const made = await mk.json().catch(() => ({}));
if (mk.ok && made?.moderationStatus === 'pending') {
  const mine = await (await fetch(`${BASE}/api/search?q=zqxv`, { headers: a.H() })).json();
  check('own pending post visible to author', mine.posts.some((p) => p.title.includes('zqxv')));
  if (process.env.PROBE2_EMAIL) {
    const b = await login(process.env.PROBE2_EMAIL, process.env.PROBE2_PW_FILE);
    const theirs = await (await fetch(`${BASE}/api/search?q=zqxv`, { headers: b.H() })).json();
    check('pending post invisible to another member', !theirs.posts.some((p) => p.title.includes('zqxv')));
  } else console.log('SKIP second-account check (PROBE2_EMAIL unset)');
} else console.log('SKIP own-pending check (create status', mk.status, 'moderation', made?.moderationStatus, ')');
console.log(fails ? `${fails} FAILED` : 'all green'); process.exit(fails ? 1 : 0);
```

Note for the implementer: read `src/pages/api/topics/create.ts` once for the exact request body field names and the response shape before running; adjust the `mk` call to them. `PROBE_EMAIL` must be a NON-admin seed account — admins skip moderation entirely (root CLAUDE.md), so the post would land `approved` and the own-pending check would be skipped. Leave the probe post in the dev DB or delete it through `DELETE /api/topics/delete/<id>` as A — either is fine on dev.

- [ ] **Step 4: Run it**

Start the dev server: `pnpm dev --port 4655 > /dev/null 2>&1 &` (stop later with `fuser -k 4655/tcp`, never pkill).
Run: `PROBE_EMAIL=<seed account> node scratchpad/search-api-probe.mjs`
Expected: all PASS (skips are allowed only where the script prints SKIP with its reason).

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/search.ts src/middleware.ts scratchpad/search-api-probe.mjs
git commit -m "forum search: gated GET /api/search with per-member rate limit"
```

---

### Task 4: `/search` page + island on the server query

**Files:**
- Modify: `src/pages/search.astro` (whole frontmatter: drop the corpus, SSR the first query)
- Modify: `src/components/forum/kiosk/SearchPage.svelte` (fetch-driven, three kinds, fixed history state, no native clear button)
- Create: `scratchpad/search-page-probe.cjs` (Playwright, dev :4655)

**Interfaces:**
- Consumes: `searchForum`, `normalizeQuery`, `SearchResult` types (Tasks 1–2); `GET /api/search` (Task 3); `PostTypeChip` (`kind` prop: `'discussion' | 'recommendation' | 'announcement'`); `relTime(input, locale)` from `src/lib/relTime.ts`.
- Produces: island props `{ initialQuery: string; initialResults: SearchResult | null }`.

- [ ] **Step 1: Rewrite the page frontmatter**

```astro
---
// /search — forum search (posts of all three kinds + comments). The query
// runs on the SERVER (src/lib/forum/searchStore.ts): a `?q=` in the URL is
// answered in this first render, later keystrokes go through
// GET /api/search from the island. Until 2026-09-24 the page shipped the
// last 200 discussions + 300 comments and filtered in the browser — it
// never saw announcements or recommendations, and comments were read with a
// field name (`topicId`) that no comment has.
import KioskLayout from '../layouts/KioskLayout.astro';
import SearchPage from '../components/forum/kiosk/SearchPage.svelte';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../lib/mongodb';
import { normalizeQuery } from '../lib/forum/searchQuery';
import { searchForum, type SearchResult } from '../lib/forum/searchStore';

const session = await getSession(Astro.request);
const userId = session?.user?.id;

const initialQuery = normalizeQuery(Astro.url.searchParams.get('q')) ?? '';
let initialResults: SearchResult | null = null;
if (initialQuery) {
  try {
    const db = await connectDB();
    initialResults = await searchForum(db, initialQuery, userId);
  } catch (err) {
    console.error('[search.astro] first query failed:', err);
  }
}
---

<KioskLayout title="Mahalle · Suche" description="Suche im Forum." page="forum">
  <SearchPage client:only="svelte" initialQuery={initialQuery} initialResults={initialResults} />
</KioskLayout>
```

- [ ] **Step 2: Rewrite the island's script block** (keep the markup structure and classes of the existing cards; the diff below replaces `<script>` fully and adjusts the template where noted)

```svelte
<script lang="ts">
  // Search results — port of `ForumSearchMobile` (design handoff
  // kiosk-forum-extras.jsx L195–268), slim result cards with an ochre
  // <mark> on the first match. Since 2026-09-24 the results come from
  // GET /api/search (server query over all three post kinds + comments);
  // the page SSRs the first `?q=` so a shared link renders its hits at once.
  import { onMount } from 'svelte';
  import PostTypeChip from './PostTypeChip.svelte';
  import { locale } from '../../../lib/kiosk-i18n';
  import { relTime } from '../../../lib/relTime';
  import { normalizeQuery, SEARCH_MAX_LEN, type SearchResult } from '../../../lib/forum/searchQuery'; // pure module — never import searchStore (driver) into an island

  let { initialQuery = '', initialResults = null } = $props<{
    initialQuery?: string;
    initialResults?: SearchResult | null;
  }>();

  let query = $state(initialQuery);
  let results = $state<SearchResult | null>(initialResults);
  let loading = $state(false);
  let failed = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);

  const normalized = $derived(normalizeQuery(query));
  const posts = $derived(results && results.q === normalized ? results.posts : []);
  const comments = $derived(results && results.q === normalized ? results.comments : []);
  const total = $derived(posts.length + comments.length);

  // ─── Fetch (debounced, last request wins) ─────────────────────────
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  async function run(q: string) {
    const my = ++seq;
    loading = true; failed = false;
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (my !== seq) return;
      if (!r.ok) { failed = true; return; }
      results = await r.json();
    } catch {
      if (my === seq) failed = true;
    } finally {
      if (my === seq) loading = false;
    }
  }
  $effect(() => {
    const q = normalized;
    clearTimeout(timer);
    if (!q) { results = null; loading = false; failed = false; return; }
    if (results && results.q === q) return; // SSR answer or same query again
    timer = setTimeout(() => run(q), 250);
    return () => clearTimeout(timer);
  });

  // ─── URL sync (?q=) — keeps Astro's ClientRouter state (root CLAUDE.md) ─
  onMount(() => {
    if (!query) inputEl?.focus();
  });
  $effect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (normalized) url.searchParams.set('q', normalized);
    else url.searchParams.delete('q');
    window.history.replaceState(window.history.state, '', url.toString());
  });

  // ─── Highlight (XSS-safe: prefix / match / suffix, each auto-escaped) ─
  function splitOnFirstMatch(text: string | undefined | null, q: string) {
    if (!text || !q) return null;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return null;
    return { prefix: text.slice(0, idx), match: text.slice(idx, idx + q.length), suffix: text.slice(idx + q.length) };
  }

  const placeholder = $derived($locale === 'de' ? 'Worüber suchst du? (Titel, Text, Tag)' : 'What are you looking for? (title, text, tag)');
  const kickerCopy = $derived.by(() => {
    const de = $locale === 'de';
    if (!normalized) return de ? 'FORUM · BEITRÄGE + KOMMENTARE' : 'FORUM · POSTS + COMMENTS';
    if (loading) return de ? 'SUCHE …' : 'SEARCHING …';
    if (failed) return de ? 'SUCHE NICHT ERREICHBAR' : 'SEARCH UNAVAILABLE';
    return de ? `${total} TREFFER · BEITRÄGE + KOMMENTARE` : `${total} RESULTS · POSTS + COMMENTS`;
  });
</script>
```

Template changes (everything else stays as it is):
1. The input: `type="text" inputmode="search" enterkeyhint="search" maxlength={SEARCH_MAX_LEN} bind:this={inputEl}` instead of `type="search"` — Chrome draws its own ✕ on `type="search"`, doubling ours (seen on prod 2026-09-24).
2. Idle branch `{#if !normalized}` (was `!query`), text stays; empty branch `{:else if !loading && !failed && total === 0}`; add a `{:else if failed}` branch with the same dashed frame and the copy „Die Suche ist gerade nicht erreichbar. Versuch es gleich noch einmal." / „Search is unavailable right now. Try again in a moment."
3. Post cards iterate `posts` (was `filteredTopics`): `href={post.href}`, `<PostTypeChip kind={post.kind} size="sm" />`, time `relTime(post.date, $locale)`, title split on `post.title`, excerpt = `post.excerpt` (no `excerpt()`/`shortenUrlsInText` any more — the server did it). Keep the `<mark>` split for title and excerpt.
4. Comment cards iterate `comments`: `href={comment.href}`, parent line `↪ {comment.parentTitle}`, excerpt `comment.excerpt`, time `relTime(comment.date, $locale)`.
5. Remove the `Topic`/`Comment` local types, `shortenUrlsInText` import, the local `relTime`, `excerpt`, `topicMatches`, `commentMatches`.

- [ ] **Step 3: Write the Playwright probe**

```js
// scratchpad/search-page-probe.cjs — NODE_PATH=$(npm root -g)/@playwright/cli/node_modules node scratchpad/search-page-probe.cjs
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); let fails = 0;
  const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${x}`); if (!ok) fails++; };
  for (const [name, vw] of [['desktop', { width: 1400, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const p = await (await b.newContext({ viewport: vw })).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:4655/login?redirect=%2Fsearch%3Fq%3Dder');
    await p.fill('input[type="email"]', process.env.PROBE_EMAIL); await p.fill('input[type="password"]', fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim());
    await p.keyboard.press('Enter'); await p.waitForURL('**/search**'); await p.waitForTimeout(1500);
    const ssrCards = await p.locator('main article').count();
    check(`${name}: SSR hits for ?q=der`, ssrCards > 0, String(ssrCards));
    check(`${name}: input is text, not search (no native ✕)`, (await p.locator('main input').first().getAttribute('type')) === 'text');
    check(`${name}: history.state kept`, await p.evaluate(() => history.state !== null && typeof history.state === 'object' && 'index' in history.state));
    await p.locator('main input').first().fill('('); await p.waitForTimeout(600);
    check(`${name}: "(" shows 0 Treffer, no error`, /0 TREFFER|0 RESULTS/.test(await p.locator('main').innerText()));
    await p.locator('main input').first().fill('a'); await p.waitForTimeout(600);
    check(`${name}: 1 char → idle state, no request`, /FORUM · /.test(await p.locator('main').innerText()));
    await p.locator('main input').first().fill('der'); await p.waitForTimeout(800);
    const kinds = await p.locator('main article').evaluateAll((els) => els.map((e) => e.querySelector('a, [data-kind]') ? 1 : 0).length);
    check(`${name}: typed query renders cards`, kinds > 0, String(kinds));
    check(`${name}: url synced`, p.url().includes('q=der'));
    check(`${name}: no page errors`, errs.length === 0, errs.join(' | '));
    await p.screenshot({ path: `scratchpad/search-dev-${name}.png` });
    await p.close();
  }
  await b.close(); console.log(fails ? `${fails} FAILED` : 'all green'); process.exit(fails ? 1 : 0);
})();
```

- [ ] **Step 4: Run it, look at the shots**

Run: `PROBE_EMAIL=<seed account> NODE_PATH=$(npm root -g)/@playwright/cli/node_modules node scratchpad/search-page-probe.cjs`
Expected: all PASS. Open `scratchpad/search-dev-phone.png`: one clear button only; an announcement or recommendation chip visible among the hits (the seed has all kinds).

- [ ] **Step 5: Commit**

```bash
git add src/pages/search.astro src/components/forum/kiosk/SearchPage.svelte scratchpad/search-page-probe.cjs
git commit -m "forum search: page and island on the server query (all post kinds, comments with parent, fixed history state)"
```

---

### Task 5: Masthead magnifier + strip under the bar

**Files:**
- Create: `src/components/forum/kiosk/MastSearch.svelte`
- Modify: `src/components/forum/kiosk/KioskNav.svelte` (state `searchOpen`, mount the disc in the right cluster before the bell, the strip as the header's second row, `searchOpen` in the hide-on-scroll lock + the „bring back" effect)
- Modify: `src/styles/global.css` (new `.ms-*` block after `.nc-badge`)
- Modify: `src/lib/kiosk-i18n.ts` (keys `nav.search.aria`, `nav.search.placeholder`, `nav.search.close` in `de` after `'nav.bell.aria'` line 96 and in `en` next to its `'nav.bell.aria'`)
- Create: `scratchpad/mast-search-probe.cjs`

**Interfaces:**
- Consumes: `t`, `locale` stores from `kiosk-i18n`; `currentPath` prop already on `KioskNav`.
- Produces: `MastSearch.svelte` props `{ open?: boolean; onToggle: () => void; currentPath?: string }`. It renders ONLY the disc button; the strip markup, its state and its close logic live in `KioskNav` (the strip must be a direct child of `<header>` to be measured).

- [ ] **Step 1: i18n keys**

```ts
  // de, after 'nav.bell.aria'
  'nav.search.aria': 'Suche',
  'nav.search.placeholder': 'Im Forum suchen …',
  'nav.search.close': 'Suche schließen',
  // en, after its 'nav.bell.aria'
  'nav.search.aria': 'Search',
  'nav.search.placeholder': 'Search the forum …',
  'nav.search.close': 'Close search',
```

- [ ] **Step 2: The disc component**

```svelte
<!-- src/components/forum/kiosk/MastSearch.svelte -->
<script lang="ts">
  // Magnifier disc in the masthead's right cluster — sibling of the bell disc
  // (same 36 px paper-warm disc, frame in the bar's text colour, bevel; styles
  // in global.css `.ms-*`, never here: a nested island's <style> is orphaned
  // in prod builds). Click opens the strip under the bar (markup in KioskNav);
  // on /search itself the disc is a plain link to the page's own box.
  import { t } from '../../../lib/kiosk-i18n';
  let { open = false, onToggle, currentPath = '/' } = $props<{
    open?: boolean; onToggle: () => void; currentPath?: string;
  }>();
  const onSearchPage = $derived(currentPath === '/search' || currentPath.startsWith('/search?'));
</script>

{#if onSearchPage}
  <a href="/search" aria-current="page" aria-label={$t['nav.search.aria']} class="ms-btn kiosk-tap">
    <span class="ms-disc ms-disc--active">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>
    </span>
  </a>
{:else}
  <button type="button" onclick={onToggle} aria-expanded={open} aria-controls="mast-search" aria-label={$t['nav.search.aria']} class="ms-btn kiosk-tap" data-mast-search-btn>
    <span class="ms-disc" class:ms-disc--active={open}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>
    </span>
  </button>
{/if}
```

- [ ] **Step 3: CSS block in `global.css`** (right after the `.nc-badge { … }` rule)

```css
/* ─── Masthead search disc + strip (2026-09-24) ─────────────────────────
   Disc = sibling of .nc-bell-disc: same size, fill, frame colour token and
   bevel. The strip is the header's second row; it sits INSIDE <header> so the
   hide-on-scroll ResizeObserver re-measures --k-mast-h when it opens. */
.ms-btn { display: inline-flex; align-items: center; justify-content: center; background: none; border: 0; padding: 0; cursor: pointer; color: var(--k-ink); }
.ms-btn:focus-visible { outline: none; }
.ms-disc {
  position: relative; width: 36px; height: 36px; border-radius: 50%;
  background: var(--k-paper-warm);
  border: 2px solid var(--k-bar-pill-border, var(--k-ink));
  display: flex; align-items: center; justify-content: center;
  transition: transform 180ms ease-out;
  box-shadow: inset -1px 0 1.5px rgb(27 26 23 / 0.55),
              inset 1px 0 1.5px rgb(245 239 224 / 0.8);
}
.ms-btn:hover .ms-disc, .ms-btn:focus-visible .ms-disc { transform: scale(1.05); }
/* Open / on the search page: ink disc with the paper-framed look of a selected tab. */
.ms-disc--active {
  background: var(--k-ink); color: var(--k-paper); border-color: var(--k-paper);
  box-shadow: inset -1px 0 3px rgb(245 239 224 / 0.75), inset -1px 0 1.5px rgb(27 26 23 / 0.55);
}
.ms-strip {
  border-top: 2px solid var(--k-ink);
  background: var(--k-paper-warm);
}
.ms-strip__inner {
  max-width: 80rem; margin: 0 auto; padding: 8px 16px;
  display: flex; align-items: center; gap: 8px;
}
@media (min-width: 768px) { .ms-strip__inner { padding-left: 36px; padding-right: 36px; } }
@media (min-width: 1024px) { .ms-strip__inner { padding-left: 40px; padding-right: 40px; } }
.ms-field {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;
  height: 40px; padding: 0 14px; border-radius: 9999px;
  background: var(--k-paper); border: 1.5px solid var(--k-ink);
}
.ms-field input {
  flex: 1; min-width: 0; background: transparent; border: 0; outline: none;
  font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-size: 15px; font-weight: 600; color: var(--k-ink);
}
.ms-field input::placeholder { color: var(--k-ink-mute); font-weight: 400; }
.ms-close { flex: 0 0 auto; width: 36px; height: 36px; border-radius: 50%; border: 0; background: none; color: var(--k-ink); cursor: pointer; font-size: 18px; line-height: 1; }
.ms-close:hover { background: rgb(27 26 23 / 0.08); }
```

(`'Bricolage Grotesque', system-ui, sans-serif` is the declaration `global.css` already uses at line 780.)

- [ ] **Step 4: Wire it into `KioskNav.svelte`**

Script additions:

```ts
  import MastSearch from './MastSearch.svelte';
  import { tick } from 'svelte';
  let searchOpen = $state(false);
  let searchEl = $state<HTMLInputElement | null>(null);
  let searchQ = $state('');

  async function toggleSearch() {
    searchOpen = !searchOpen;
    if (searchOpen) { await tick(); searchEl?.focus(); } // the strip mounts on the next flush
  }
  function closeSearch(restoreFocus: boolean) {
    if (!searchOpen) return;
    searchOpen = false;
    searchQ = '';
    if (restoreFocus) (headerEl?.querySelector('[data-mast-search-btn]') as HTMLElement | null)?.focus();
  }
  function submitSearch(e: SubmitEvent) {
    e.preventDefault();
    const q = searchQ.replace(/\s+/g, ' ').trim();
    if (q.length < 2) return;
    // Full navigation on purpose: /search SSRs the first query, and the strip
    // must not survive into the page that has its own box.
    window.location.href = `/search?q=${encodeURIComponent(q)}`;
  }
  // Escape closes; a click outside the strip and the disc closes.
  $effect(() => {
    if (!searchOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSearch(true); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (headerEl?.querySelector('#mast-search')?.contains(t)) return;
      if (headerEl?.querySelector('[data-mast-search-btn]')?.contains(t)) return;
      closeSearch(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  });
```

Three existing lines change:
- In the hide-on-scroll `apply()`: `menuOpen || bellOpen ||` → `menuOpen || bellOpen || searchOpen ||`.
- The „bring back" effect: `if (menuOpen || bellOpen) mastHidden = false;` → `if (menuOpen || bellOpen || searchOpen) mastHidden = false;`
- The header's class: `{menuOpen || bellOpen ? 'z-50' : 'z-40'}` → `{menuOpen || bellOpen || searchOpen ? 'z-50' : 'z-40'}`.

Markup: in the right cluster, directly before `<NotificationBell …/>` inside `{#if user?.name}`:

```svelte
        <MastSearch open={searchOpen} onToggle={toggleSearch} {currentPath} />
```

And as the LAST child of `<header>` (after the closing `</div>` of the main row, before `</header>`):

```svelte
  {#if searchOpen}
    <form id="mast-search" class="ms-strip" role="search" onsubmit={submitSearch}>
      <div class="ms-strip__inner">
        <label class="ms-field">
          <span class="font-dmmono text-[14px] text-ink-mute" aria-hidden="true">⌕</span>
          <input bind:this={searchEl} bind:value={searchQ} type="text" inputmode="search" enterkeyhint="search" maxlength="80" autocomplete="off" placeholder={$t['nav.search.placeholder']} aria-label={$t['nav.search.aria']} />
        </label>
        <button type="button" class="ms-close kiosk-tap" onclick={() => closeSearch(true)} aria-label={$t['nav.search.close']}>×</button>
      </div>
    </form>
  {/if}
```

The strip is gated by `{#if user?.name}` implicitly: `searchOpen` can only become true through the disc, which mounts for logged-in users only.

- [ ] **Step 5: Playwright probe of the strip**

```js
// scratchpad/mast-search-probe.cjs — NODE_PATH=$(npm root -g)/@playwright/cli/node_modules node scratchpad/mast-search-probe.cjs
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); let fails = 0;
  const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${x}`); if (!ok) fails++; };
  for (const [name, vw] of [['desktop', { width: 1400, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const p = await (await b.newContext({ viewport: vw, hasTouch: name === 'phone' })).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:4655/login?redirect=%2Fforum');
    await p.fill('input[type="email"]', process.env.PROBE_EMAIL); await p.fill('input[type="password"]', fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim());
    await p.keyboard.press('Enter'); await p.waitForURL('**/forum**'); await p.waitForTimeout(1500);
    const btn = p.locator('[data-mast-search-btn]:visible').first();
    check(`${name}: disc present`, await btn.count() === 1);
    const box = await btn.boundingBox(); check(`${name}: hit area ≥ 44`, box && box.width >= 44 && box.height >= 44, JSON.stringify(box));
    await btn.click(); await p.waitForTimeout(300);
    check(`${name}: strip open + focused`, await p.locator('#mast-search input').isVisible() && await p.evaluate(() => document.activeElement?.closest('#mast-search') !== null));
    const mastH = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--k-mast-h'));
    check(`${name}: --k-mast-h grew with the strip`, parseInt(mastH) > 70, mastH);
    await p.screenshot({ path: `scratchpad/mast-search-${name}-open.png` });
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    check(`${name}: Escape closes, focus back on disc`, !(await p.locator('#mast-search').count()) && await p.evaluate(() => document.activeElement?.hasAttribute('data-mast-search-btn')));
    await btn.click(); await p.waitForTimeout(200); await p.mouse.click(vw.width / 2, vw.height - 100); await p.waitForTimeout(200);
    check(`${name}: outside click closes`, !(await p.locator('#mast-search').count()));
    await btn.click(); await p.locator('#mast-search input').fill('der'); await p.keyboard.press('Enter'); await p.waitForURL('**/search?q=der**'); await p.waitForTimeout(1200);
    check(`${name}: Enter → /search?q=der with hits`, (await p.locator('main article').count()) > 0);
    check(`${name}: on /search the disc is a link, no strip`, (await p.locator('a[aria-current="page"][aria-label]:visible').filter({ has: p.locator('.ms-disc') }).count()) === 1 && (await p.locator('#mast-search').count()) === 0);
    if (name === 'phone') {
      await p.goto('http://localhost:4655/forum'); await p.waitForTimeout(1200);
      await btn.click(); await p.waitForTimeout(200);
      await p.evaluate(() => window.scrollTo(0, 600)); await p.waitForTimeout(500);
      check('phone: bar stays while the strip is open', await p.evaluate(() => document.querySelector('header')?.getAttribute('data-mast-hidden') !== 'true'));
    }
    check(`${name}: no page errors`, errs.length === 0, errs.join(' | '));
    await p.close();
  }
  await b.close(); console.log(fails ? `${fails} FAILED` : 'all green'); process.exit(fails ? 1 : 0);
})();
```

- [ ] **Step 6: Run it; look at both open shots; copy them for the user**

Run: `PROBE_EMAIL=<seed account> NODE_PATH=$(npm root -g)/@playwright/cli/node_modules node scratchpad/mast-search-probe.cjs && cp scratchpad/mast-search-*-open.png /mnt/c/Users/atakee/Downloads/`
Expected: all PASS. In the phone shot: logo, DE/EN, magnifier, bell, avatar fit in one 54 px row at 390 px with no wrap (if the row wraps, drop the disc to 32 px on `<lg` via `.ms-disc { width: 32px; height: 32px }` inside a `@media (max-width: 1023px)` rule and re-shoot).

- [ ] **Step 7: Commit**

```bash
git add src/components/forum/kiosk/MastSearch.svelte src/components/forum/kiosk/KioskNav.svelte src/styles/global.css src/lib/kiosk-i18n.ts scratchpad/mast-search-probe.cjs
git commit -m "masthead: magnifier disc opens a search strip under the bar (forum search entry point)"
```

---

### Task 6: Gates, docs, handoff

**Files:**
- Modify: `src/components/forum/kiosk/CLAUDE.md` (new section „Search")
- Modify: `CLAUDE.md` (root: one sentence under „Forum patterns" pointing at the section; `/api/search` in the middleware `GATED_APIS` list under „Landing + login gating"; the „Known offenders" list for `replaceState({})` loses `SearchPage.svelte:64`)

- [ ] **Step 1: Gates**

Run, in this order:
```bash
npx tsx --test src/lib/forum/searchQuery.test.ts
pnpm type-check 2>&1 | grep -c "error TS"        # ≤ 23
npx -y svelte-check@4 2>&1 | tail -3               # errors ≤ 89
pnpm build 2>&1 | tail -5                          # green
```
Then the prod-bundle manifest check for the nested island (root CLAUDE.md): `MastSearch` has no `<style>`, so nothing to check — confirm with `grep -c "<style" src/components/forum/kiosk/MastSearch.svelte` → `0`.

- [ ] **Step 2: Area doc** — append to `src/components/forum/kiosk/CLAUDE.md`:

```markdown
## Search (2026-09-24)
`/search` (`src/pages/search.astro` + `SearchPage.svelte`) searches all three post kinds and comments through `GET /api/search?q=` (`src/pages/api/search.ts`, members only, 300/h per member, `no-store`) → `searchForum()` in `src/lib/forum/searchStore.ts` (server) over the pure helpers in `src/lib/forum/searchQuery.ts` (query 2–80 chars, regex-escaped, excerpt ≤ 160 chars around the first match; tests `npx tsx --test src/lib/forum/searchQuery.test.ts`). Visibility = `buildModerationFilter(userId)` for posts AND for a comment's parent — a comment on a rejected or deleted post never surfaces. Authors via `populateAuthors()` (allowlist), comments ship no author. The page SSRs the first `?q=`; the island debounces 250 ms and keeps `history.state` (`replaceState(history.state, …)`). Input is `type="text"` + `inputmode="search"` — `type="search"` made Chrome draw a second clear button. **Entry point:** the magnifier disc in the masthead (`MastSearch.svelte`, styles `.ms-*` in `global.css`, sibling of the bell disc) opens a strip under the bar on every width (user decision „strip under the bar"); Enter → full navigation to `/search?q=`, Escape / outside click close, on `/search` the disc is a link. The strip is a child of `<header>` so hide-on-scroll re-measures `--k-mast-h`; `searchOpen` locks the bar like the menus. Before 2026-09-24 the page was orphaned (no link anywhere since the kiosk migration) and searched only the last 200 discussions client-side, with comments read through a field (`topicId`) no comment has. Probes (dev :4655): `scratchpad/search-store-probe.mts` (dev DB fixtures), `search-api-probe.mjs`, `search-page-probe.cjs`, `mast-search-probe.cjs`. Next step when the forum outgrows regex: a Mongo text index.
```

- [ ] **Step 3: Root doc** — three small edits in `CLAUDE.md`:
1. Under „Landing + login gating", the `GATED_APIS` line gains `/api/search`.
2. Under „Forum patterns", append: „**Forum search since 2026-09-24**: masthead magnifier → strip → `/search`, server query over all post kinds + comments (`src/lib/forum/searchStore.ts`); section „Search" in the area file."
3. Under „Astro Script + ViewTransitions" → „Known offenders still to fix", remove `SearchPage.svelte:64` from the list.

- [ ] **Step 4: Commit the docs**

```bash
git add CLAUDE.md src/components/forum/kiosk/CLAUDE.md
git commit -m "docs: forum search (server query, masthead magnifier, gates)"
```

- [ ] **Step 5: Hand over to the user — do not push**

Report: the four probe results, the gate numbers, the two open-strip screenshots in `Downloads/`, the draft copy (three i18n strings) for his wording. Push and deploy only on his word; after the deploy, verify on prod read-only with the throwaway account: `curl -sI https://mahalle.digital/api/search?q=test | head -1` → 401 logged out; logged in via the fetch login used in `scratchpad/search-corpus-prod.mjs`: `GET /api/search?q=Schillermarkt` returns the announcement; `x-vercel-id` shows `fra1::fra1`.
