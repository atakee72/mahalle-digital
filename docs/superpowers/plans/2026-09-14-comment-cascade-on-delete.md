# Comment Cascade on Post Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deleting any forum post, event or official announcement removes its comment thread and marks reported comments as deleted in the moderation queue, and a one-shot script removes the orphaned threads that earlier deletes left behind.

**Architecture:** One dependency-pure helper `deleteCommentsForPost(db, postId)` in `src/lib/comments/cascade.ts` (same `Pick<Db,'collection'>` shape as `src/lib/forum/movePost.ts`, unit-tested against an in-memory fake Db) replaces the five hand-written cascade blocks. Two of those blocks are wrong today (`announcements` and `recommendations` self-delete filter on a `topic` field no comment has ever had — comments store the parent as `relevantPostId`), one is missing (admin DELETE of official announcements), two are right (`topics`, `events`). The helper also stamps `flaggedContent.contentDeleted` on reported comments in the thread, matching the 2026-09-08 „self-delete keeps the report" rule that the comment self-delete route already follows. A separate dry-run/apply script cleans up existing orphans; the user runs it against prod.

**Tech Stack:** Astro API routes, MongoDB driver (no Mongoose), node:test via `npx tsx`, playwright probe against the dev server.

**Spec:** No separate spec. Requirements: root `CLAUDE.md` „Content Moderation → Self-delete keeps the report (2026-09-08)" and the `comments` collection bullet; the comment document shape in `src/pages/api/comments/create.ts:59-69` (`relevantPostId: new ObjectId(topicId)`); the existing correct cascade in `src/pages/api/topics/delete/[id].ts:66-68`.

## Global Constraints

- Comments reference their parent ONLY via `relevantPostId` (an `ObjectId`; the dev DB has 0 string-typed values and 0 legacy `topic` fields — verified 2026-09-14). Filter on `{ relevantPostId: new ObjectId(postId) }`, nothing else.
- Reported/flagged comments must NOT lose their queue record: stamp `flaggedContent` `{ contentType: 'comment', contentId: <comment id string> }` with `{ contentDeleted: true, contentDeletedAt: new Date() }` — exactly the shape `src/pages/api/comments/delete/[commentId].ts:77-80` uses. Never delete `flaggedContent` rows.
- `src/lib/comments/cascade.ts` must be dependency-pure except for `mongodb` types/`ObjectId` (no `connectDB` import) so it is unit-testable with a fake Db, like `src/lib/forum/movePost.ts`.
- Order inside the helper: read comment ids → delete comments → stamp flags. Idempotent: a second call finds nothing and returns zeros.
- The five delete routes keep their existing auth/ownership/moderation behaviour unchanged; only the cascade block changes.
- Gates: `pnpm type-check` ≤ 26 errors, `npx -y svelte-check@4` ≤ 92 errors (both AT budget). Unit tests: `npx tsx src/lib/comments/cascade.test.ts` must print `ℹ fail 0`.
- Commit messages: one line, no signature, no `Co-Authored-By`. Only `git add` the named files.
- Prod DB writes are the USER's: the cleanup script is written and dry-run-tested on the dev DB only; never run it with `--apply` against anything but `mahalle-dev` in this plan. `scripts/seed-dev-db.ts` shows the „refuse a db name without dev" interlock — the cleanup script must NOT have that interlock (it is meant for prod), but it must default to dry-run and print the db name first.
- Never print `scratchpad/devpw.txt`; read it straight into `page.fill()`; fill the password LAST and never screenshot while it is filled. Dev server on port 4655 only; `fuser -k 4655/tcp` afterwards.

---

### Task 1: `deleteCommentsForPost` helper with unit tests

**Files:**
- Create: `src/lib/comments/cascade.ts`
- Create: `src/lib/comments/cascade.test.ts`

**Interfaces:**
- Consumes: `ObjectId` from `mongodb`.
- Produces: `export type CascadeDb = Pick<Db, 'collection'>`; `export async function deleteCommentsForPost(db: CascadeDb, postId: string): Promise<{ deletedComments: number; flaggedMarked: number }>`. Task 2 wires it into five routes; Task 3 reuses only the filter shape.

- [ ] **Step 1: Write the failing test**

Create `src/lib/comments/cascade.test.ts`:

```ts
// Unit tests for the comment cascade on post delete, against an in-memory fake Db.
// Run directly:  npx tsx src/lib/comments/cascade.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { deleteCommentsForPost } from './cascade';

type Doc = Record<string, any>;
const get = (doc: Doc, path: string) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
// Exact-match filters plus `$in` (the two shapes the helper uses); ObjectIds compare by string.
const matchesValue = (actual: unknown, expected: unknown) =>
  expected && typeof expected === 'object' && '$in' in (expected as Doc)
    ? (expected as Doc).$in.some((v: unknown) => String(actual) === String(v))
    : String(actual) === String(expected);
const matches = (doc: Doc, f: Doc) => Object.entries(f).every(([k, v]) => matchesValue(get(doc, k), v));

function fakeDb() {
  const store = new Map<string, Doc[]>();
  const collection = (name: string) => {
    if (!store.has(name)) store.set(name, []);
    const docs = store.get(name)!;
    return {
      find(f: Doc, _opts?: Doc) {
        const hits = docs.filter((d) => matches(d, f));
        return { async toArray() { return hits.map((d) => ({ _id: d._id })); } };
      },
      async deleteMany(f: Doc) {
        let deletedCount = 0;
        for (let i = docs.length - 1; i >= 0; i--) if (matches(docs[i], f)) { docs.splice(i, 1); deletedCount++; }
        return { deletedCount };
      },
      async updateMany(f: Doc, u: { $set: Doc }) {
        let modifiedCount = 0;
        for (const d of docs) if (matches(d, f)) { Object.assign(d, u.$set); modifiedCount++; }
        return { modifiedCount };
      },
    };
  };
  return { db: { collection } as any, store };
}

function seed() {
  const { db, store } = fakeDb();
  const post = new ObjectId();
  const other = new ObjectId();
  const c1 = new ObjectId(), c2 = new ObjectId(), c3 = new ObjectId();
  store.set('comments', [
    { _id: c1, relevantPostId: post, body: 'one' },
    { _id: c2, relevantPostId: post, body: 'two' },
    { _id: c3, relevantPostId: other, body: 'elsewhere' },
  ]);
  store.set('flaggedContent', [
    { contentType: 'comment', contentId: c1.toHexString(), status: 'pending' },
    { contentType: 'comment', contentId: c3.toHexString(), status: 'pending' },
    { contentType: 'topic', contentId: post.toHexString(), status: 'pending' },
  ]);
  return { db, store, post, other, c1, c2, c3 };
}

test('deletes exactly the comments of the given post', async () => {
  const { db, store, post, other } = seed();
  const r = await deleteCommentsForPost(db, post.toHexString());
  assert.equal(r.deletedComments, 2);
  const left = store.get('comments')!;
  assert.equal(left.length, 1);
  assert.equal(String(left[0].relevantPostId), String(other));
});

test('stamps contentDeleted on flagged comments of the thread only', async () => {
  const { db, store, post, c1, c3 } = seed();
  const r = await deleteCommentsForPost(db, post.toHexString());
  assert.equal(r.flaggedMarked, 1);
  const flags = store.get('flaggedContent')!;
  const f1 = flags.find((f) => f.contentId === c1.toHexString())!;
  assert.equal(f1.contentDeleted, true);
  assert.ok(f1.contentDeletedAt instanceof Date);
  assert.equal(flags.find((f) => f.contentId === c3.toHexString())!.contentDeleted, undefined);
  assert.equal(flags.find((f) => f.contentType === 'topic')!.contentDeleted, undefined);
  assert.equal(flags.length, 3, 'never deletes flaggedContent rows');
});

test('is idempotent and safe on a post without comments', async () => {
  const { db, post } = seed();
  await deleteCommentsForPost(db, post.toHexString());
  const again = await deleteCommentsForPost(db, post.toHexString());
  assert.deepEqual(again, { deletedComments: 0, flaggedMarked: 0 });
  const none = await deleteCommentsForPost(db, new ObjectId().toHexString());
  assert.deepEqual(none, { deletedComments: 0, flaggedMarked: 0 });
});

test('rejects an invalid post id without touching the db', async () => {
  const { db, store } = seed();
  await assert.rejects(() => deleteCommentsForPost(db, 'not-an-id'), /invalid post id/i);
  assert.equal(store.get('comments')!.length, 3);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx src/lib/comments/cascade.test.ts 2>&1 | tail -5`
Expected: fails to import `./cascade` (module not found).

- [ ] **Step 3: Write the helper**

Create `src/lib/comments/cascade.ts`:

```ts
// src/lib/comments/cascade.ts — delete a post's comment thread when the post
// is deleted. Dependency-pure apart from the mongodb driver types (never
// imports connectDB) so it is unit-testable against a fake Db.
//
// Comments reference their parent ONLY via `relevantPostId` (ObjectId) —
// see src/pages/api/comments/create.ts. Two self-delete routes used to filter
// on a `topic` field that no comment ever had (announcements,
// recommendations), and the admin delete of official announcements never
// cascaded at all — every one of those left an orphaned thread behind.
//
// Reported comments keep their moderation-queue record, marked deleted
// (same shape as the comment self-delete route, "self-delete keeps the
// report", 2026-09-08). flaggedContent rows are never deleted here.
import { ObjectId, type Db } from 'mongodb';

export type CascadeDb = Pick<Db, 'collection'>;

export interface CascadeResult {
  deletedComments: number;
  flaggedMarked: number;
}

export async function deleteCommentsForPost(db: CascadeDb, postId: string): Promise<CascadeResult> {
  if (!ObjectId.isValid(postId)) throw new Error(`deleteCommentsForPost: invalid post id "${postId}"`);
  const parent = new ObjectId(postId);
  const comments = db.collection('comments');

  // Ids first: the flag stamp needs them after the rows are gone.
  const ids = (await comments.find({ relevantPostId: parent }, { projection: { _id: 1 } }).toArray())
    .map((c) => String(c._id));
  if (ids.length === 0) return { deletedComments: 0, flaggedMarked: 0 };

  const del = await comments.deleteMany({ relevantPostId: parent });

  const flagged = await db.collection('flaggedContent').updateMany(
    { contentType: 'comment', contentId: { $in: ids } },
    { $set: { contentDeleted: true, contentDeletedAt: new Date() } }
  );

  return { deletedComments: del.deletedCount ?? 0, flaggedMarked: flagged.modifiedCount ?? 0 };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx src/lib/comments/cascade.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ pass 4` and `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/comments/cascade.ts src/lib/comments/cascade.test.ts
git commit -m "feat(comments): deleteCommentsForPost helper with flag stamping"
```

---

### Task 2: Wire the helper into all five delete routes + dev probe

**Files:**
- Modify: `src/pages/api/announcements/delete/[id].ts:65-67` (the bug)
- Modify: `src/pages/api/recommendations/delete/[id].ts:65-67` (the bug)
- Modify: `src/pages/api/admin/announcements/[id].ts:125` (missing cascade)
- Modify: `src/pages/api/topics/delete/[id].ts:66-68` (was correct; unify)
- Modify: `src/pages/api/events/delete/[id].ts:65-67` (was correct; unify)
- Modify: `CLAUDE.md:175` (the `comments` collection bullet)
- Probe (gitignored, not committed): `scratchpad/cascade-probe.cjs`

**Interfaces:**
- Consumes: `deleteCommentsForPost(db, postId)` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Reproduce the bug on the dev server (the failing test)**

Write `scratchpad/cascade-probe.cjs`. Admin skips moderation, so creates are instant.

```js
// Probe: deleting an announcement / recommendation / topic removes its comments.
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const BASE = process.env.BASE_URL || 'http://localhost:4655';
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE}/login?redirect=%2Fforum`);
  await page.fill('input[type="email"]', 'admin@mahalle-dev.test');
  await page.fill('input[type="password"]', fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim());
  await page.click('button[type="submit"]');
  await page.waitForURL('**/forum', { timeout: 20000 });
  const api = page.request;
  const count = async (id) => { const r = await api.get(`${BASE}/api/comments/${id}`); const j = await r.json(); return Array.isArray(j) ? j.length : (j.comments?.length ?? -1); };
  const kinds = [
    { kind: 'announcements', create: '/api/announcements/create', body: { title: 'Cascade-Probe Anno', body: 'Kommentare müssen mit dem Beitrag verschwinden.', tags: ['test'] } },
    { kind: 'recommendations', create: '/api/recommendations/create', body: { title: 'Cascade-Probe Tipp', body: 'Kommentare müssen mit dem Beitrag verschwinden.', category: 'other', tags: ['test'] } },
    { kind: 'topics', create: '/api/topics/create', body: { title: 'Cascade-Probe Thema', body: 'Kommentare müssen mit dem Beitrag verschwinden.', tags: ['test'] } },
  ];
  let failed = false;
  for (const k of kinds) {
    const c = await api.post(`${BASE}${k.create}`, { data: k.body });
    const j = await c.json(); const id = (j.topic ?? j.announcement ?? j.recommendation ?? j)._id;
    if (c.status() >= 300 || !id) { console.log(k.kind, 'create failed', c.status(), JSON.stringify(j).slice(0, 200)); failed = true; continue; }
    for (const n of [1, 2]) await api.post(`${BASE}/api/comments/create`, { data: { body: `Kommentar ${n}`, topicId: id, collectionType: k.kind } });
    const before = await count(id);
    const d = await api.delete(`${BASE}/api/${k.kind}/delete/${id}`);
    const after = await count(id);
    console.log(`${k.kind}: comments before=${before} delete=${d.status()} after=${after}`);
    if (before !== 2 || after !== 0) failed = true;
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e.message.split('\n')[0]); process.exit(1); });
```

Shapes verified 2026-09-14: `GET /api/comments/[postId]` returns `{ comments, count }`; creates return `{ topic }` / `{ announcement }` / `{ recommendation }`; `RecommendationCreateSchema.category` accepts `'other'`. If a create is still rejected (400 with a Zod message), read the schema in `src/schemas/forum.schema.ts` and adapt the body; never change a schema.

Run:

```bash
(pnpm dev --port 4655 > scratchpad/dev-4655.log 2>&1 &)
for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code}" http://localhost:4655/login | grep -q 200 && break; sleep 2; done
NODE_PATH=$(npm root -g)/@playwright/cli/node_modules node scratchpad/cascade-probe.cjs
```

Expected BEFORE the fix: `announcements: … after=2` and `recommendations: … after=2` (orphans), `topics: … after=0`; exit code 1. NOTE: the two orphaned pairs this run leaves in the dev DB are cleaned by Task 3's script (its dry-run must list them).

- [ ] **Step 2: Replace the cascade in the four self-delete routes**

In `src/pages/api/announcements/delete/[id].ts` and `src/pages/api/recommendations/delete/[id].ts`, replace

```ts
    // Also delete related comments
    const commentsCollection = db.collection('comments');
    await commentsCollection.deleteMany({ topic: new ObjectId(id) });
```

with

```ts
    // Cascade the comment thread (reported comments stay in the queue, marked deleted).
    await deleteCommentsForPost(db, id);
```

In `src/pages/api/topics/delete/[id].ts` and `src/pages/api/events/delete/[id].ts`, replace

```ts
    // Also delete related comments
    const commentsCollection = db.collection('comments');
    await commentsCollection.deleteMany({ relevantPostId: new ObjectId(id) });
```

with the same two lines. In all four files add the import next to the existing `connectDB` import (same directory depth, four levels up):

```ts
import { deleteCommentsForPost } from '../../../../lib/comments/cascade';
```

`id` is already validated with `ObjectId.isValid` at the top of each route, so the helper's throw cannot fire there. Leave the `flaggedContent` stamp for the POST itself (the block right after) untouched — the helper only stamps the comments' flags.

- [ ] **Step 3: Add the cascade to the admin delete of official announcements**

In `src/pages/api/admin/announcements/[id].ts` add the import (three levels up from `admin/announcements/`):

```ts
import { deleteCommentsForPost } from '../../../../lib/comments/cascade';
```

(check the file's existing relative imports for the exact depth — `src/pages/api/admin/announcements/[id].ts` → `src/lib` is `../../../../lib`), and replace

```ts
    await collection.deleteOne({ _id: new ObjectId(id) });
```

with

```ts
    await collection.deleteOne({ _id: new ObjectId(id) });
    // Officials can be commented like any announcement — cascade the thread.
    await deleteCommentsForPost(db, id);
```

- [ ] **Step 4: Re-run the probe**

```bash
NODE_PATH=$(npm root -g)/@playwright/cli/node_modules node scratchpad/cascade-probe.cjs
```

Expected AFTER: all three lines `before=2 delete=200 after=0`, exit 0. Then verify the admin path once with the same session: create an official via `POST /api/admin/announcements/create` (body per `src/schemas/forum.schema.ts`'s admin schema — read it), add one comment with `collectionType: 'announcements'`, `DELETE /api/admin/announcements/<id>`, `count(id)` must be 0. Add these lines to the probe or run them as a second small script; record the output in the report.

- [ ] **Step 5: Gates**

```bash
pnpm type-check 2>&1 | grep -c "error TS"          # expected: 26
npx -y svelte-check@4 > scratchpad/svelte-check.log 2>&1; tail -1 scratchpad/svelte-check.log   # … 92 ERRORS …
npx tsx src/lib/comments/cascade.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"   # pass 4, fail 0
fuser -k 4655/tcp
```

- [ ] **Step 6: Docs**

In root `CLAUDE.md` line 175 replace

```
- `comments` - Comments on posts (includes `moderationStatus` field)
```

with

```
- `comments` - Comments on posts (includes `moderationStatus` field). Parent link is `relevantPostId` (ObjectId) ONLY. Deleting a post cascades its thread through `deleteCommentsForPost()` (`src/lib/comments/cascade.ts`) from all five delete routes (topics/events/announcements/recommendations self-delete + admin official delete) since 2026-09-14 — before that, announcement/recommendation deletes filtered on a nonexistent `topic` field and the admin route never cascaded, orphaning threads (cleanup: `scripts/cleanup-orphan-comments.ts`). Reported comments in a deleted thread keep their `flaggedContent` row, stamped `contentDeleted`.
```

- [ ] **Step 7: Commit**

```bash
git add 'src/pages/api/announcements/delete/[id].ts' 'src/pages/api/recommendations/delete/[id].ts' 'src/pages/api/admin/announcements/[id].ts' 'src/pages/api/topics/delete/[id].ts' 'src/pages/api/events/delete/[id].ts' CLAUDE.md
git commit -m "fix(comments): cascade the thread on every post delete (announcements, recommendations, admin officials)"
git log -1 --format=%B
```

---

### Task 3: Orphan cleanup script (dry-run default, user-run in prod)

**Files:**
- Create: `scripts/cleanup-orphan-comments.ts`
- Modify: `docs/runbooks/` — Create: `docs/runbooks/orphan-comments-cleanup.md`

**Interfaces:**
- Consumes: nothing from Tasks 1–2 (standalone; uses the driver directly like `scripts/backfill-news-entities.ts`).
- Produces: the runbook the user follows against prod.

- [ ] **Step 1: Write the script**

Create `scripts/cleanup-orphan-comments.ts`:

```ts
// scripts/cleanup-orphan-comments.ts
// Run (dry-run, default): pnpm tsx scripts/cleanup-orphan-comments.ts
// Run (write):            pnpm tsx scripts/cleanup-orphan-comments.ts --apply
//
// ONE-SHOT cleanup: comments whose parent post no longer exists in ANY of
// topics / announcements / recommendations / events. Until 2026-09-14 the
// announcement + recommendation self-delete routes filtered comments on a
// `topic` field no comment has, and the admin delete of official
// announcements never cascaded — each such delete orphaned its thread.
// Orphans are invisible in the UI (no parent page renders them) but still
// count in per-user stats and clutter admin tooling.
//
// Reported orphans keep their flaggedContent row, stamped contentDeleted
// (same rule as a live delete). Default is dry-run: it prints what it would
// remove. Reads MONGODB_URI from .env — point it at prod deliberately.
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

const PARENTS = ['topics', 'announcements', 'recommendations', 'events'] as const;

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI missing'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const dbName = new URL(uri).pathname.slice(1) || 'mahalle-dev';
  const db = client.db(dbName);
  console.log(`db=${dbName}  mode=${apply ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);

  const comments = db.collection('comments');
  const parentIds = await comments.distinct('relevantPostId');
  const orphanParents: ObjectId[] = [];
  const unparseable: unknown[] = [];
  for (const raw of parentIds) {
    const oid = raw instanceof ObjectId ? raw : (typeof raw === 'string' && ObjectId.isValid(raw) ? new ObjectId(raw) : null);
    if (!oid) { unparseable.push(raw); continue; }
    const hits = await Promise.all(PARENTS.map((n) => db.collection(n).countDocuments({ _id: oid }, { limit: 1 })));
    if (!hits.some(Boolean)) orphanParents.push(oid);
  }
  console.log(`${parentIds.length} distinct parents referenced, ${orphanParents.length} no longer exist, ${unparseable.length} unparseable ids (left alone: ${JSON.stringify(unparseable)})`);

  let total = 0;
  for (const oid of orphanParents) {
    const rows = await comments.find({ relevantPostId: oid }, { projection: { _id: 1, createdAt: 1 } }).toArray();
    total += rows.length;
    console.log(`  parent ${oid.toHexString()}: ${rows.length} comment(s)` + (rows[0]?.createdAt ? `, oldest ${new Date(rows[0].createdAt).toISOString().slice(0, 10)}` : ''));
    if (!apply) continue;
    const ids = rows.map((r) => String(r._id));
    const del = await comments.deleteMany({ relevantPostId: oid });
    const flagged = await db.collection('flaggedContent').updateMany(
      { contentType: 'comment', contentId: { $in: ids } },
      { $set: { contentDeleted: true, contentDeletedAt: new Date() } }
    );
    console.log(`    deleted ${del.deletedCount}, flagged rows marked ${flagged.modifiedCount}`);
  }
  console.log(`${apply ? 'Deleted' : 'Would delete'} ${total} orphaned comment(s).`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry-run against the dev DB**

Run: `pnpm tsx scripts/cleanup-orphan-comments.ts 2>&1 | grep -v "npm warn"`
Expected: `db=mahalle-dev  mode=DRY-RUN`, at least the 3 orphaned parents that existed on 2026-09-14 plus the 2 pairs Task 2's first probe run left (announcement + recommendation), `Would delete N`. Record the exact output in the report.

- [ ] **Step 3: Apply against the dev DB, then re-run dry-run**

```bash
pnpm tsx scripts/cleanup-orphan-comments.ts --apply 2>&1 | grep -v "npm warn"
pnpm tsx scripts/cleanup-orphan-comments.ts 2>&1 | grep -v "npm warn" | tail -1
```

Expected: second dry-run prints `Would delete 0 orphaned comment(s).` (dev DB only — `MONGODB_URI` in `.env` points at `mahalle-dev`; confirm the printed `db=` line before `--apply`).

- [ ] **Step 4: Runbook**

Create `docs/runbooks/orphan-comments-cleanup.md`:

```markdown
# Orphaned comments cleanup (one-shot, 2026-09-14)

**Why:** until `fix(comments): cascade the thread on every post delete` (2026-09-14), deleting an announcement or recommendation filtered comments on a `topic` field no comment has (`relevantPostId` is the real link), and the admin delete of official announcements never cascaded. Every such delete left its comment thread behind, invisible but present.

**What the script does:** `scripts/cleanup-orphan-comments.ts` lists every `relevantPostId` that exists in none of `topics` / `announcements` / `recommendations` / `events`, and (with `--apply`) deletes those comments and stamps their `flaggedContent` rows `contentDeleted` (never deletes flag rows). Dry-run by default.

**Prod run (user only — prod `MONGODB_URI` is a Vercel Sensitive var):**
1. Temporarily point `MONGODB_URI` in `.env` at prod (or `MONGODB_URI=<prod> pnpm tsx …` inline).
2. `pnpm tsx scripts/cleanup-orphan-comments.ts` — check the `db=mahalle` line and the per-parent list.
3. `pnpm tsx scripts/cleanup-orphan-comments.ts --apply`
4. Re-run the dry-run: expect `Would delete 0`.
5. Restore `.env` to `mahalle-dev`.

Idempotent; safe to re-run. Dev run on 2026-09-14 removed the orphans the seed + probes had produced.
```

- [ ] **Step 5: Commit**

```bash
git add scripts/cleanup-orphan-comments.ts docs/runbooks/orphan-comments-cleanup.md
git commit -m "chore(comments): one-shot orphan cleanup script + runbook"
```

---

## Self-review

- Coverage: bug fix (Task 2 Step 2), missing admin cascade (Task 2 Step 3), flag preservation (Task 1 helper + test), unification of the two correct routes (Task 2 Step 2), existing orphans (Task 3), docs (Task 2 Step 6, Task 3 Step 4).
- Placeholders: none. Response/create shapes verified against the routes and `forum.schema.ts`; the admin official-create body is bounded with an explicit read instruction.
- Type consistency: `deleteCommentsForPost(db: CascadeDb, postId: string): Promise<CascadeResult>` used identically in Tasks 1–2; `CascadeDb = Pick<Db,'collection'>` mirrors `MoveDb`.
- Out of scope, noted: comments on a post deleted by the account-deletion pipeline are unaffected (authored content stays as „Ehemaliges Mitglied"); the forum kind-move keeps `relevantPostId` so threads follow.
