# Notification purge on delete + comment-id 400 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a post, comment, listing or official announcement is deleted, the notification rows that point at it disappear with it (bell entries never lead to a 404 or a vanished comment); and `DELETE /api/comments/delete/<malformed>` answers 400 instead of 500.

**Architecture:** One dependency-pure helper, `purgeNotificationsFor(db, ids)` in `src/lib/notificationPurge.ts`, deletes every `notifications` row whose `target.contentId` OR `meta.sourceId` is in `ids` — tested against a fake Db like `src/lib/comments/cascade.ts`. The seven delete paths call it after their own delete. Because every notification about a comment (mention, `@alle` admin-hint, moderation, „replied") targets the PARENT page (`target.contentId` = post id — see `commentTarget()` in `src/lib/notifications.ts`), purging a post by `[postId]` also sweeps its whole comment thread; a single comment is purged by `[commentId]` via `meta.sourceId`. The „replied" (`type: 'comment'`) rows carry no comment id today, so the two writers gain `meta.sourceId` going forward (rows written before this change stay until a post delete or the 90-day TTL).

**Tech Stack:** Astro 5 `APIRoute`, MongoDB driver (`deleteMany` with `$or`/`$in`), `node:test` via `npx tsx --test`, Playwright (global `@playwright/cli` bundle) + `tsx` for the preview smoke.

**Spec:** No separate spec. Two findings: (1) „Comment delete leaves its notifications behind — they point at content that's gone, @alle ones included" (older review note the user quoted 2026-09-30 22:19); (2) Opus final review of `chore/ban-gate-self-delete` (2026-09-30): `comments/delete/[commentId].ts` calls `new ObjectId(commentId)` without `isValid` → 500 on a malformed id. Investigation 22:20: the four post delete routes, the listing delete and the admin official delete leave their notifications behind as well (only the account-deletion pipeline deletes notifications today, by recipient). The contract is fully stated here.

## Global Constraints

- Work on the branch `chore/notification-purge` cut from `main` (`git checkout -b chore/notification-purge main` before Task 1); never commit to `main`.
- Notification WRITES are never-throw by contract (`src/lib/notifications.ts`); the purge is a DELETE-path helper and mirrors `deleteCommentsForPost()` instead: it may throw a driver error (the route's `catch` → 500, content already gone — same as the cascade today). It never throws on an empty list or unknown ids.
- `notifications` rows are never updated by the purge, only deleted; `flaggedContent` rows are never touched.
- Match keys are STRINGS: `target.contentId` and `meta.sourceId` are stored as strings (`NotificationDoc` in `src/types/notification.ts`); pass string ids, never ObjectIds.
- No new index: the collection is 90-day TTL-bounded and small; a `$or` over two unindexed string fields is fine (state this in the helper's header comment so nobody adds one „to be safe").
- The `type: 'comment'` writers gain ONLY `meta.sourceId` — NOT `contentKind` (the panel and push copy switch on `meta.contentKind === 'comment'` for mention/admin_hint/moderation rows; a „replied" row must keep its own copy).
- Route response bodies and status codes stay as they are, except the new 400 in `comments/delete` for a malformed id: `{ error: 'Invalid comment ID' }`, status 400, `Content-Type: application/json` (the four post routes already answer `Invalid <kind> ID` this way).
- Gates: `pnpm type-check` stays at 16 errors (CI budget); no `.svelte` changes, svelte-check untouched. Existing tests must stay green: `npx tsx --test src/lib/comments/cascade.test.ts src/lib/auth/memberGate.test.ts`.
- Commit messages plain and concise, NO „Generated with Claude Code" line, NO `Co-Authored-By` trailer (user rule). Never push from a subagent; the USER merges.
- Never print any `.env` value; `scratchpad/devpw.txt` is read by the smoke only, never echoed. The seed script (Task 5) writes to the DEV database only and must refuse a database name without `dev`.

## Review Focus

1. **A member deletes their own comment that mentioned someone** → the mentioned member's bell row is gone (`meta.sourceId` = comment id) — Task 1 test „deletes by meta.sourceId"; Task 5 probe 3 pins it end-to-end on a listing id (same code path, same helper).
2. **A post with a 30-comment thread is deleted** → every row about the post AND its comments goes, including moderation rows for the comments and `@alle` hints inside comments — Task 1 test „deletes by target.contentId regardless of type"; Task 2 wires the call AFTER `deleteCommentsForPost()` so nothing depends on the comment rows still existing.
3. **Rows about OTHER content survive** (a member with ten notifications loses exactly the ones about the deleted thing) — Task 1 test „leaves unrelated rows"; Task 5 keeps a control row and asserts it survives.
4. **`DELETE /api/comments/delete/not-an-id` logged in** → 400 `Invalid comment ID`, never 500 — Task 5 probe 5; and a well-formed id that does not exist → 404 (order: id shape → gate → lookup) — probe 6.
5. **A „replied" row written BEFORE this change** (no `meta.sourceId`) is not removed by a single comment delete — accepted residue, documented in Task 4; it still disappears when the post is deleted (target.contentId) or after 90 days. No test; ruling recorded here.

---

### Task 1: The pure helper + unit tests

**Files:**
- Create: `src/lib/notificationPurge.ts`
- Create: `src/lib/notificationPurge.test.ts`
- Modify: `src/lib/comments/cascade.ts` (return type + two `return`s), `src/lib/comments/cascade.test.ts` (two expectations + one assertion)

**Interfaces:**
- Consumes: nothing from this plan; `type Db` from `mongodb` (types only).
- Produces: `export type PurgeDb = Pick<Db, 'collection'>` and `export async function purgeNotificationsFor(db: PurgeDb, ids: string[]): Promise<number>` — returns the number of deleted rows; `[]` → `0` without touching the db. Also: `CascadeResult.commentIds: string[]` on `deleteCommentsForPost()` (Step 5).

- [ ] **Step 1: Write the failing test**

`src/lib/notificationPurge.test.ts`:

```ts
// Unit tests for the notification purge on content delete, against an in-memory fake Db.
// Run directly:  npx tsx --test src/lib/notificationPurge.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { purgeNotificationsFor } from './notificationPurge';

type Doc = Record<string, any>;
const get = (doc: Doc, path: string) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
// Supports exact match, `$in`, and a top-level `$or` — the shapes the helper uses.
const matchesValue = (actual: unknown, expected: unknown) =>
  expected && typeof expected === 'object' && '$in' in (expected as Doc)
    ? (expected as Doc).$in.some((v: unknown) => String(actual) === String(v))
    : String(actual) === String(expected);
const matches = (doc: Doc, f: Doc): boolean =>
  '$or' in f
    ? (f.$or as Doc[]).some((sub) => matches(doc, sub))
    : Object.entries(f).every(([k, v]) => matchesValue(get(doc, k), v));

function fakeDb() {
  const store = new Map<string, Doc[]>();
  let calls = 0;
  const collection = (name: string) => {
    if (!store.has(name)) store.set(name, []);
    const docs = store.get(name)!;
    return {
      async deleteMany(f: Doc) {
        calls++;
        let deletedCount = 0;
        for (let i = docs.length - 1; i >= 0; i--) if (matches(docs[i], f)) { docs.splice(i, 1); deletedCount++; }
        return { deletedCount };
      },
    };
  };
  return { db: { collection } as any, store, calls: () => calls };
}

function seed() {
  const { db, store, calls } = fakeDb();
  const post = new ObjectId().toHexString();
  const comment = new ObjectId().toHexString();
  const other = new ObjectId().toHexString();
  store.set('notifications', [
    { userId: 'u1', type: 'comment', target: { contentType: 'topic', contentId: post } },
    { userId: 'u2', type: 'mention', target: { contentType: 'topic', contentId: post }, meta: { sourceId: comment, contentKind: 'comment' } },
    { userId: 'u3', type: 'admin_hint', target: { contentType: 'topic', contentId: post }, meta: { sourceId: post, contentKind: 'post' } },
    { userId: 'u1', type: 'moderation', target: { contentType: 'topic', contentId: post }, meta: { outcome: 'rejected', contentKind: 'comment' } },
    { userId: 'u2', type: 'mention', target: { contentType: 'topic', contentId: other }, meta: { sourceId: other, contentKind: 'post' } },
    { userId: 'u1', type: 'market_contact', target: { contentType: 'listing', contentId: other } },
  ]);
  return { db, store, calls, post, comment, other };
}

test('deletes every row whose target.contentId matches, whatever its type', async () => {
  const { db, store, post } = seed();
  const n = await purgeNotificationsFor(db, [post]);
  assert.equal(n, 4);
  const left = store.get('notifications')!;
  assert.equal(left.length, 2);
  assert.ok(left.every((d) => d.target.contentId !== post));
});

test('deletes rows whose meta.sourceId matches (a single comment)', async () => {
  const { db, store, comment } = seed();
  const n = await purgeNotificationsFor(db, [comment]);
  assert.equal(n, 1);
  assert.equal(store.get('notifications')!.length, 5);
  assert.ok(!store.get('notifications')!.some((d) => d.meta?.sourceId === comment));
});

test('leaves unrelated rows and accepts several ids at once', async () => {
  const { db, store, post, other } = seed();
  const n = await purgeNotificationsFor(db, [post, other]);
  assert.equal(n, 6);
  assert.equal(store.get('notifications')!.length, 0);
});

test('an empty id list is a no-op that never touches the db', async () => {
  const { db, store, calls } = seed();
  const n = await purgeNotificationsFor(db, []);
  assert.equal(n, 0);
  assert.equal(calls(), 0);
  assert.equal(store.get('notifications')!.length, 6);
});

test('unknown ids delete nothing and return 0', async () => {
  const { db, store } = seed();
  const n = await purgeNotificationsFor(db, [new ObjectId().toHexString(), 'not-an-id']);
  assert.equal(n, 0);
  assert.equal(store.get('notifications')!.length, 6);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test src/lib/notificationPurge.test.ts 2>&1 | tail -5
```

Expected: fails to load — `Cannot find module './notificationPurge'`.

- [ ] **Step 3: Write the helper**

`src/lib/notificationPurge.ts`:

```ts
// src/lib/notificationPurge.ts — remove the notification rows that point at
// content which is being deleted. Dependency-pure apart from the mongodb
// driver TYPES (never imports connectDB) so it is unit-testable against a
// fake Db, like src/lib/comments/cascade.ts.
//
// Two keys, both strings (src/types/notification.ts):
//   target.contentId — the page the row deep-links to. Every row about a
//     COMMENT targets its PARENT post (commentTarget()), so purging a post by
//     its id sweeps the whole thread: „replied", mentions, @alle hints and
//     moderation rows alike.
//   meta.sourceId   — the post/comment that CONTAINS a mention / @alle hint,
//     and (since 2026-09-30) the comment behind a „replied" row. This is what a
//     single comment delete matches on.
//
// No index: the collection is 90-day TTL-bounded and small; a $or over two
// string fields is fine. Throws only on a driver error (the calling route's
// catch answers 500 — the content is already gone, same as the cascade).
import type { Db } from 'mongodb';

export type PurgeDb = Pick<Db, 'collection'>;

export async function purgeNotificationsFor(db: PurgeDb, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await db.collection('notifications').deleteMany({
    $or: [{ 'target.contentId': { $in: ids } }, { 'meta.sourceId': { $in: ids } }],
  });
  return r.deletedCount ?? 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx tsx --test src/lib/notificationPurge.test.ts 2>&1 | grep -E "^# (pass|fail)"
```

Expected: `# pass 5` and `# fail 0`.

- [ ] **Step 5: The cascade hands back the comment ids (one moderation-row shape targets the COMMENT id)**

`src/lib/reviewAction.ts:223-227` falls back to `moderationTarget('comment', commentId)` when a flagged comment record has no `parentPostId`/`parentCollection` — that row's `target.contentId` is the comment id, not the post's, so a post purge by `[postId]` alone would miss it. `deleteCommentsForPost()` already collects the thread's ids; return them.

In `src/lib/comments/cascade.ts` change the result type and the two returns:

```ts
export interface CascadeResult {
  deletedComments: number;
  flaggedMarked: number;
  /** Ids of the deleted comments (strings) — the caller purges their notifications with the post's. */
  commentIds: string[];
}
```

`if (ids.length === 0) return { deletedComments: 0, flaggedMarked: 0, commentIds: [] };` and the final `return { deletedComments: del.deletedCount ?? 0, flaggedMarked: flagged.modifiedCount ?? 0, commentIds: ids };`.

In `src/lib/comments/cascade.test.ts` the idempotency test uses `deepEqual` on the whole result — update its two expectations to `{ deletedComments: 0, flaggedMarked: 0, commentIds: [] }`, and add one assertion to the first test after `assert.equal(r.deletedComments, 2);`:

```ts
  assert.deepEqual([...r.commentIds].sort(), [c1.toHexString(), c2.toHexString()].sort());
```

(`c1`, `c2` come from `seed()` — destructure them in that test: `const { db, store, post, other, c1, c2 } = seed();`.)

- [ ] **Step 6: Run both test files + type-check**

```bash
npx tsx --test src/lib/comments/cascade.test.ts src/lib/notificationPurge.test.ts 2>&1 | grep -E "^# (pass|fail)"
pnpm type-check 2>&1 | grep -c "error TS"
```

Expected: `# pass 9`, `# fail 0`; `16`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/notificationPurge.ts src/lib/notificationPurge.test.ts src/lib/comments/cascade.ts src/lib/comments/cascade.test.ts
git commit -m "lib: purgeNotificationsFor() removes bell rows that point at deleted content; cascade returns the comment ids"
```

---

### Task 2: Wire the purge into the seven delete paths + the comment-id 400

**Files (modify only; anchors as of main `370998ad` — anchor on the TEXT, the line numbers are a guide):**

| # | File | Anchor line to insert AFTER | Import path |
|---|---|---|---|
| 1 | `src/pages/api/topics/delete/[id].ts` | 62 `await deleteCommentsForPost(db, id);` | `'../../../../lib/notificationPurge'` |
| 2 | `src/pages/api/announcements/delete/[id].ts` | 61 `await deleteCommentsForPost(db, id);` | same |
| 3 | `src/pages/api/recommendations/delete/[id].ts` | 61 `await deleteCommentsForPost(db, id);` | same |
| 4 | `src/pages/api/events/delete/[id].ts` | 61 `await deleteCommentsForPost(db, id);` | same |
| 5 | `src/pages/api/admin/announcements/[id].ts` | 128 `await deleteCommentsForPost(db, id);` | same |
| 6 | `src/pages/api/listings/delete/[id].ts` | 58 `await db.collection('listingContacts').deleteMany({ listingId: id });` | same |
| 7 | `src/pages/api/comments/delete/[commentId].ts` | 57 `await commentsCollection.deleteOne({ _id: new ObjectId(commentId) });` | same |

**Interfaces:**
- Consumes: `purgeNotificationsFor(db, ids: string[]): Promise<number>` and `deleteCommentsForPost(db, id).commentIds: string[]` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Pre-flight grep (stop-and-report rule)**

```bash
grep -n "deleteCommentsForPost(db, id)\|listingContacts').deleteMany\|commentsCollection.deleteOne" 'src/pages/api/topics/delete/[id].ts' 'src/pages/api/announcements/delete/[id].ts' 'src/pages/api/recommendations/delete/[id].ts' 'src/pages/api/events/delete/[id].ts' 'src/pages/api/admin/announcements/[id].ts' 'src/pages/api/listings/delete/[id].ts' 'src/pages/api/comments/delete/[commentId].ts'
```

Expected: exactly one hit per file (seven lines). Any file with zero or two hits → STOP and report.

- [ ] **Step 2: Files 1–5 (post + official routes) — replace the cascade line**

```ts
    const cascade = await deleteCommentsForPost(db, id);
    // Bell rows about the post and its thread target the post id; the ids of the
    // deleted comments catch the one moderation-row shape that targets a comment.
    await purgeNotificationsFor(db, [id, ...cascade.commentIds]);
```

- [ ] **Step 3: File 6 (listing) — insert after the listingContacts line**

```ts
    await db.collection('listingContacts').deleteMany({ listingId: id });
    // Seller's „Anfrage" and moderation rows for this listing.
    await purgeNotificationsFor(db, [id]);
```

- [ ] **Step 4: File 7 (comment) — insert after the deleteOne, AND fix the id check**

After line 57:

```ts
    await commentsCollection.deleteOne({ _id: new ObjectId(commentId) });
    // Mention / @alle / „replied" rows that name this comment as their source.
    await purgeNotificationsFor(db, [commentId]);
```

And the id check at lines 19–24 — today:

```ts
    if (!commentId) {
      return new Response(JSON.stringify({ error: 'Comment ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
```

becomes (the four post routes answer `Invalid <kind> ID` the same way; `new ObjectId(commentId)` below used to throw into the 500 catch on a malformed id):

```ts
    if (!commentId || !ObjectId.isValid(commentId)) {
      return new Response(JSON.stringify({ error: 'Invalid comment ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
```

`ObjectId` is already imported in that file (line 4).

- [ ] **Step 5: Add the import to all seven files** — next to the existing `deleteCommentsForPost` import (files 1–5) or the `connectDB` import (files 6, 7):

```ts
import { purgeNotificationsFor } from '../../../../lib/notificationPurge';
```

- [ ] **Step 6: Verify the diff shape**

```bash
git diff --stat
grep -c "purgeNotificationsFor" 'src/pages/api/topics/delete/[id].ts' 'src/pages/api/announcements/delete/[id].ts' 'src/pages/api/recommendations/delete/[id].ts' 'src/pages/api/events/delete/[id].ts' 'src/pages/api/admin/announcements/[id].ts' 'src/pages/api/listings/delete/[id].ts' 'src/pages/api/comments/delete/[commentId].ts'
```

Expected: seven files changed; every file prints `:2` (import + call); files 1–5 no longer contain a bare `await deleteCommentsForPost(db, id);` (`grep -L`). `comments/delete` additionally shows the `Invalid comment ID` hunk.

- [ ] **Step 7: Type-check + existing tests**

```bash
pnpm type-check 2>&1 | grep -c "error TS"
npx tsx --test src/lib/comments/cascade.test.ts src/lib/notificationPurge.test.ts 2>&1 | grep -E "^# (pass|fail)"
```

Expected: `16`; `# pass 9`, `# fail 0`.

- [ ] **Step 8: Commit**

```bash
git add 'src/pages/api/topics/delete/[id].ts' 'src/pages/api/announcements/delete/[id].ts' 'src/pages/api/recommendations/delete/[id].ts' 'src/pages/api/events/delete/[id].ts' 'src/pages/api/admin/announcements/[id].ts' 'src/pages/api/listings/delete/[id].ts' 'src/pages/api/comments/delete/[commentId].ts'
git commit -m "api: purge notifications when posts, comments, listings and officials are deleted; 400 on a malformed comment id"
```

---

### Task 3: „Replied" rows learn their comment id

**Files (modify only; as of main `370998ad`):**
- Modify: `src/pages/api/comments/create.ts:117-122` (the `notify({ … type: 'comment' … })` call inside the approved branch; `result.insertedId` is the new comment's id).
- Modify: `src/lib/reviewAction.ts:137-142` (the same call when a pending comment is approved; `flaggedContent.contentId` is the comment id, a string).

**Interfaces:**
- Consumes: `NotificationMeta.sourceId?: string` (exists in `src/types/notification.ts`).
- Produces: `type: 'comment'` rows carry `meta: { sourceId: <commentId> }` from now on, so Task 2's single-comment purge also removes the „X hat auf deinen Beitrag geantwortet" row.

- [ ] **Step 1: `comments/create.ts` — add `meta`**

Today (lines 117–122):

```ts
        await notify({
          userId: String(parentDoc.author),
          type: 'comment',
          actorId: userId,
          target: commentTarget(parentCollection, topicId, parentDoc.title ?? ''),
        });
```

becomes:

```ts
        await notify({
          userId: String(parentDoc.author),
          type: 'comment',
          actorId: userId,
          target: commentTarget(parentCollection, topicId, parentDoc.title ?? ''),
          // The comment behind this row — lets a comment delete purge it
          // (target.contentId is the PARENT post). No contentKind: the
          // panel/push copy for 'comment' rows must not switch to the
          // mention wording.
          meta: { sourceId: result.insertedId.toString() },
        });
```

- [ ] **Step 2: `reviewAction.ts` — same shape**

Today (lines 137–142):

```ts
              await notify({
                userId: String(parentDoc.author),
                type: 'comment',
                actorId: flaggedContent.authorId,
                target: commentTarget(parentCollection, parentPostId, parentDoc.title ?? ''),
              });
```

becomes:

```ts
              await notify({
                userId: String(parentDoc.author),
                type: 'comment',
                actorId: flaggedContent.authorId,
                target: commentTarget(parentCollection, parentPostId, parentDoc.title ?? ''),
                // See comments/create.ts — the comment id lets a comment delete purge this row.
                meta: { sourceId: String(flaggedContent.contentId) },
              });
```

- [ ] **Step 3: Update the `sourceId` doc comment in `src/types/notification.ts`**

Today (line ~22): `/** mention only: id of the post/comment that CONTAINS the mention — the idempotency key (target.contentId is the PARENT page for comments, so it cannot serve). */`

becomes: `/** mention/admin_hint: id of the post/comment that CONTAINS the mention — the idempotency key; comment („replied") rows since 2026-09-30: the comment's own id. Either way the key a delete purges by (target.contentId is the PARENT page for comments, so it cannot serve). */`

- [ ] **Step 4: Type-check + grep**

```bash
pnpm type-check 2>&1 | grep -c "error TS"
grep -n "meta: { sourceId" src/pages/api/comments/create.ts src/lib/reviewAction.ts
```

Expected: `16`; one hit in each file.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/comments/create.ts src/lib/reviewAction.ts src/types/notification.ts
git commit -m "notifications: replied rows carry the comment id as meta.sourceId"
```

---

### Task 4: Docs

**Files:**
- Modify: `CLAUDE.md` (root) — the `notifications` collection bullet (line ~185) and the `comments` collection bullet (line ~179, the sentence about the cascade).
- Modify: `src/components/forum/kiosk/CLAUDE.md` — the „Notification bell + panel" section (line ~115): one bullet.

**Interfaces:** none.

- [ ] **Step 1: Root `CLAUDE.md`, `notifications` bullet** — append before the final sentence `See \`src/components/forum/kiosk/CLAUDE.md\` "Notification bell + panel".`:

`**Purged with their content since 2026-09-30:** every delete path (the four post self-deletes, comment self-delete, listing delete, admin official delete) calls \`purgeNotificationsFor(db, [id])\` (\`src/lib/notificationPurge.ts\`, pure, tested) — rows match on \`target.contentId\` OR \`meta.sourceId\`; a post id sweeps its whole thread because every comment row targets the parent page; a comment id matches mention/@alle rows and, for comments created after that day, the „replied" row (\`meta.sourceId\` on \`type: 'comment'\` since then — older replied rows go with the post or the TTL). Only the account-deletion pipeline deletes by recipient. `

- [ ] **Step 2: Root `CLAUDE.md`, `comments` bullet** — after `Reported comments in a deleted thread keep their \`flaggedContent\` row, stamped \`contentDeleted\`.` append: ` The thread's notifications go with the post (see \`notifications\` below). A malformed comment id on the self-delete route answers 400 \`Invalid comment ID\` since 2026-09-30 (was a 500).`

- [ ] **Step 3: Forum area file, „Notification bell + panel"** — add as the last bullet of that section:

`- **Rows die with their content (2026-09-30):** deleting a post/comment/listing/official calls \`purgeNotificationsFor()\` (\`src/lib/notificationPurge.ts\`); a bell entry never leads to a 404 or a vanished comment any more. Residue: „replied" rows written before that day have no \`meta.sourceId\`, so a single COMMENT delete leaves them until the post goes or the 90-day TTL.`

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md src/components/forum/kiosk/CLAUDE.md
git commit -m "docs: notifications are purged with their content"
```

---

### Task 5: Build, preview smoke (orchestrator task — needs `scratchpad/devpw.txt`, `.env` with the DEV `MONGODB_URI`, the Vercel CLI)

**Files:**
- Create: `scratchpad/notif-seed.mts` (gitignored) — inserts three synthetic notification rows on the DEV db, two pointing at a given id and one control; `count <id>` mode prints how many rows still point at the id and whether the control survives; `cleanup` mode removes the control row.
- Create: `scratchpad/notif-purge-smoke.cjs` (gitignored) — six probes against the preview.

**Interfaces:**
- Consumes: the preview deployment; `POST /api/listings/draft` → `{ draftId }` (verified on `95c8175c`, line 105 of `draft.ts`); `DELETE /api/listings/delete/<id>` → 200 for the owner's draft.
- Produces: the smoke report lines.

- [ ] **Step 1: Build**

```bash
pnpm build 2>&1 | tail -2
```

Expected: `Complete!`.

- [ ] **Step 2: The seed/count script**

`scratchpad/notif-seed.mts`:

```ts
// npx tsx scratchpad/notif-seed.mts seed <id> | count <id> | cleanup   — DEV database only
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const [mode, id] = process.argv.slice(2);
const CONTROL = 'smoke-control-notif-purge';
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI missing'); process.exit(2); }
const client = new MongoClient(uri);
await client.connect();
const db = client.db();
if (!/dev/i.test(db.databaseName)) { console.error('refusing: database name must contain "dev"'); await client.close(); process.exit(2); }
const users = db.collection('users');
const ayse = await users.findOne({ email: 'ayse@mahalle-dev.test' }, { projection: { _id: 1 } });
if (!ayse) { console.error('ayse not found'); await client.close(); process.exit(2); }
const userId = ayse._id.toString();
const col = db.collection('notifications');
const now = new Date();
if (mode === 'seed' && id) {
  await col.insertMany([
    { userId, type: 'market_contact', target: { contentType: 'listing', contentId: id, title: 'smoke', href: `/marketplace/${id}` }, createdAt: now, readAt: null },
    { userId, type: 'mention', target: { contentType: 'topic', contentId: CONTROL, title: 'smoke', href: '/forum' }, meta: { sourceId: id, contentKind: 'post' }, createdAt: now, readAt: null },
    { userId, type: 'mention', target: { contentType: 'topic', contentId: CONTROL, title: 'smoke-control', href: '/forum' }, meta: { sourceId: CONTROL, contentKind: 'post' }, createdAt: now, readAt: null },
  ]);
  console.log('seeded 3');
} else if (mode === 'count' && id) {
  const pointing = await col.countDocuments({ $or: [{ 'target.contentId': id }, { 'meta.sourceId': id }] });
  const control = await col.countDocuments({ 'meta.sourceId': CONTROL });
  console.log(`pointing=${pointing} control=${control}`);
} else if (mode === 'cleanup') {
  const r = await col.deleteMany({ $or: [{ 'target.contentId': CONTROL }, { 'meta.sourceId': CONTROL }] });
  console.log(`cleanup removed ${r.deletedCount}`);
} else {
  console.error('usage: seed <id> | count <id> | cleanup'); process.exit(2);
}
await client.close();
```

- [ ] **Step 3: The smoke script**

`scratchpad/notif-purge-smoke.cjs` (run: `NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/notif-purge-smoke.cjs <previewUrl>`):

```js
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const BASE = process.argv[2];
const PW = fs.readFileSync('scratchpad/devpw.txt', 'utf8').trim();
const ZERO = '000000000000000000000000';
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} — ${detail}`); };
const seed = (args) => execSync(`npx tsx scratchpad/notif-seed.mts ${args}`, { encoding: 'utf8' }).trim().split('\n').pop();
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', 'ayse@mahalle-dev.test');
  await page.fill('input[type="password"]', PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);
  const call = (method, path, body) => page.evaluate(async ([base, method, path, body]) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body });
    return { status: res.status, text: (await res.text()).slice(0, 160) };
  }, [BASE, method, path, body]);
  try {
    // 1. a listing draft = deletable content with a fresh id
    const draft = await call('POST', '/api/listings/draft', JSON.stringify({ title: 'Smoke-Entwurf notif-purge ' + Date.now() }));
    const id = (() => { try { return JSON.parse(draft.text).draftId; } catch { return null; } })();
    check('1 listings/draft saves', (draft.status === 200 || draft.status === 201) && !!id, `status ${draft.status} id ${id}`);
    // 2. two rows point at it (one by target.contentId, one by meta.sourceId) + one control
    check('2 seed', seed(`seed ${id}`) === 'seeded 3' && seed(`count ${id}`) === 'pointing=2 control=1', seed(`count ${id}`));
    // 3. delete → both rows gone, control survives
    const del = await call('DELETE', `/api/listings/delete/${id}`);
    const after = seed(`count ${id}`);
    check('3 delete purges the rows that point at the listing', del.status === 200 && after === 'pointing=0 control=1', `status ${del.status} ${after}`);
    // 4. deleting again is 404 and does not touch the control
    const again = await call('DELETE', `/api/listings/delete/${id}`);
    check('4 second delete is 404, control untouched', again.status === 404 && seed(`count ${id}`) === 'pointing=0 control=1', `status ${again.status}`);
    // 5./6. comment delete: malformed id → 400, well-formed unknown id → 404
    const bad = await call('DELETE', '/api/comments/delete/not-an-id');
    check('5 comments/delete/not-an-id is 400 Invalid comment ID', bad.status === 400 && bad.text.includes('Invalid comment ID'), `status ${bad.status} ${bad.text}`);
    const gone = await call('DELETE', `/api/comments/delete/${ZERO}`);
    check('6 comments/delete on a well-formed unknown id is 404', gone.status === 404, `status ${gone.status} ${gone.text}`);
  } finally {
    console.log(seed('cleanup'));
    await browser.close();
  }
  const fails = results.filter((x) => !x.ok).length;
  console.log(fails ? `FAILS: ${fails}` : 'ALL OK');
  process.exit(fails ? 1 : 0);
})();
```

- [ ] **Step 4: Push the branch, wait for the preview**

```bash
git push -u origin chore/notification-purge
vercel ls 2>/dev/null | sed -n '6,8p'
```

Poll `vercel ls` every 30 s until the newest Preview row says `● Ready`; note its URL. No build within two minutes → empty commit to trigger one.

- [ ] **Step 5: Run the smoke**

```bash
NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/notif-purge-smoke.cjs https://<preview-host> 2>&1 | grep -v "npm warn"
```

Expected: six `OK` lines, `cleanup removed 1` (the control row; the two seeded rows were purged by the route), `ALL OK`. On a FAIL: read the failing route before touching anything; `cleanup` always runs.

- [ ] **Step 6: Report to the user** — commit SHAs, tsc 16, unit tests 9/9, build green, preview URL, the six smoke lines. The USER merges (fast-forward) — never merge in this plan.
