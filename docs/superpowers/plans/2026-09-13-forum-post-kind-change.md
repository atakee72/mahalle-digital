# Forum Post Kind Change (edit mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the author of a forum post change its kind (Diskussion / Empfehlung / Ankündigung) from the post page's edit mode, the same three type cards the create screen shows.

**Architecture:** The three kinds are three Mongo collections (`topics`, `announcements`, `recommendations`), so a kind change is a *move*: copy the document into the target collection under the same `_id`, re-key the records that store the kind (`flaggedContent.contentType`, `notifications.target.{contentType,href}`), drop `translationCache` rows, delete the source. Comments (`relevantPostId` only), likes/views (on the doc) and `savedPosts` (id only) need nothing. The post's URL changes with the collection, so the three detail pages gain a fallback that redirects an id found in another collection (302, never 301). The client does edit → move → hard navigation to the new href.

**Tech Stack:** Astro 5 API routes, MongoDB driver (no transactions — free Atlas tier), Svelte 5 runes, Zod, `node:test` via `npx tsx`.

**Spec:** No separate spec. Requirements come from the user's report (2026-09-13): „user wants to edit his forum post and change the post type from discussion to anno.. but those post types are not shown in the edit window like in the create post screen". Decisions ruled in chat: option 3 (author-facing), old links must keep working, official announcements never move, bookmarks gap accepted.

## Global Constraints

- Gates before every commit: `pnpm exec tsc --noEmit 2>&1 | grep -c 'error TS'` ≤ 26 and `npx -y svelte-check@4 --output machine 2>&1 | grep ' COMPLETED '` errors ≤ 92 (ratchet budgets; never raise).
- Commits: one-line, simple, no „Generated with Claude Code" signature, no Co-Authored-By footer. `git add` specific files only, never `git add .`. Report a SHA only after seeing it in `git log -1`.
- Never stage secrets. `scratchpad/` is gitignored; the dev password lives in `scratchpad/devpw.txt` and is read straight into a `fill()` argument, never printed, sliced or copied.
- No `<style>` blocks in nested-island Svelte components (Tailwind classes only).
- Every tap target on a kiosk surface ≥ 44px tall (`min-h-[44px]`).
- Dev server for probes on port **4655** (`pnpm dev --port 4655`), stop it with `fuser -k 4655/tcp` afterwards. Never touch port 3000.
- Dev DB (`mahalle-dev`) writes are fine; the probe cleans up what it creates.
- Server-only modules (anything importing `connectDB`) must never be imported from a `client:*` island. `src/lib/forum/postKind.ts` (Task 1) is dependency-pure and safe for both; `src/lib/forum/movePost.ts` (Task 2) is server-only.
- i18n: every new key goes into BOTH the `de` and `en` objects of `src/lib/kiosk-i18n.ts` (`en` is typed `Record<keyof typeof de, string>`, so a missing EN key is a type error).

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/forum/postKind.ts` (new) | Pure maps kind ↔ collection ↔ contentType, `hrefForPost`, `buildMovedDoc` (field hygiene when a doc changes collection). Importable from client and server. |
| `src/lib/forum/postKind.test.ts` (new) | node:test cases for the above. |
| `src/lib/forum/movePost.ts` (new) | Server-side `movePost(db, …)` (ordered, idempotent cross-collection move) + `locatePost(db, id, exclude)`. Takes a `Db`, never imports `connectDB` (keeps it unit-testable under tsx). |
| `src/lib/forum/movePost.test.ts` (new) | node:test cases against an in-memory fake `Db`. |
| `src/schemas/forum.schema.ts` | `PostMoveSchema` (`from`, `to`). |
| `src/pages/api/posts/move/[id].ts` (new) | `POST` endpoint: session + ban + owner/admin + moderation gate + official guard → `movePost` → kontext invalidation. |
| `src/pages/topics/[id].astro`, `src/pages/announcements/[id].astro`, `src/pages/recommendations/[id].astro` | Not-found fallback: `locatePost` → 302 to the new href. |
| `src/components/forum/kiosk/ForumPostDetail.svelte` | Edit mode: kind chips under the title input, `editKind` state, save = edit → move → navigate. |
| `src/lib/kiosk-i18n.ts` | 4 new keys `edit.kind.*` (DE + EN). |
| `src/components/forum/kiosk/CLAUDE.md`, root `CLAUDE.md` | Docs. |

---

### Task 1: Pure kind/collection helper

**Files:**
- Create: `src/lib/forum/postKind.ts`
- Test: `src/lib/forum/postKind.test.ts`

**Interfaces:**
- Produces:
  - `type PostKind = 'discussion' | 'recommendation' | 'announcement'`
  - `type PostCollection = 'topics' | 'announcements' | 'recommendations'`
  - `type PostContentType = 'topic' | 'announcement' | 'recommendation'`
  - `const POST_COLLECTIONS: readonly PostCollection[]`
  - `isPostCollection(x: unknown): x is PostCollection`
  - `collectionForKind(kind: PostKind): PostCollection`
  - `kindForCollection(c: PostCollection): PostKind`
  - `contentTypeForCollection(c: PostCollection): PostContentType`
  - `hrefForPost(c: PostCollection, id: string): string` → `` `/${c}/${id}` ``
  - `buildMovedDoc(source: Record<string, unknown>, from: PostCollection, to: PostCollection, now: Date): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

`src/lib/forum/postKind.test.ts`:

```ts
// Unit tests for the forum post-kind helper. Run directly:
//   npx tsx src/lib/forum/postKind.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POST_COLLECTIONS, isPostCollection, collectionForKind, kindForCollection,
  contentTypeForCollection, hrefForPost, buildMovedDoc,
} from './postKind';

test('kind ↔ collection round-trips for all three kinds', () => {
  for (const c of POST_COLLECTIONS) {
    assert.equal(collectionForKind(kindForCollection(c)), c);
  }
  assert.equal(collectionForKind('discussion'), 'topics');
  assert.equal(collectionForKind('announcement'), 'announcements');
  assert.equal(collectionForKind('recommendation'), 'recommendations');
});

test('contentType and href per collection', () => {
  assert.equal(contentTypeForCollection('topics'), 'topic');
  assert.equal(contentTypeForCollection('announcements'), 'announcement');
  assert.equal(contentTypeForCollection('recommendations'), 'recommendation');
  assert.equal(hrefForPost('announcements', 'abc'), '/announcements/abc');
});

test('isPostCollection rejects events, empty and non-strings', () => {
  assert.equal(isPostCollection('topics'), true);
  assert.equal(isPostCollection('events'), false);
  assert.equal(isPostCollection(''), false);
  assert.equal(isPostCollection(42), false);
});

test('buildMovedDoc keeps identity + engagement, stamps provenance', () => {
  const now = new Date('2026-09-13T10:00:00Z');
  const src = {
    _id: 'id1', title: 'T', body: 'B', author: 'u1', comments: ['c1'], views: 3,
    likes: 2, likedBy: ['u2', 'u3'], tags: ['x'], images: [], date: 1, editHistory: [{ a: 1 }],
    moderationStatus: 'approved', createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-01'),
  };
  const out = buildMovedDoc(src, 'topics', 'announcements', now);
  assert.equal(out._id, 'id1');
  assert.deepEqual(out.likedBy, ['u2', 'u3']);
  assert.equal(out.likes, 2);
  assert.equal(out.views, 3);
  assert.deepEqual(out.comments, ['c1']);
  assert.deepEqual(out.editHistory, [{ a: 1 }]);
  assert.equal(out.createdAt, src.createdAt);
  assert.equal(out.updatedAt, now);
  assert.equal(out.movedFrom, 'topics');
  assert.equal(out.movedAt, now);
  assert.equal('category' in out, false);
});

test('buildMovedDoc strips announcement-only and recommendation-only fields', () => {
  const now = new Date();
  const fromAnn = buildMovedDoc(
    { _id: 'a', isOfficial: false, pinnedUntil: null, editCount: 2, title: 'T' },
    'announcements', 'topics', now,
  );
  assert.equal('isOfficial' in fromAnn, false);
  assert.equal('pinnedUntil' in fromAnn, false);
  assert.equal('editCount' in fromAnn, false);

  const fromRec = buildMovedDoc({ _id: 'r', category: 'shop', title: 'T' }, 'recommendations', 'topics', now);
  assert.equal('category' in fromRec, false);
});

test('buildMovedDoc gives a recommendation the default category', () => {
  const out = buildMovedDoc({ _id: 'x', title: 'T' }, 'topics', 'recommendations', new Date());
  assert.equal(out.category, 'other');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/lib/forum/postKind.test.ts`
Expected: FAIL — `Cannot find module './postKind'`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/forum/postKind.ts`:

```ts
// Forum post kinds vs. their storage. DEPENDENCY-PURE (no mongodb, no env):
// imported by the ForumPostDetail island AND by server code.
//
// The three forum kinds are three collections. Changing a post's kind is a
// cross-collection move (src/lib/forum/movePost.ts); this file owns the
// naming so nobody hand-rolls the plural/singular maps again.

export type PostKind = 'discussion' | 'recommendation' | 'announcement';
export type PostCollection = 'topics' | 'announcements' | 'recommendations';
/** Singular form used by flaggedContent.contentType, notifications.target.contentType, translationCache. */
export type PostContentType = 'topic' | 'announcement' | 'recommendation';

export const POST_COLLECTIONS: readonly PostCollection[] = ['topics', 'announcements', 'recommendations'];

const KIND_TO_COLLECTION: Record<PostKind, PostCollection> = {
  discussion: 'topics',
  recommendation: 'recommendations',
  announcement: 'announcements',
};
const COLLECTION_TO_KIND: Record<PostCollection, PostKind> = {
  topics: 'discussion',
  recommendations: 'recommendation',
  announcements: 'announcement',
};
const COLLECTION_TO_CONTENT_TYPE: Record<PostCollection, PostContentType> = {
  topics: 'topic',
  announcements: 'announcement',
  recommendations: 'recommendation',
};

export function isPostCollection(x: unknown): x is PostCollection {
  return typeof x === 'string' && (POST_COLLECTIONS as readonly string[]).includes(x);
}
export function collectionForKind(kind: PostKind): PostCollection {
  return KIND_TO_COLLECTION[kind];
}
export function kindForCollection(c: PostCollection): PostKind {
  return COLLECTION_TO_KIND[c];
}
export function contentTypeForCollection(c: PostCollection): PostContentType {
  return COLLECTION_TO_CONTENT_TYPE[c];
}
export function hrefForPost(c: PostCollection, id: string): string {
  return `/${c}/${id}`;
}

/**
 * The document as it should look in the target collection. Keeps _id,
 * author, engagement (likes/likedBy/views/comments), moderation state and
 * editHistory; strips fields that only mean something in one collection
 * (`isOfficial`/`pinnedUntil`/`editCount` are announcement-only and
 * server-controlled, `category` is recommendation-only); a recommendation
 * always carries a category, so the move gives it the schema default.
 * Stamps `movedFrom`/`movedAt` as provenance.
 */
export function buildMovedDoc(
  source: Record<string, unknown>,
  from: PostCollection,
  to: PostCollection,
  now: Date,
): Record<string, unknown> {
  const { isOfficial: _o, pinnedUntil: _p, editCount: _e, category: _c, ...rest } = source;
  const doc: Record<string, unknown> = { ...rest, updatedAt: now, movedFrom: from, movedAt: now };
  if (to === 'recommendations') doc.category = 'other';
  return doc;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/lib/forum/postKind.test.ts`
Expected: 6 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/forum/postKind.ts src/lib/forum/postKind.test.ts
git commit -m "feat(forum): pure post-kind helper (kind, collection, contentType, moved-doc hygiene)"
```

---

### Task 2: Server-side move

**Files:**
- Create: `src/lib/forum/movePost.ts`
- Test: `src/lib/forum/movePost.test.ts`

**Interfaces:**
- Consumes (Task 1): `POST_COLLECTIONS`, `contentTypeForCollection`, `hrefForPost`, `buildMovedDoc`, `PostCollection`.
- Produces:
  - `type MoveDb = Pick<Db, 'collection'>`
  - `type MoveResult = { ok: true; doc: Record<string, unknown>; alreadyMoved: boolean } | { ok: false; reason: 'same_collection' | 'not_found' }`
  - `movePost(db: MoveDb, args: { id: string; from: PostCollection; to: PostCollection; now?: Date }): Promise<MoveResult>`
  - `locatePost(db: MoveDb, id: string, exclude: PostCollection): Promise<PostCollection | null>`

Ordering rule (no transactions on the free Atlas tier): **copy first, delete last**, every step idempotent, so a re-run after a crash converges: source gone + target present → `alreadyMoved: true`; source still present → `replaceOne` upsert overwrites the half-written target and the delete finishes.

- [ ] **Step 1: Write the failing test**

`src/lib/forum/movePost.test.ts`:

```ts
// Unit tests for the cross-collection post move, against an in-memory fake Db.
// Run directly:  npx tsx src/lib/forum/movePost.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { movePost, locatePost } from './movePost';

type Doc = Record<string, any>;
const get = (doc: Doc, path: string) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
const setPath = (doc: Doc, path: string, v: unknown) => {
  const ks = path.split('.');
  let o = doc;
  for (const k of ks.slice(0, -1)) o = o[k] ??= {};
  o[ks[ks.length - 1]] = v;
};
// Exact-match filters only (that is all movePost uses); ObjectIds compare by string.
const matches = (doc: Doc, f: Doc) => Object.entries(f).every(([k, v]) => String(get(doc, k)) === String(v));

function fakeDb() {
  const store = new Map<string, Doc[]>();
  const collection = (name: string) => {
    if (!store.has(name)) store.set(name, []);
    const docs = store.get(name)!;
    return {
      async findOne(f: Doc) { return docs.find((d) => matches(d, f)) ?? null; },
      async replaceOne(f: Doc, doc: Doc, opts?: { upsert?: boolean }) {
        const i = docs.findIndex((d) => matches(d, f));
        if (i >= 0) docs[i] = { ...doc }; else if (opts?.upsert) docs.push({ ...doc });
        return {};
      },
      async updateMany(f: Doc, u: { $set: Doc }) {
        for (const d of docs) if (matches(d, f)) for (const [k, v] of Object.entries(u.$set)) setPath(d, k, v);
        return {};
      },
      async deleteMany(f: Doc) { for (let i = docs.length - 1; i >= 0; i--) if (matches(docs[i], f)) docs.splice(i, 1); return {}; },
      async deleteOne(f: Doc) { const i = docs.findIndex((d) => matches(d, f)); if (i >= 0) docs.splice(i, 1); return {}; },
    };
  };
  return { db: { collection } as any, store };
}

function seed() {
  const { db, store } = fakeDb();
  const _id = new ObjectId();
  const id = _id.toHexString();
  store.set('topics', [{ _id, title: 'T', body: 'B', author: 'u1', likes: 2, likedBy: ['u2', 'u3'], views: 5, comments: ['c1'], moderationStatus: 'approved' }]);
  store.set('announcements', []);
  store.set('recommendations', []);
  store.set('flaggedContent', [{ _id: new ObjectId(), contentId: id, contentType: 'topic', status: 'reviewed' }]);
  store.set('notifications', [
    { _id: new ObjectId(), userId: 'u1', target: { contentType: 'topic', contentId: id, title: 'T', href: `/topics/${id}` } },
    { _id: new ObjectId(), userId: 'u9', target: { contentType: 'topic', contentId: 'other', title: 'X', href: '/topics/other' } },
  ]);
  store.set('translationCache', [{ _id: new ObjectId(), key: `topic:${id}:en:h`, contentType: 'topic', contentId: id }]);
  return { db, store, id };
}

test('moves the doc and re-keys every dependent record', async () => {
  const { db, store, id } = seed();
  const now = new Date('2026-09-13T10:00:00Z');
  const res = await movePost(db, { id, from: 'topics', to: 'announcements', now });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.alreadyMoved, false);
  assert.equal(store.get('topics')!.length, 0);
  const moved = store.get('announcements')![0];
  assert.equal(String(moved._id), id);
  assert.deepEqual(moved.likedBy, ['u2', 'u3']);
  assert.equal(moved.views, 5);
  assert.equal(moved.movedFrom, 'topics');
  assert.equal(store.get('flaggedContent')![0].contentType, 'announcement');
  assert.deepEqual(store.get('notifications')![0].target, { contentType: 'announcement', contentId: id, title: 'T', href: `/announcements/${id}` });
  assert.equal(store.get('notifications')![1].target.href, '/topics/other');
  assert.equal(store.get('translationCache')!.length, 0);
});

test('re-running after completion is a no-op that reports alreadyMoved', async () => {
  const { db, store, id } = seed();
  await movePost(db, { id, from: 'topics', to: 'announcements' });
  const again = await movePost(db, { id, from: 'topics', to: 'announcements' });
  assert.equal(again.ok && again.alreadyMoved, true);
  assert.equal(store.get('announcements')!.length, 1);
});

test('re-running after a crash between copy and delete converges', async () => {
  const { db, store, id } = seed();
  // Simulate: copy landed, delete never ran.
  store.get('announcements')!.push({ ...store.get('topics')![0], title: 'half-written' });
  const res = await movePost(db, { id, from: 'topics', to: 'announcements' });
  assert.equal(res.ok, true);
  assert.equal(store.get('topics')!.length, 0);
  assert.equal(store.get('announcements')!.length, 1);
  assert.equal(store.get('announcements')![0].title, 'T');
});

test('same collection and unknown id are refused', async () => {
  const { db, id } = seed();
  assert.deepEqual(await movePost(db, { id, from: 'topics', to: 'topics' }), { ok: false, reason: 'same_collection' });
  assert.deepEqual(await movePost(db, { id: new ObjectId().toHexString(), from: 'topics', to: 'announcements' }), { ok: false, reason: 'not_found' });
});

test('moving into recommendations sets the default category', async () => {
  const { db, store, id } = seed();
  await movePost(db, { id, from: 'topics', to: 'recommendations' });
  assert.equal(store.get('recommendations')![0].category, 'other');
});

test('locatePost finds the id in another collection, never the excluded one', async () => {
  const { db, id } = seed();
  assert.equal(await locatePost(db, id, 'announcements'), 'topics');
  assert.equal(await locatePost(db, id, 'topics'), null);
  assert.equal(await locatePost(db, 'not-an-id', 'topics'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/lib/forum/movePost.test.ts`
Expected: FAIL — `Cannot find module './movePost'`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/forum/movePost.ts`:

```ts
// Cross-collection move of a forum post (= kind change). SERVER-SIDE, but it
// takes a Db instead of importing connectDB so it stays unit-testable under
// tsx (src/lib/mongodb.ts throws at import when MONGODB_URI is unset).
//
// No transactions on the free Atlas tier, so the order is COPY FIRST, DELETE
// LAST and every step is idempotent: a re-run after a crash converges
// (source gone + target present → alreadyMoved; source still present →
// replaceOne/upsert overwrites the half-written copy and the delete lands).
//
// What references a post by KIND and therefore needs re-keying:
//   flaggedContent.contentType        (singular, contentId is the string id)
//   notifications.target.contentType + .href (href is STORED)
//   translationCache rows             (key starts with `${contentType}:${id}`) → dropped
// What does NOT: comments (relevantPostId only), likes/views (on the doc),
// savedPosts (postId only), kiezKontextCache (caller invalidates).
import { ObjectId, type Db } from 'mongodb';
import {
  POST_COLLECTIONS, buildMovedDoc, contentTypeForCollection, hrefForPost, type PostCollection,
} from './postKind';

export type MoveDb = Pick<Db, 'collection'>;

export type MoveResult =
  | { ok: true; doc: Record<string, unknown>; alreadyMoved: boolean }
  | { ok: false; reason: 'same_collection' | 'not_found' };

export async function movePost(
  db: MoveDb,
  args: { id: string; from: PostCollection; to: PostCollection; now?: Date },
): Promise<MoveResult> {
  const { id, from, to } = args;
  const now = args.now ?? new Date();
  if (from === to) return { ok: false, reason: 'same_collection' };
  if (!ObjectId.isValid(id)) return { ok: false, reason: 'not_found' };
  const _id = new ObjectId(id);

  const source = await db.collection(from).findOne({ _id });
  if (!source) {
    const already = await db.collection(to).findOne({ _id });
    return already
      ? { ok: true, doc: already as Record<string, unknown>, alreadyMoved: true }
      : { ok: false, reason: 'not_found' };
  }

  const moved = buildMovedDoc(source as Record<string, unknown>, from, to, now);
  await db.collection(to).replaceOne({ _id }, moved, { upsert: true });

  const fromCT = contentTypeForCollection(from);
  const toCT = contentTypeForCollection(to);
  await db.collection('flaggedContent').updateMany(
    { contentId: id, contentType: fromCT },
    { $set: { contentType: toCT } },
  );
  await db.collection('notifications').updateMany(
    { 'target.contentId': id, 'target.contentType': fromCT },
    { $set: { 'target.contentType': toCT, 'target.href': hrefForPost(to, id) } },
  );
  await db.collection('translationCache').deleteMany({ contentType: fromCT, contentId: id });

  await db.collection(from).deleteOne({ _id });
  return { ok: true, doc: moved, alreadyMoved: false };
}

/** Which OTHER forum collection holds this id, if any (detail-page redirect after a move). */
export async function locatePost(
  db: MoveDb,
  id: string,
  exclude: PostCollection,
): Promise<PostCollection | null> {
  if (!ObjectId.isValid(id)) return null;
  const _id = new ObjectId(id);
  for (const c of POST_COLLECTIONS) {
    if (c === exclude) continue;
    const hit = await db.collection(c).findOne({ _id }, { projection: { _id: 1 } });
    if (hit) return c;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/lib/forum/movePost.test.ts`
Expected: 6 tests pass, 0 fail. (The fake's `findOne` ignores the projection argument — fine.)

- [ ] **Step 5: Gates + commit**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -c 'error TS'` → ≤ 26.

```bash
git add src/lib/forum/movePost.ts src/lib/forum/movePost.test.ts
git commit -m "feat(forum): idempotent cross-collection post move + locatePost"
```

---

### Task 3: `POST /api/posts/move/[id]`

**Files:**
- Modify: `src/schemas/forum.schema.ts` (append after `RecommendationUpdateSchema`, before `EventBaseSchema`)
- Create: `src/pages/api/posts/move/[id].ts`

**Interfaces:**
- Consumes (Task 1/2): `movePost`, `hrefForPost`, `PostCollection`.
- Produces: `PostMoveSchema` and the endpoint contract:
  - Request: `POST /api/posts/move/<id>` JSON `{ from: PostCollection, to: PostCollection }`, cookie session.
  - 200 `{ collection: PostCollection, href: string }`
  - 400 `{ error: 'Invalid post ID' | 'same_collection' }` (+ Zod `validation.response` shape)
  - 401 `{ error: 'Unauthorized - Please login' }`, 403 `{ error: 'You can only change your own posts' | 'edit_blocked_by_moderation' | 'official_announcement' | 'account_banned' }`, 404 `{ error: 'Post not found' }`.
  - Gate = the edit gate of `/api/topics/edit/[id].ts` (author, `moderationStatus === 'approved'`, no `hasWarningLabel`) plus admin allowed, plus `isOfficial === true` refused (officials are the admin dashboard's business and carry the pin lifecycle).

- [ ] **Step 1: Add the schema**

In `src/schemas/forum.schema.ts`, right after the `RecommendationUpdateSchema` block:

```ts
// Kind change (= cross-collection move, POST /api/posts/move/[id]).
const PostCollectionSchema = z.enum(['topics', 'announcements', 'recommendations']);
export const PostMoveSchema = z.object({
  from: PostCollectionSchema,
  to: PostCollectionSchema
});
```

- [ ] **Step 2: Write the endpoint**

`src/pages/api/posts/move/[id].ts`:

```ts
// Change a forum post's kind: move it between topics / announcements /
// recommendations. Same gate as the edit endpoints (author, approved, no
// warning label) + admin allowed; official announcements never move (they
// belong to /admin/announcements and carry the pin lifecycle). The heavy
// lifting is src/lib/forum/movePost.ts.
import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { ObjectId } from 'mongodb';
import { connectDB } from '../../../../lib/mongodb';
import { invalidateKiezKontext } from '../../../../lib/kiez/kontext';
import { rejectIfBanned } from '../../../../lib/auth/banGuard';
import { isOwner } from '../../../../utils/authHelpers';
import { parseRequestBody } from '../../../../schemas/validation.utils';
import { PostMoveSchema } from '../../../../schemas/forum.schema';
import { movePost } from '../../../../lib/forum/movePost';
import { hrefForPost } from '../../../../lib/forum/postKind';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const session = await getSession(request);
    if (!session?.user) return json({ error: 'Unauthorized - Please login' }, 401);

    const bannedRes = await rejectIfBanned(session.user.id);
    if (bannedRes) return bannedRes;

    const id = params.id;
    if (!id || !ObjectId.isValid(id)) return json({ error: 'Invalid post ID' }, 400);

    const validation = await parseRequestBody(request, PostMoveSchema);
    if (!validation.success) return validation.response;
    const { from, to } = validation.data;
    if (from === to) return json({ error: 'same_collection' }, 400);

    const db = await connectDB();
    const existing = await db.collection(from).findOne({ _id: new ObjectId(id) });
    if (!existing) return json({ error: 'Post not found' }, 404);

    const isAdmin = session.user.role === 'admin';
    if (!isAdmin && !isOwner(existing.author, session.user.id)) {
      return json({ error: 'You can only change your own posts' }, 403);
    }
    // Mirrors /api/{collection}/edit/[id].ts: nothing under review or
    // warning-labelled gets rewritten — and a kind change is a rewrite.
    if (existing.moderationStatus !== 'approved' || existing.hasWarningLabel) {
      return json({ error: 'edit_blocked_by_moderation' }, 403);
    }
    if (existing.isOfficial === true) return json({ error: 'official_announcement' }, 403);

    const result = await movePost(db, { id, from, to });
    if (!result.ok) return json({ error: result.reason }, result.reason === 'not_found' ? 404 : 400);

    // Anwohner-Kontext keyword-matches forum titles in `topics` — a title
    // entering or leaving that collection changes the chip payload.
    await invalidateKiezKontext();

    return json({ collection: to, href: hrefForPost(to, id) });
  } catch (error) {
    console.error('Post move error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};
```

- [ ] **Step 3: Verify against the dev server (API-only, no UI yet)**

Start: `pnpm dev --port 4655` (background). Then `scratchpad/move-api.cjs` (gitignored), run from the repo root with `NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/move-api.cjs`:

```js
// API-level check of POST /api/posts/move/[id] on the dev DB (admin: no OpenAI moderation on create).
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const BASE = process.env.BASE_URL || 'http://localhost:4655';
  const browser = await chromium.launch(); const page = await browser.newPage();
  await page.goto(`${BASE}/login?redirect=%2Fforum`);
  await page.fill('input[type="email"]', 'admin@mahalle-dev.test');
  await page.fill('input[type="password"]', fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim());
  await page.click('button[type="submit"]');
  await page.waitForURL('**/forum', { timeout: 20000 });
  const c = await page.request.post(`${BASE}/api/topics/create`, { data: { title: 'Move-Probe (API)', body: 'Testkörper für den Art-Wechsel, nur Dev-DB.', tags: ['test'] } });
  const id = (await c.json()).topic?._id; console.log('create', c.status(), id);
  const bad = await page.request.post(`${BASE}/api/posts/move/${id}`, { data: { from: 'topics', to: 'topics' } });
  console.log('same collection →', bad.status(), await bad.text());
  const mv = await page.request.post(`${BASE}/api/posts/move/${id}`, { data: { from: 'topics', to: 'announcements' } });
  console.log('move →', mv.status(), await mv.text());
  const again = await page.request.post(`${BASE}/api/posts/move/${id}`, { data: { from: 'topics', to: 'announcements' } });
  console.log('retry (source gone) →', again.status(), await again.text());
  const oldGet = await page.request.get(`${BASE}/topics/${id}`, { maxRedirects: 0 });
  console.log('old url →', oldGet.status(), '(302 expected only after Task 4)');
  const del = await page.request.delete(`${BASE}/api/announcements/delete/${id}`); console.log('cleanup', del.status());
  await browser.close();
})().catch((e) => { console.error(e.message.split('\n')[0]); process.exit(1); });
```

Expected: `create 201`/`200` with an id; `same collection → 400`; `move → 200 {"collection":"announcements","href":"/announcements/<id>"}`; `retry → 404 {"error":"Post not found"}` (the endpoint's own `findOne` in `from` runs before `movePost`, so a completed move reads as not-found at the API layer — that is fine, the client only calls once); `cleanup 200`. Stop the server: `fuser -k 4655/tcp`.

- [ ] **Step 4: Gates + commit**

tsc ≤ 26.

```bash
git add src/schemas/forum.schema.ts src/pages/api/posts/move/\[id\].ts
git commit -m "feat(forum): POST /api/posts/move/[id] changes a post's kind (author or admin, edit gate)"
```

---

### Task 4: Detail pages redirect a moved id

**Files:**
- Modify: `src/pages/topics/[id].astro:36-39`
- Modify: `src/pages/announcements/[id].astro` (the `if (!doc)` block)
- Modify: `src/pages/recommendations/[id].astro` (the `if (!doc)` block)

**Interfaces:**
- Consumes (Task 1/2): `locatePost(db, id, exclude)`, `hrefForPost`.

Why 302 and not 301: browsers cache a 301. If a post is moved back later, `/topics/x → /announcements/x` would be served from cache while the server now says `/announcements/x → /topics/x`, a loop. 302 is re-checked every time.

- [ ] **Step 1: topics/[id].astro**

Add to the imports:

```ts
import { locatePost } from '../../lib/forum/movePost';
import { hrefForPost } from '../../lib/forum/postKind';
```

Replace

```ts
if (!topicDoc) {
  // Either non-existent or filtered out by moderation. 404 via Astro.
  return new Response('Not found', { status: 404 });
}
```

with

```ts
if (!topicDoc) {
  // The author may have changed the post's kind (cross-collection move,
  // src/lib/forum/movePost.ts) — old links must keep working. 302, never
  // 301: a cached 301 would loop if the post is ever moved back.
  const elsewhere = await locatePost(db, id, 'topics');
  if (elsewhere) return Astro.redirect(hrefForPost(elsewhere, id), 302);
  // Either non-existent or filtered out by moderation. 404 via Astro.
  return new Response('Not found', { status: 404 });
}
```

- [ ] **Step 2: announcements/[id].astro and recommendations/[id].astro**

Same two imports (same relative paths). Replace their `if (!doc) { … return new Response('Not found', { status: 404 }); }` block with the identical code, using `doc` instead of `topicDoc` and passing `'announcements'` / `'recommendations'` respectively as the `exclude` argument:

```ts
if (!doc) {
  // See topics/[id].astro — moved post → 302 to its new collection.
  const elsewhere = await locatePost(db, id, 'announcements'); // 'recommendations' in the other file
  if (elsewhere) return Astro.redirect(hrefForPost(elsewhere, id), 302);
  return new Response('Not found', { status: 404 });
}
```

Note: the lookup is existence-only. The moderation visibility filter is applied by the page the redirect lands on, so a hidden post still ends in a 404 there.

- [ ] **Step 3: Verify**

Start `pnpm dev --port 4655`, re-run `node scratchpad/move-api.cjs` from Task 3. Expected now: `old url → 302` and, adding `console.log(oldGet.headers()['location'])`, `/announcements/<id>`. Also `curl -sI http://localhost:4655/topics/000000000000000000000000 | head -1` → `404`. Stop the server.

- [ ] **Step 4: Gates + commit**

tsc ≤ 26.

```bash
git add src/pages/topics/\[id\].astro src/pages/announcements/\[id\].astro src/pages/recommendations/\[id\].astro
git commit -m "feat(forum): detail pages 302 to a post's new collection after a kind change"
```

---

### Task 5: Kind chips in edit mode

**Files:**
- Modify: `src/lib/kiosk-i18n.ts` (DE after `'edit.confirm.discard'` ≈ line 409; EN after `'edit.confirm.discard'` ≈ line 2338)
- Modify: `src/components/forum/kiosk/ForumPostDetail.svelte` (script: imports, state, `isDirty`, `enterEdit`, `saveEdit`; template: block after the title `<input>` ≈ line 611)

**Interfaces:**
- Consumes (Task 1): `collectionForKind`, `PostKind`; (Task 3): `POST /api/posts/move/[id]` contract above.
- Produces: nothing downstream.

- [ ] **Step 1: i18n keys**

DE (insert after `'edit.confirm.discard': 'Änderungen verwerfen?',`):

```ts
  // Kind change inside edit mode (type cards like the compose screen).
  'edit.kind.label': 'ART',
  'edit.kind.hint': 'Beim Speichern wandert der Post in die neue Rubrik – die Adresse ändert sich, der alte Link leitet weiter.',
  'edit.kind.blocked': 'Text gespeichert. Die Art lässt sich erst ändern, wenn die Prüfung abgeschlossen ist.',
  'edit.kind.failed': 'Art ändern fehlgeschlagen.',
```

EN (insert after `'edit.confirm.discard': 'Discard changes?',`):

```ts
  'edit.kind.label': 'TYPE',
  'edit.kind.hint': 'Saving moves the post to its new section – the address changes, the old link redirects.',
  'edit.kind.blocked': 'Text saved. The type can be changed once the review is done.',
  'edit.kind.failed': 'Changing the type failed.',
```

- [ ] **Step 2: Script changes in ForumPostDetail.svelte**

Add import (next to the other lib imports):

```ts
import { collectionForKind, type PostKind } from '../../../lib/forum/postKind';
```

After the `chipLabel` derived (≈ line 121) add the chip catalogue — the same three cards as `ComposeForm.svelte`'s `types`, reusing its i18n keys:

```ts
  // Kind cards for edit mode — same three as the compose screen's type
  // selector (ComposeForm.svelte `types`), same i18n keys, same colour vars.
  const EDIT_KINDS: {
    k: PostKind;
    labelKey: 'compose.type.discussion' | 'compose.type.recommendation' | 'compose.type.announcement';
    colorVar: string;
  }[] = [
    { k: 'discussion',     labelKey: 'compose.type.discussion',     colorVar: '--k-wine' },
    { k: 'recommendation', labelKey: 'compose.type.recommendation', colorVar: '--k-moss' },
    { k: 'announcement',   labelKey: 'compose.type.announcement',   colorVar: '--k-teal' }
  ];
  // Official announcements never change kind (admin dashboard + pin lifecycle).
  const canChangeKind = $derived(!(kind === 'announcement' && isOfficial));
```

Edit state: after `let editBody = $state('');` add

```ts
  let editKind = $state<PostKind>('discussion');
```

Replace the `isDirty` derived with

```ts
  const isDirty = $derived(
    editing &&
      (editTitle !== topic.title ||
        editBody !== (topic.body ?? topic.description ?? '') ||
        editKind !== kind)
  );
```

In `enterEdit()` add `editKind = kind;` after `editBody = …;`.

Replace `saveEdit()` entirely:

```ts
  async function saveEdit() {
    if (saving) return;
    if (editTitle.trim().length < 5 || editBody.trim().length < 10) {
      editError = 'Titel mind. 5, Text mind. 10 Zeichen.';
      return;
    }
    const textDirty =
      editTitle !== topic.title || editBody !== (topic.body ?? topic.description ?? '');
    const kindDirty = editKind !== kind;
    saving = true;
    editError = null;
    let navigating = false;
    try {
      // 1. Text first, against the CURRENT collection (the edit endpoint is
      //    per collection and the post is still there).
      if (textDirty) {
        const res = await fetch(`/api/${collectionType}/edit/${topic._id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            title: editTitle.trim(),
            body: editBody.trim(),
            tags: topic.tags ?? [],
            images: topic.images ?? []
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || 'Speichern fehlgeschlagen.');
        }
        const json = await res.json();
        topic = { ...topic, ...json.topic };
      }
      // 2. Kind change = cross-collection move; the post gets a new URL, so
      //    this island (fetch URLs keyed on collectionType) hands over via a
      //    hard navigation instead of re-keying itself in place.
      if (kindDirty) {
        const res = await fetch(`/api/posts/move/${topic._id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ from: collectionType, to: collectionForKind(editKind) })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          // An edit that just went back to `pending` (AI flag) locks the
          // move — the text IS saved, say so instead of a bare error.
          throw new Error(
            err.error === 'edit_blocked_by_moderation'
              ? ($t['edit.kind.blocked'] as string)
              : err.error || ($t['edit.kind.failed'] as string)
          );
        }
        const json = await res.json();
        navigating = true;
        if (typeof window !== 'undefined') window.location.href = json.href;
        return;
      }
      editing = false;
    } catch (err) {
      editError = err instanceof Error ? err.message : 'Speichern fehlgeschlagen.';
    } finally {
      if (!navigating) saving = false; // keep the buttons locked while the new page loads
    }
  }
```

- [ ] **Step 3: Template — the chip row**

Directly after the title `{#if editing} <input … bind:value={editTitle} … /> {:else} <h1>…</h1> {/if}` block, add:

```svelte
      {#if editing && canChangeKind}
        <div class="mb-4">
          <p class="font-dmmono text-[10px] uppercase tracking-[0.1em] text-ink-mute mb-1.5">
            {$t['edit.kind.label']}
          </p>
          <div class="flex flex-wrap gap-2" role="radiogroup" aria-label={$t['edit.kind.label']}>
            {#each EDIT_KINDS as opt (opt.k)}
              {@const active = editKind === opt.k}
              <button
                type="button"
                role="radio"
                aria-checked={active}
                disabled={saving}
                onclick={() => (editKind = opt.k)}
                class={`min-h-[44px] px-3.5 py-2 rounded-md border-[1.5px] font-bricolage font-bold text-[13px] tracking-tight transition-colors duration-[180ms] ease-out ${
                  active ? 'text-paper border-transparent' : 'bg-paper-warm text-ink border-ink hover:bg-paper-soft'
                }`}
                style={active ? `background:var(${opt.colorVar});border-color:var(${opt.colorVar});` : ''}
              >
                {$t[opt.labelKey]}
              </button>
            {/each}
          </div>
          {#if editKind !== kind}
            <p class="font-dmmono text-[10px] leading-[1.6] text-ink-mute mt-1.5 max-w-prose">
              {$t['edit.kind.hint']}
            </p>
          {/if}
        </div>
      {/if}
```

- [ ] **Step 4: Browser verification (desktop + mobile)**

Start `pnpm dev --port 4655`. `scratchpad/move-kind.cjs`, run with `NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/move-kind.cjs`:

```js
// UI check: edit mode shows kind cards; picking Ankündigung + save lands on /announcements/<id>; old URL 302s.
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const BASE = process.env.BASE_URL || 'http://localhost:4655';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${BASE}/login?redirect=%2Fforum`);
  await page.fill('input[type="email"]', 'admin@mahalle-dev.test');
  await page.fill('input[type="password"]', fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim());
  await page.click('button[type="submit"]');
  await page.waitForURL('**/forum', { timeout: 20000 });
  const c = await page.request.post(`${BASE}/api/topics/create`, { data: { title: 'Move-Probe Diskussion', body: 'Testkörper für den Art-Wechsel in der Dev-Datenbank.', tags: ['test'] } });
  const id = (await c.json()).topic?._id; console.log('create', c.status(), id);
  await page.goto(`${BASE}/topics/${id}`);
  await page.getByRole('button', { name: /Bearbeiten/ }).click();
  const radios = page.getByRole('radio');
  console.log('kind cards', await radios.count(), 'checked', await page.getByRole('radio', { checked: true }).textContent());
  await page.getByRole('radio', { name: /Ankündigung|Announcement/ }).click();
  await page.screenshot({ path: 'scratchpad/move-kind-edit.png' });
  const save = page.locator('aside').getByRole('button', { name: /^speichern$|^save$/ });
  await Promise.all([page.waitForURL(`**/announcements/${id}`, { timeout: 15000 }), save.click()]);
  console.log('after save', page.url());
  await page.waitForSelector('h1');
  await page.screenshot({ path: 'scratchpad/move-kind-after.png' });
  console.log('chip', (await page.locator('main').getByText(/ANKÜNDIGUNG|ANNOUNCEMENT/).first().textContent()).trim());
  const old = await page.request.get(`${BASE}/topics/${id}`, { maxRedirects: 0 });
  console.log('old url', old.status(), old.headers()['location']);
  // Mobile: chips reachable and ≥44px
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() });
  await m.goto(`${BASE}/announcements/${id}`);
  await m.getByRole('button', { name: /Bearbeiten/ }).click();
  const box = await m.getByRole('radio').first().boundingBox();
  console.log('mobile chip height', box && Math.round(box.height));
  await m.screenshot({ path: 'scratchpad/move-kind-mobile.png' });
  const del = await page.request.delete(`${BASE}/api/announcements/delete/${id}`); console.log('cleanup', del.status());
  await browser.close();
})().catch((e) => { console.error(e.message.split('\n')[0]); process.exit(1); });
```

Expected: `kind cards 3 checked Diskussion`; `after save http://localhost:4655/announcements/<id>`; `chip ANKÜNDIGUNG`; `old url 302 /announcements/<id>`; `mobile chip height ≥ 44`; `cleanup 200`. Screenshots in `scratchpad/` for the user to look at before merge. Stop the server: `fuser -k 4655/tcp`.

- [ ] **Step 5: Gates + commit**

tsc ≤ 26, svelte-check ≤ 92.

```bash
git add src/lib/kiosk-i18n.ts src/components/forum/kiosk/ForumPostDetail.svelte
git commit -m "feat(forum): change a post's kind from edit mode (type cards, move, redirect to new URL)"
```

---

### Task 6: Docs

**Files:**
- Modify: `src/components/forum/kiosk/CLAUDE.md` (append a bullet under „### Edit lockout during moderation")
- Modify: root `CLAUDE.md` (Database Collections → the `announcements` bullet; and the „Forum patterns" pointer is enough otherwise)

- [ ] **Step 1: Forum area notes**

Append after the `**UI mirror**` bullet of „### Edit lockout during moderation":

```markdown
### Kind change in edit mode (2026-09-13)
- Edit mode shows the compose screen's three type cards (`EDIT_KINDS` in `ForumPostDetail.svelte`, same `compose.type.*` keys). Save = text edit against the current collection, then `POST /api/posts/move/[id]` `{ from, to }`, then a HARD navigation to the returned `href` — the island's fetch URLs are keyed on `collectionType`, so it does not re-key itself in place.
- A kind is a collection, so a kind change is a cross-collection move: `src/lib/forum/movePost.ts` (copy-first, delete-last, idempotent — no transactions on the free tier) re-keys `flaggedContent.contentType`, `notifications.target.{contentType,href}` (href is stored) and drops `translationCache` rows; comments/likes/views/savedPosts need nothing. Naming lives in the dependency-pure `src/lib/forum/postKind.ts` (`buildMovedDoc` strips `isOfficial`/`pinnedUntil`/`editCount`/`category`, gives a recommendation `category: 'other'`, stamps `movedFrom`/`movedAt`).
- Gate = the edit gate (author, approved, no warning label) + admin; `isOfficial` announcements are refused (`403 official_announcement`).
- Old URLs keep working: all three detail pages call `locatePost()` on a miss and `302` (never 301 — a cached 301 loops if the post moves back). Known gap: `/bookmarks` still joins only `topics`, so a saved discussion that becomes an announcement leaves the Bookmarks list (pre-existing scope note in `bookmarks.astro`).
```

- [ ] **Step 2: Root CLAUDE.md**

In the `announcements` collection bullet, after „… server-controlled, never settable from client input;" insert:

```markdown
 **authors can change a post's kind from edit mode since 2026-09-13** (cross-collection move via `POST /api/posts/move/[id]`, `src/lib/forum/movePost.ts`; officials excluded; old URLs 302 — see `src/components/forum/kiosk/CLAUDE.md` „Kind change in edit mode");
```

- [ ] **Step 3: Commit**

```bash
git add src/components/forum/kiosk/CLAUDE.md CLAUDE.md
git commit -m "docs(forum): kind change in edit mode (move, gate, redirect, bookmarks gap)"
```

---

## Self-review

- **Coverage:** type cards in edit mode (T5), server move (T2), endpoint + gate (T3), old links (T4), officials excluded (T3 + `canChangeKind` in T5), naming in one place (T1), docs (T6). Bookmarks gap is documented, not fixed (ruled out of scope in chat).
- **Ordering:** T3's own `findOne` in `from` makes a second call after a completed move read as 404 at the API; the client calls once and hard-navigates, and `movePost` itself is idempotent for the crash-retry case. Documented in T3 Step 3.
- **Type consistency:** `PostKind`/`PostCollection` names, `movePost(db, { id, from, to, now? })`, `locatePost(db, id, exclude)`, `hrefForPost(c, id)` used identically in T2–T5. i18n keys `edit.kind.label|hint|blocked|failed` in T5 only.
- **Placeholders:** none; every code step is complete.
