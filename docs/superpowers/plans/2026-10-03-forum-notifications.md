# Forum notifications (daily digest · every post · off) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every member gets one morning notification when the forum has new posts (digest, the default), or one per new post („jeden"), or none („aus") — chosen in the notification panel.

**Architecture:** Three layers, like the blog announcement: pure rules (`forumNotifyRules.ts`, tested), a database layer that takes a `Db` and imports no env/Astro module (`forumNotifyStore.ts`, tested with an in-memory Db double, also runnable as a dev script), and a never-throw sending layer (`forumNotify.ts`: push + Sentry). The digest rides the existing morning cron route and is claimed once per Berlin day in `forumDigests` BEFORE anything is sent. „Every post" is called from the three forum create routes (public at once) and from `processReviewAction()` (held post approved). One new notification type `'forum'`.

**Tech Stack:** Astro 5 SSR + Svelte 5 islands, MongoDB driver, Zod, web-push (existing), node:test via tsx.

**Spec:** `docs/superpowers/specs/2026-10-03-unread-and-forum-notifications-design.md` (section B). Depends on plan `2026-10-03-unread-dots.md` (the digest reads `users.lastVisit.forum`; without it every digest member simply has `forumVisitMs: null` — it still works, do plan 1 first anyway). Every code block below was run on a throwaway branch (`scratch/plan-check`, commit `99c31b0f`): tests green, tsc 16 / svelte-check 81, browser probe 11/11 and a dev-DB digest run (3 recipients, author left out, second run refused).

## Global Constraints

- Error budgets stay EXACTLY at `pnpm type-check` 16 and `npx -y svelte-check@4` 81. `pnpm test` stays green (335 after this plan on top of plan 1).
- Commit messages: plain and concise. NO „🤖 Generated with Claude Code" line, NO „Co-Authored-By" footer.
- Never stage secrets; never print any `.env` value; dev password only via `scratchpad/devpw.txt`.
- All sending is NEVER-THROW (`capture()` → `Sentry.captureException` + `flush(2000)`), like `src/lib/notifications.ts`.
- `forumNotifyRules.ts` is imported by the panel island → no imports besides the `../../types/notification` types. `forumNotifyStore.ts` takes a `Db` and must not import `connectDB`, `push.ts` or anything reading `import.meta.env` (it runs under plain `tsx` in tests and the dev script).
- Preference values are exactly `'digest' | 'each' | 'off'`; `'digest'` is stored as ABSENT (`$unset`), never as a string.
- Push copy is German only (existing rule in `push.ts`); panel copy DE + EN in `kiosk-i18n.ts`, draft copy.
- The `.nc-*` styles live in `src/styles/global.css` (nested-island CSS rule), never in the panel's `<style>`.

## Review Focus

1. The afternoon GitHub run of `/api/news/fetch-daily` must not send a second digest — pinned by `claimDigestDay` test „a second call on the same Berlin day gets nothing" (Task 2).
2. A post edited weeks later, re-moderated and approved again must not re-announce — `EACH_MAX_AGE_MS` guard in `notifyForumSubscribersOnApproval` (Task 3) plus the per-post idempotency test „a post is announced only once" (Task 2).
3. A member who read the forum last night must not be told this morning about the posts they saw — `digestPostsFor` test „posts seen at the last forum visit are left out" (Task 1).
4. An unknown preference value from a client must be refused, and the DB must never store `'digest'` — route 400 (probe, Task 5) and `$unset` on digest (Task 4).
5. A member whose forum row's post is deleted: `purgeNotificationsFor()` already matches `target.contentId` OR `meta.sourceId` — single-post rows carry both, digest rows carry the newest post's id as `contentId` (so deleting that post removes the digest row too — accepted, the row's count would be stale otherwise).

---

### Task 1: Pure rules (`forumNotifyRules.ts`)

**Files:**
- Create: `src/lib/forum/forumNotifyRules.ts`
- Test: `src/lib/forum/forumNotifyRules.test.ts`

**Interfaces:**
- Produces: `FORUM_NOTIFY_MODES`, `ForumNotifyMode`, `storedForumNotify(v)`, `ForumPostKind`, `FORUM_KIND_COLLECTION`, `ForumPostRef {id, kind, title, authorId, dateMs}`, `DigestMember {id, forumVisitMs}`, `DIGEST_MAX_LOOKBACK_MS`, `EACH_MAX_AGE_MS`, `digestWindowStart(previousUntilMs, nowMs)`, `berlinDay(nowMs)`, `newestFirst(posts)`, `digestPostsFor(member, posts, windowStartMs)`, `forumNotification(posts)`, `DigestGroup`, `planDigest(members, posts, windowStartMs)`.

- [ ] **Step 1: Write the failing tests**

`src/lib/forum/forumNotifyRules.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  storedForumNotify, digestWindowStart, berlinDay, newestFirst, digestPostsFor,
  forumNotification, planDigest, DIGEST_MAX_LOOKBACK_MS, type ForumPostRef,
} from './forumNotifyRules';

const NOW = Date.parse('2026-10-03T06:00:00.000Z');
const HOUR = 3_600_000;
const post = (id: string, authorId: string, hoursAgo: number, kind: ForumPostRef['kind'] = 'topic'): ForumPostRef =>
  ({ id, kind, title: `Titel ${id}`, authorId, dateMs: NOW - hoursAgo * HOUR });

test('the stored preference falls back to the digest', () => {
  assert.equal(storedForumNotify('each'), 'each');
  assert.equal(storedForumNotify('off'), 'off');
  for (const v of [undefined, null, '', 'digest', 'EACH', 1, {}]) assert.equal(storedForumNotify(v), 'digest');
});

test('the window starts where the previous digest ended', () => {
  assert.equal(digestWindowStart(NOW - 23 * HOUR, NOW), NOW - 23 * HOUR);
});

test('the first digest and a broken previous stamp look 24 hours back', () => {
  assert.equal(digestWindowStart(null, NOW), NOW - 24 * HOUR);
  assert.equal(digestWindowStart(NaN, NOW), NOW - 24 * HOUR);
  assert.equal(digestWindowStart(NOW + HOUR, NOW), NOW - 24 * HOUR);
});

test('after missed mornings the window is capped at two days', () => {
  assert.equal(digestWindowStart(NOW - 9 * 24 * HOUR, NOW), NOW - DIGEST_MAX_LOOKBACK_MS);
});

test('the day key is the Berlin calendar day, also right after midnight', () => {
  assert.equal(berlinDay(Date.parse('2026-10-02T21:59:00.000Z')), '2026-10-02'); // 23:59 Berlin (CEST)
  assert.equal(berlinDay(Date.parse('2026-10-02T22:00:00.000Z')), '2026-10-03'); // 00:00 Berlin
  assert.equal(berlinDay(Date.parse('2026-12-31T23:30:00.000Z')), '2027-01-01'); // 00:30 Berlin (CET)
});

test('own posts and posts seen at the last forum visit are left out', () => {
  const posts = newestFirst([post('a', 'me', 1), post('b', 'x', 2), post('c', 'y', 10), post('d', 'x', 30)]);
  const start = NOW - 24 * HOUR;
  assert.deepEqual(digestPostsFor({ id: 'me', forumVisitMs: null }, posts, start).map((p) => p.id), ['b', 'c']);
  assert.deepEqual(digestPostsFor({ id: 'me', forumVisitMs: NOW - 5 * HOUR }, posts, start).map((p) => p.id), ['b']);
  assert.deepEqual(digestPostsFor({ id: 'me', forumVisitMs: NOW }, posts, start), []);
  // a visit long before the window does not widen it
  assert.deepEqual(digestPostsFor({ id: 'z', forumVisitMs: NOW - 90 * HOUR }, posts, start).map((p) => p.id), ['a', 'b', 'c']);
});

test('one post links to the post, several to the forum with a count', () => {
  assert.equal(forumNotification([]), null);
  assert.deepEqual(forumNotification([post('r1', 'x', 1, 'recommendation')]), {
    target: { contentType: 'recommendation', contentId: 'r1', title: 'Titel r1', href: '/recommendations/r1' },
  });
  assert.deepEqual(forumNotification([post('a', 'x', 1), post('b', 'y', 2), post('c', 'y', 3)]), {
    target: { contentType: 'forum', contentId: 'a', title: 'Titel a', href: '/forum' },
    meta: { count: 3 },
  });
});

test('members who are told the same thing share a group; nobody gets an empty one', () => {
  const posts = [post('a', 'u1', 1), post('b', 'u2', 2)];
  const members = [
    { id: 'u1', forumVisitMs: null },            // author of a → hears about b
    { id: 'u2', forumVisitMs: null },            // author of b → hears about a
    { id: 'u3', forumVisitMs: null },            // both
    { id: 'u4', forumVisitMs: null },            // both
    { id: 'u5', forumVisitMs: NOW },             // has seen everything → nothing
  ];
  const groups = planDigest(members, posts, NOW - 24 * HOUR);
  const byUsers = Object.fromEntries(groups.map((g) => [g.userIds.join('+'), g]));
  assert.deepEqual(Object.keys(byUsers).sort(), ['u1', 'u2', 'u3+u4']);
  assert.equal(byUsers['u1'].target.contentId, 'b');
  assert.equal(byUsers['u1'].meta, undefined);
  assert.equal(byUsers['u2'].target.contentId, 'a');
  assert.deepEqual(byUsers['u3+u4'].meta, { count: 2 });
  assert.equal(byUsers['u3+u4'].target.href, '/forum');
});

test('no posts, no groups', () => {
  assert.deepEqual(planDigest([{ id: 'u1', forumVisitMs: null }], [], NOW - 24 * HOUR), []);
});

test('posts of the same millisecond keep a stable order', () => {
  assert.deepEqual(newestFirst([post('b', 'x', 1), post('a', 'x', 1), post('c', 'x', 0)]).map((p) => p.id), ['c', 'a', 'b']);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test src/lib/forum/forumNotifyRules.test.ts` → `Cannot find module './forumNotifyRules'`.

- [ ] **Step 3: Write the rules**

`src/lib/forum/forumNotifyRules.ts`:

```ts
/**
 * Forum notifications — pure rules (no imports besides types; shared with the panel island).
 *
 * One preference per member, `users.forumNotify`:
 *   absent  → 'digest'  one notification each morning when the forum has new posts
 *   'each'  → one notification per new public post
 *   'off'   → none
 * A member's own posts never count. Official announcements are left out (they have their
 * own „official" notification), posts with a warning label too.
 */
import type { NotificationMeta, NotificationTarget } from '../../types/notification';

export const FORUM_NOTIFY_MODES = ['digest', 'each', 'off'] as const;
export type ForumNotifyMode = (typeof FORUM_NOTIFY_MODES)[number];

export function storedForumNotify(v: unknown): ForumNotifyMode {
  return v === 'each' || v === 'off' ? v : 'digest';
}

export type ForumPostKind = 'topic' | 'announcement' | 'recommendation';

export const FORUM_KIND_COLLECTION: Record<ForumPostKind, string> = {
  topic: 'topics',
  announcement: 'announcements',
  recommendation: 'recommendations',
};

export interface ForumPostRef {
  id: string;
  kind: ForumPostKind;
  title: string;
  authorId: string;
  dateMs: number;
}

export interface DigestMember {
  id: string;
  /** the member's last visit of the forum index (ms), or null */
  forumVisitMs: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A missed morning is caught up, but never further back than two days. */
export const DIGEST_MAX_LOOKBACK_MS = 2 * DAY_MS;
/** „Every post" is for fresh posts: a post approved (again) later than this stays silent. */
export const EACH_MAX_AGE_MS = 7 * DAY_MS;

/** Start of the digest window: where the previous digest ended, else 24 h back; capped at two days. */
export function digestWindowStart(previousUntilMs: number | null, nowMs: number): number {
  const floor = nowMs - DIGEST_MAX_LOOKBACK_MS;
  if (previousUntilMs === null || !Number.isFinite(previousUntilMs) || previousUntilMs > nowMs) return nowMs - DAY_MS;
  return Math.max(previousUntilMs, floor);
}

/** The Europe/Berlin calendar day — the once-a-day key of the digest. */
export function berlinDay(nowMs: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(nowMs));
}

export function newestFirst(posts: ForumPostRef[]): ForumPostRef[] {
  return [...posts].sort((a, b) => b.dateMs - a.dateMs || a.id.localeCompare(b.id));
}

/** The posts one member is told about: not their own, and newer than their last forum visit. */
export function digestPostsFor(member: DigestMember, posts: ForumPostRef[], windowStartMs: number): ForumPostRef[] {
  const from = Math.max(windowStartMs, member.forumVisitMs ?? -Infinity);
  return posts.filter((p) => p.authorId !== member.id && p.dateMs > from);
}

/** One post → a row that opens the post; several → one row with a count that opens the forum. */
export function forumNotification(posts: ForumPostRef[]): { target: NotificationTarget; meta?: NotificationMeta } | null {
  if (!posts.length) return null;
  const first = posts[0];
  if (posts.length === 1) {
    return {
      target: {
        contentType: first.kind, contentId: first.id, title: first.title,
        href: `/${FORUM_KIND_COLLECTION[first.kind]}/${first.id}`,
      },
    };
  }
  return {
    target: { contentType: 'forum', contentId: first.id, title: first.title, href: '/forum' },
    meta: { count: posts.length },
  };
}

export interface DigestGroup {
  userIds: string[];
  target: NotificationTarget;
  meta?: NotificationMeta;
}

/** Members who are told the same thing share one group (one insertMany, one push payload). */
export function planDigest(members: DigestMember[], posts: ForumPostRef[], windowStartMs: number): DigestGroup[] {
  const sorted = newestFirst(posts);
  const groups = new Map<string, DigestGroup>();
  for (const m of members) {
    const mine = digestPostsFor(m, sorted, windowStartMs);
    const n = forumNotification(mine);
    if (!n) continue;
    const key = mine.map((p) => p.id).join(',');
    const g = groups.get(key);
    if (g) g.userIds.push(m.id);
    else groups.set(key, { userIds: [m.id], ...n });
  }
  return [...groups.values()];
}
```

- [ ] **Step 4: Run the tests** → `ℹ tests 10` / `ℹ pass 10`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/forum/forumNotifyRules.ts src/lib/forum/forumNotifyRules.test.ts
git commit -m "feat: forum notification rules — preference, digest window, grouping"
```

---

### Task 2: Database layer, the `'forum'` type, push copy, panel row

**Files:**
- Create: `src/lib/forum/forumNotifyStore.ts`
- Test: `src/lib/forum/forumNotifyStore.test.ts`
- Modify: `src/types/notification.ts`, `src/lib/push.ts`, `src/components/forum/kiosk/NotificationPanel.svelte` (glyph + row text only — the switch comes in Task 4), `src/lib/kiosk-i18n.ts` (`nc.forum.one/.many` only — the `nc.forumNotify.*` keys come in Task 4)

**Interfaces:**
- Consumes: Task 1.
- Produces: `FORUM_DIGESTS_COLLECTION = 'forumDigests'` (docs `{ _id: <Berlin day>, until: Date, sentAt: Date }`), `claimDigestDay(db, nowMs) → { startMs } | null`, `loadDigestPosts(db, startMs, nowMs)`, `loadDigestMembers(db)`, `eachRecipients(db, post)`, `insertForumRows(db, userIds, target, meta, now)`; `NotificationType` gains `'forum'`.

- [ ] **Step 1: Add the type first (the store's docs are typed `NotificationDoc`)**

```diff
diff --git a/src/types/notification.ts b/src/types/notification.ts
index d2b81993..ee24f69f 100644
--- a/src/types/notification.ts
+++ b/src/types/notification.ts
@@ -1,6 +1,6 @@
 import type { ObjectId } from 'mongodb';
 
-export type NotificationType = 'comment' | 'moderation' | 'official' | 'market_contact' | 'mention' | 'admin_hint' | 'blog';
+export type NotificationType = 'comment' | 'moderation' | 'official' | 'market_contact' | 'mention' | 'admin_hint' | 'blog' | 'forum';
 
 export interface NotificationTarget {
   /** The page kind the row deep-links to (mirrors the href, not necessarily
@@ -23,7 +23,7 @@ export interface NotificationMeta {
    *  key; comment („replied") rows since 2026-09-30: the comment's own id. Either way the key
    *  a delete purges by (target.contentId is the PARENT page for comments, so it cannot serve). */
   sourceId?: string;
-  /** blog: how many posts this one notification stands for (set only when > 1). */
+  /** blog + forum digest: how many posts this one notification stands for (set only when > 1). */
   count?: number;
 }
```

- [ ] **Step 2: Write the failing tests**

`src/lib/forum/forumNotifyStore.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from 'mongodb';
import {
  claimDigestDay, loadDigestPosts, loadDigestMembers, eachRecipients, insertForumRows, FORUM_DIGESTS_COLLECTION,
} from './forumNotifyStore';

const NOW = Date.parse('2026-10-03T06:00:00.000Z');
const HOUR = 3_600_000;

/** In-memory Db double: enough of find/findOne/insertOne/insertMany for these helpers. */
function fakeDb(seed: Record<string, any[]> = {}) {
  const data: Record<string, any[]> = { ...seed };
  const calls: { collection: string; op: string; filter?: any }[] = [];
  const rows = (name: string) => (data[name] ??= []);
  const db = {
    collection: (name: string) => ({
      find: (filter: any) => {
        calls.push({ collection: name, op: 'find', filter });
        let list = [...rows(name)];
        const cursor = {
          sort: (spec: Record<string, 1 | -1>) => {
            const [k, dir] = Object.entries(spec)[0];
            list.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir);
            return cursor;
          },
          limit: (n: number) => { list = list.slice(0, n); return cursor; },
          toArray: async () => list,
        };
        return cursor;
      },
      findOne: async (filter: any) => {
        calls.push({ collection: name, op: 'findOne', filter });
        return rows(name).find((r) => r.type === filter.type && r.meta?.sourceId === filter['meta.sourceId']) ?? null;
      },
      insertOne: async (doc: any) => {
        if (rows(name).some((r) => r._id === doc._id)) throw Object.assign(new Error('dup'), { code: 11000 });
        rows(name).push(doc);
      },
      insertMany: async (docs: any[]) => { rows(name).push(...docs); },
    }),
  } as unknown as Db;
  return { db, data, calls };
}

test('the first digest claims the Berlin day and looks 24 hours back', async () => {
  const { db, data } = fakeDb();
  assert.deepEqual(await claimDigestDay(db, NOW), { startMs: NOW - 24 * HOUR });
  assert.equal(data[FORUM_DIGESTS_COLLECTION][0]._id, '2026-10-03');
});

test('a second call on the same Berlin day gets nothing', async () => {
  const { db, data } = fakeDb();
  await claimDigestDay(db, NOW);
  assert.equal(await claimDigestDay(db, NOW + 9 * HOUR), null); // the afternoon run of the same route
  assert.equal(data[FORUM_DIGESTS_COLLECTION].length, 1);
});

test('the next day starts where the previous digest ended', async () => {
  const { db } = fakeDb();
  await claimDigestDay(db, NOW);
  assert.deepEqual(await claimDigestDay(db, NOW + 25 * HOUR), { startMs: NOW });
});

test('a database error other than the duplicate key is passed on', async () => {
  const db = {
    collection: () => ({
      find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
      insertOne: async () => { throw Object.assign(new Error('down'), { code: 91 }); },
    }),
  } as unknown as Db;
  await assert.rejects(() => claimDigestDay(db, NOW), /down/);
});

test('posts come from the three forum collections, with kind, author and date', async () => {
  const { db, calls } = fakeDb({
    topics: [{ _id: 't1', title: 'Frage', author: 'u1', date: NOW - HOUR }],
    announcements: [{ _id: 'a1', title: 'Flohmarkt', author: 'u2', date: NOW - 2 * HOUR }],
    recommendations: [],
  });
  const posts = await loadDigestPosts(db, NOW - 24 * HOUR, NOW);
  assert.deepEqual(posts, [
    { id: 't1', kind: 'topic', title: 'Frage', authorId: 'u1', dateMs: NOW - HOUR },
    { id: 'a1', kind: 'announcement', title: 'Flohmarkt', authorId: 'u2', dateMs: NOW - 2 * HOUR },
  ]);
  const f = calls.find((c) => c.collection === 'topics')!.filter;
  assert.deepEqual(f.date, { $gt: NOW - 24 * HOUR, $lte: NOW });
  assert.deepEqual(f.isOfficial, { $ne: true });
  assert.deepEqual(f.hasWarningLabel, { $ne: true });
  assert.deepEqual(f.$or, [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }]);
});

test('digest members: the query leaves out each/off, banned and anonymized; the forum visit is read', async () => {
  const { db, calls } = fakeDb({
    users: [{ _id: 'u1', lastVisit: { forum: new Date(NOW - HOUR) } }, { _id: 'u2' }],
  });
  assert.deepEqual(await loadDigestMembers(db), [
    { id: 'u1', forumVisitMs: NOW - HOUR },
    { id: 'u2', forumVisitMs: null },
  ]);
  assert.deepEqual(calls[0].filter, {
    anonymized: { $ne: true }, isBanned: { $ne: true }, forumNotify: { $nin: ['each', 'off'] },
  });
});

test('every-post recipients: the author is left out, and a post is announced only once', async () => {
  const post = { id: 'p1', kind: 'topic' as const, title: 'Frage', authorId: 'u1', dateMs: NOW };
  const { db, data, calls } = fakeDb({ users: [{ _id: 'u1' }, { _id: 'u2' }, { _id: 'u3' }] });
  assert.deepEqual(await eachRecipients(db, post), ['u2', 'u3']);
  assert.deepEqual(calls.find((c) => c.collection === 'users')!.filter, {
    anonymized: { $ne: true }, isBanned: { $ne: true }, forumNotify: 'each',
  });
  await insertForumRows(db, ['u2', 'u3'], { contentType: 'topic', contentId: 'p1', title: 'Frage', href: '/topics/p1' }, { sourceId: 'p1' }, new Date(NOW));
  assert.equal(data.notifications.length, 2);
  assert.deepEqual(data.notifications[0], {
    userId: 'u2', type: 'forum',
    target: { contentType: 'topic', contentId: 'p1', title: 'Frage', href: '/topics/p1' },
    meta: { sourceId: 'p1' }, createdAt: new Date(NOW), readAt: null,
  });
  assert.deepEqual(await eachRecipients(db, post), []); // second approval of the same post
});

test('no recipients, no insert', async () => {
  const { db, data } = fakeDb();
  await insertForumRows(db, [], { contentType: 'forum', contentId: 'x', title: 't', href: '/forum' }, undefined, new Date(NOW));
  assert.equal(data.notifications, undefined);
});
```

- [ ] **Step 3: Run them to see them fail** → `Cannot find module './forumNotifyStore'`.

- [ ] **Step 4: Write the store**

`src/lib/forum/forumNotifyStore.ts`:

```ts
/**
 * Forum notifications — database side. Takes a Db, imports no env and no Astro module, so it
 * runs in tests (fake Db) and in dev scripts. Sending (push, Sentry) lives in forumNotify.ts.
 */
import type { Db } from 'mongodb';
import type { NotificationDoc, NotificationMeta, NotificationTarget } from '../../types/notification';
import {
  FORUM_KIND_COLLECTION, berlinDay, digestWindowStart,
  type DigestMember, type ForumPostKind, type ForumPostRef,
} from './forumNotifyRules';

export const FORUM_DIGESTS_COLLECTION = 'forumDigests';

interface DigestDoc {
  _id: string; // Berlin day, e.g. '2026-10-03' — the once-a-day guard
  until: Date; // end of the window this digest covered
  sentAt: Date;
}

const toMs = (v: unknown): number | null => {
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * Claim today's digest BEFORE anything is sent (at-most-once: a second caller of the same
 * Berlin day loses on the duplicate key and gets null). Returns the window start.
 */
export async function claimDigestDay(db: Db, nowMs: number): Promise<{ startMs: number } | null> {
  const col = db.collection<DigestDoc>(FORUM_DIGESTS_COLLECTION);
  const previous = await col.find({}, { projection: { until: 1 } }).sort({ until: -1 }).limit(1).toArray();
  const startMs = digestWindowStart(toMs(previous[0]?.until), nowMs);
  try {
    await col.insertOne({ _id: berlinDay(nowMs), until: new Date(nowMs), sentAt: new Date(nowMs) });
  } catch (err) {
    if ((err as { code?: number })?.code === 11000) return null;
    throw err;
  }
  return { startMs };
}

/** Public, unlabelled, non-official posts created in (startMs, nowMs]. */
export async function loadDigestPosts(db: Db, startMs: number, nowMs: number): Promise<ForumPostRef[]> {
  const filter = {
    date: { $gt: startMs, $lte: nowMs },
    $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }],
    isOfficial: { $ne: true },
    hasWarningLabel: { $ne: true },
  };
  const kinds = Object.keys(FORUM_KIND_COLLECTION) as ForumPostKind[];
  const lists = await Promise.all(kinds.map(async (kind) => {
    const docs = await db.collection(FORUM_KIND_COLLECTION[kind])
      .find(filter, { projection: { title: 1, author: 1, date: 1 } }).toArray();
    return docs.map((d): ForumPostRef => ({
      id: String(d._id), kind, title: String(d.title ?? ''), authorId: String(d.author ?? ''), dateMs: Number(d.date),
    }));
  }));
  return lists.flat();
}

const REACHABLE = { anonymized: { $ne: true }, isBanned: { $ne: true } };

/** Everyone on the digest: no preference stored (or an unknown one), not banned, not anonymized. */
export async function loadDigestMembers(db: Db): Promise<DigestMember[]> {
  const users = await db.collection('users')
    .find({ ...REACHABLE, forumNotify: { $nin: ['each', 'off'] } }, { projection: { _id: 1, 'lastVisit.forum': 1 } })
    .toArray();
  return users.map((u) => ({ id: String(u._id), forumVisitMs: toMs(u.lastVisit?.forum) }));
}

/**
 * Who hears about ONE new post at once: the „each" members except the author.
 * Idempotent per post: when a forum row for this post exists already, nobody is told again.
 */
export async function eachRecipients(db: Db, post: ForumPostRef): Promise<string[]> {
  const already = await db.collection('notifications')
    .findOne({ type: 'forum', 'meta.sourceId': post.id }, { projection: { _id: 1 } });
  if (already) return [];
  const users = await db.collection('users')
    .find({ ...REACHABLE, forumNotify: 'each' }, { projection: { _id: 1 } }).toArray();
  return users.map((u) => String(u._id)).filter((id) => id !== post.authorId);
}

export async function insertForumRows(
  db: Db,
  userIds: string[],
  target: NotificationTarget,
  meta: NotificationMeta | undefined,
  now: Date,
): Promise<void> {
  if (!userIds.length) return;
  const docs: NotificationDoc[] = userIds.map((userId) => ({
    userId, type: 'forum', target, ...(meta ? { meta } : {}), createdAt: now, readAt: null,
  }));
  await db.collection<NotificationDoc>('notifications').insertMany(docs, { ordered: false });
}
```

- [ ] **Step 5: Run the tests** → `ℹ tests 8` / `ℹ pass 8`.

- [ ] **Step 6: Push copy (German only, like the other cases)**

```diff
diff --git a/src/lib/push.ts b/src/lib/push.ts
index 7bf2425c..65c08328 100644
--- a/src/lib/push.ts
+++ b/src/lib/push.ts
@@ -77,6 +77,11 @@ export function buildPushPayload(
         ? `${meta?.count} neue Beiträge in der Beilage`
         : `Neu in der Beilage: ‚${t}‘`;
       break;
+    case 'forum':
+      body = (meta?.count ?? 1) > 1
+        ? `${meta?.count} neue Beitr\u00e4ge im Forum`
+        : `Neu im Forum: \u201a${t}\u2018`;
+      break;
     case 'moderation': {
       const noun = meta?.contentKind === 'comment' ? 'Kommentar' : 'Beitrag';
       if (meta?.outcome === 'rejected') body = `Dein ${noun} wurde abgelehnt — Details in deinem Profil`;
```

- [ ] **Step 7: Panel glyph + row text, and the two row keys**

In `src/components/forum/kiosk/NotificationPanel.svelte` add to `GLYPH`:
```ts
    forum: { g: '✦', c: 'var(--k-wine, #b23a5b)' },
```
and to `rowText()` before `case 'market_contact':`:
```ts
      case 'forum': {
        const n = it.meta?.count ?? 1;
        return n > 1 ? tStr($t['nc.forum.many'], { n: String(n) }) : tStr($t['nc.forum.one'], { title });
      }
```
In `src/lib/kiosk-i18n.ts` add right before `'nc.push.enable'` — DE:
```ts
  'nc.forum.one': 'Neu im Forum: ‚{title}‘',
  'nc.forum.many': '{n} neue Beiträge im Forum',
```
EN:
```ts
  'nc.forum.one': 'New in the forum: ‘{title}’',
  'nc.forum.many': '{n} new posts in the forum',
```

- [ ] **Step 8: Budgets** → tsc 16, svelte-check 81.

- [ ] **Step 9: Commit**

```bash
git add src/lib/forum/forumNotifyStore.ts src/lib/forum/forumNotifyStore.test.ts src/types/notification.ts src/lib/push.ts src/components/forum/kiosk/NotificationPanel.svelte src/lib/kiosk-i18n.ts
git commit -m "feat: forum notification type, store and panel row"
```

---

### Task 3: Sending side + hooks (create routes, review action, morning cron)

**Files:**
- Create: `src/lib/forum/forumNotify.ts`
- Modify: `src/pages/api/topics/create.ts`, `src/pages/api/announcements/create.ts`, `src/pages/api/recommendations/create.ts`, `src/lib/reviewAction.ts`, `src/pages/api/news/fetch-daily.ts`, `src/lib/auth/accountDeletion.ts`

**Interfaces:**
- Consumes: Tasks 1–2, `connectDB`, `buildPushPayload`/`sendPushToUsers` from `src/lib/push.ts`.
- Produces: `notifyForumSubscribers(post: ForumPostRef)`, `notifyForumSubscribersOnApproval(flagged, hasWarning)`, `sendForumDigest()` — all never-throw.

- [ ] **Step 1: Write the sending layer**

`src/lib/forum/forumNotify.ts`:

```ts
/**
 * Forum notifications — the sending side. SERVER-ONLY. Everything here is NEVER-THROW:
 * a failed notification must not fail a post, a review or the morning job.
 * Rules: forumNotifyRules.ts · database: forumNotifyStore.ts.
 */
import { ObjectId } from 'mongodb';
import * as Sentry from '@sentry/astro';
import { connectDB } from '../mongodb';
import { buildPushPayload, sendPushToUsers } from '../push';
import {
  EACH_MAX_AGE_MS, FORUM_KIND_COLLECTION, forumNotification, planDigest,
  type ForumPostKind, type ForumPostRef,
} from './forumNotifyRules';
import {
  claimDigestDay, eachRecipients, insertForumRows, loadDigestMembers, loadDigestPosts,
} from './forumNotifyStore';

async function capture(err: unknown): Promise<void> {
  console.error('[forum-notify] failed:', err);
  try {
    Sentry.captureException(err);
    await Sentry.flush(2000);
  } catch {
    /* best-effort */
  }
}

/** Tell the „every post" members about one post that just became public. */
export async function notifyForumSubscribers(post: ForumPostRef): Promise<void> {
  try {
    const db = await connectDB();
    const userIds = await eachRecipients(db, post);
    const n = forumNotification([post]);
    if (!userIds.length || !n) return;
    const meta = { sourceId: post.id };
    await insertForumRows(db, userIds, n.target, meta, new Date());
    await sendPushToUsers(userIds, buildPushPayload('forum', n.target, meta));
  } catch (err) {
    await capture(err);
  }
}

/**
 * A post that waited in the review queue becomes public on approval. Skipped: user reports
 * (the post was public already), deleted content, a warning label, anything that is not a
 * forum post, official announcements, and posts older than EACH_MAX_AGE_MS.
 */
export async function notifyForumSubscribersOnApproval(
  flagged: { contentType: string; contentId?: string; source?: string; contentDeleted?: boolean },
  hasWarning: boolean,
): Promise<void> {
  try {
    if (hasWarning || flagged.contentDeleted || flagged.source === 'user_report') return;
    const collection = FORUM_KIND_COLLECTION[flagged.contentType as ForumPostKind];
    if (!collection || !flagged.contentId || !ObjectId.isValid(flagged.contentId)) return;
    const db = await connectDB();
    const doc = await db.collection(collection).findOne(
      { _id: new ObjectId(flagged.contentId) },
      { projection: { title: 1, author: 1, date: 1, isOfficial: 1 } },
    );
    if (!doc || doc.isOfficial === true) return;
    const dateMs = Number(doc.date);
    if (!Number.isFinite(dateMs) || Date.now() - dateMs > EACH_MAX_AGE_MS) return;
    await notifyForumSubscribers({
      id: flagged.contentId, kind: flagged.contentType as ForumPostKind,
      title: String(doc.title ?? ''), authorId: String(doc.author ?? ''), dateMs,
    });
  } catch (err) {
    await capture(err);
  }
}

/** The morning digest: once per Berlin day, only to members with something new to read. */
export async function sendForumDigest(): Promise<void> {
  try {
    const db = await connectDB();
    const nowMs = Date.now();
    const claim = await claimDigestDay(db, nowMs);
    if (!claim) return;
    const posts = await loadDigestPosts(db, claim.startMs, nowMs);
    if (!posts.length) return;
    const groups = planDigest(await loadDigestMembers(db), posts, claim.startMs);
    const now = new Date(nowMs);
    for (const g of groups) {
      await insertForumRows(db, g.userIds, g.target, g.meta, now);
      await sendPushToUsers(g.userIds, buildPushPayload('forum', g.target, g.meta));
    }
  } catch (err) {
    await capture(err);
  }
}
```

- [ ] **Step 2: The three create routes — inside the existing `if (!mergedResult) {` block, before `notifyMentions`**

Topics (announcements and recommendations are identical except for `kind: 'announcement'` / `kind: 'recommendation'`; the import goes right under the `connectDB` import of each file):

```diff
diff --git a/src/pages/api/topics/create.ts b/src/pages/api/topics/create.ts
index b44147b2..632c8884 100644
--- a/src/pages/api/topics/create.ts
+++ b/src/pages/api/topics/create.ts
@@ -1,5 +1,6 @@
 import type { APIRoute } from 'astro';
 import { connectDB } from '../../../lib/mongodb';
+import { notifyForumSubscribers } from '../../../lib/forum/forumNotify';
 import { checkDailyLimit, limitReachedResponse } from '../../../lib/limits/dailyLimit';
 import { PUBLIC_AUTHOR_PROJECTION, toPublicAuthor } from '../../../lib/publicAuthor';
 import { resolveMentions, notifyMentions, applyBroadcast, notifyAdminHint } from '../../../lib/mentions/mentionsStore';
@@ -125,6 +126,10 @@ export const POST: APIRoute = async ({ request }) => {
     // Mentions notify only once the post is public; a pending post is picked up
     // by notifyMentionsOnApproval() in reviewAction.ts. Never throws.
     if (!mergedResult) {
+      // Members who asked for every new forum post (never throws).
+      await notifyForumSubscribers({
+        id: result.insertedId.toString(), kind: 'topic', title, authorId: userId, dateMs: Date.now(),
+      });
       await notifyMentions(db, {
         actorId: userId, mentions, sourceId: result.insertedId.toString(), kind: 'post',
         target: moderationTarget('topic', result.insertedId.toString(), title),
```

```diff
diff --git a/src/pages/api/announcements/create.ts b/src/pages/api/announcements/create.ts
index b6f09848..8d2fc1a1 100644
--- a/src/pages/api/announcements/create.ts
+++ b/src/pages/api/announcements/create.ts
@@ -1,5 +1,6 @@
 import type { APIRoute } from 'astro';
 import { connectDB } from '../../../lib/mongodb';
+import { notifyForumSubscribers } from '../../../lib/forum/forumNotify';
 import { checkDailyLimit, limitReachedResponse } from '../../../lib/limits/dailyLimit';
 import { PUBLIC_AUTHOR_PROJECTION, toPublicAuthor } from '../../../lib/publicAuthor';
 import { resolveMentions, notifyMentions, applyBroadcast, notifyAdminHint } from '../../../lib/mentions/mentionsStore';
@@ -125,6 +126,10 @@ export const POST: APIRoute = async ({ request }) => {
     // Mentions notify only once the post is public; a pending post is picked up
     // by notifyMentionsOnApproval() in reviewAction.ts. Never throws.
     if (!mergedResult) {
+      // Members who asked for every new forum post (never throws).
+      await notifyForumSubscribers({
+        id: result.insertedId.toString(), kind: 'announcement', title, authorId: userId, dateMs: Date.now(),
+      });
       await notifyMentions(db, {
         actorId: userId, mentions, sourceId: result.insertedId.toString(), kind: 'post',
         target: moderationTarget('announcement', result.insertedId.toString(), title),
```

```diff
diff --git a/src/pages/api/recommendations/create.ts b/src/pages/api/recommendations/create.ts
index f5a5b3e5..96fb9c05 100644
--- a/src/pages/api/recommendations/create.ts
+++ b/src/pages/api/recommendations/create.ts
@@ -1,5 +1,6 @@
 import type { APIRoute } from 'astro';
 import { connectDB } from '../../../lib/mongodb';
+import { notifyForumSubscribers } from '../../../lib/forum/forumNotify';
 import { checkDailyLimit, limitReachedResponse } from '../../../lib/limits/dailyLimit';
 import { PUBLIC_AUTHOR_PROJECTION, toPublicAuthor } from '../../../lib/publicAuthor';
 import { resolveMentions, notifyMentions, applyBroadcast, notifyAdminHint } from '../../../lib/mentions/mentionsStore';
@@ -126,6 +127,10 @@ export const POST: APIRoute = async ({ request }) => {
     // Mentions notify only once the post is public; a pending post is picked up
     // by notifyMentionsOnApproval() in reviewAction.ts. Never throws.
     if (!mergedResult) {
+      // Members who asked for every new forum post (never throws).
+      await notifyForumSubscribers({
+        id: result.insertedId.toString(), kind: 'recommendation', title, authorId: userId, dateMs: Date.now(),
+      });
       await notifyMentions(db, {
         actorId: userId, mentions, sourceId: result.insertedId.toString(), kind: 'post',
         target: moderationTarget('recommendation', result.insertedId.toString(), title),
```

- [ ] **Step 3: Review action — a held post approved**

```diff
diff --git a/src/lib/reviewAction.ts b/src/lib/reviewAction.ts
index b0bc0c36..980b9736 100644
--- a/src/lib/reviewAction.ts
+++ b/src/lib/reviewAction.ts
@@ -7,6 +7,7 @@ import { ObjectId, type Db } from 'mongodb';
 import type { FlaggedContent, User } from '../types';
 import { notify, commentTarget, moderationTarget } from './notifications';
 import { notifyMentionsOnApproval } from './mentions/mentionsStore';
+import { notifyForumSubscribersOnApproval } from './forum/forumNotify';
 import { invalidateKiezKontext } from './kiez/kontext';
 
 const MAX_STRIKES = 3;
@@ -168,6 +169,8 @@ export async function processReviewAction(
     // idempotent and never throws — see src/lib/mentions/mentionsStore.ts.
     if (!isRejection) {
       await notifyMentionsOnApproval(db, flaggedContent);
+      // „Every new forum post" members hear about a held post now (never throws).
+      await notifyForumSubscribersOnApproval(flaggedContent, hasWarning);
     }
 
     // Handle strike system on rejection
```

- [ ] **Step 4: Morning cron — after the blog announcement, before the OpenAI early-return**

```diff
diff --git a/src/pages/api/news/fetch-daily.ts b/src/pages/api/news/fetch-daily.ts
index 5bcb6236..c99efd06 100644
--- a/src/pages/api/news/fetch-daily.ts
+++ b/src/pages/api/news/fetch-daily.ts
@@ -3,6 +3,7 @@ import * as Sentry from '@sentry/astro';
 import { connectDB } from '../../../lib/mongodb';
 import { checkAirLoggerFreshness } from '../../../lib/kiez/airFreshness';
 import { announceNewBlogPosts } from '../../../lib/blog/blogNotify';
+import { sendForumDigest } from '../../../lib/forum/forumNotify';
 import type { NewsItem } from '../../../types';
 import { decodeHtmlEntities } from '../../../utils/decodeHtmlEntities';
 import crypto from 'crypto';
@@ -354,6 +355,10 @@ export const GET: APIRoute = async ({ request }) => {
     // (the blog pages do the same on their first visit). Never throws.
     await announceNewBlogPosts();
 
+  // The forum digest rides the same morning job: once per Berlin day (the afternoon
+  // run of this route finds the day claimed), never throws.
+  await sendForumDigest();
+
     const openaiKey = import.meta.env.OPENAI_API_KEY;
     const newsDataKey = import.meta.env.NEWSDATA_API_KEY;
```

- [ ] **Step 5: Tombstone unsets the preference**

Under the `lastVisit: ''` line plan 1 added in `src/lib/auth/accountDeletion.ts`:
```ts
          forumNotify: '',
```

- [ ] **Step 6: Budgets + tests** → tsc 16 (the pre-existing `reviewAction.ts(159)` `$pull` error stays, it is one of the 16), svelte-check 81, `pnpm test` green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/forum/forumNotify.ts src/pages/api/topics/create.ts src/pages/api/announcements/create.ts src/pages/api/recommendations/create.ts src/lib/reviewAction.ts src/pages/api/news/fetch-daily.ts src/lib/auth/accountDeletion.ts
git commit -m "feat: forum digest from the morning cron, every-post notifications on publish"
```

---

### Task 4: The preference — route + three-way switch in the panel

**Files:**
- Create: `src/pages/api/profile/forum-notify.ts`
- Modify: `src/components/forum/kiosk/NotificationPanel.svelte`, `src/styles/global.css`, `src/lib/kiosk-i18n.ts`

**Interfaces:**
- Consumes: `FORUM_NOTIFY_MODES`, `storedForumNotify`, `ForumNotifyMode` (Task 1).
- Produces: `GET /api/profile/forum-notify` → `{ mode }`; `POST` body `{ mode }` → `{ mode }` (401 without session, 400 on an unknown mode; `'digest'` ⇒ `$unset`).

- [ ] **Step 1: The route**

`src/pages/api/profile/forum-notify.ts`:

```ts
import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { connectDB } from '../../../lib/mongodb';
import { FORUM_NOTIFY_MODES, storedForumNotify } from '../../../lib/forum/forumNotifyRules';

// The member's forum-notification preference (users.forumNotify; absent = 'digest').
// Not ban-gated: turning notifications down must always be possible.
const BodySchema = z.object({ mode: z.enum(FORUM_NOTIFY_MODES) });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id || !ObjectId.isValid(session.user.id)) return json({ error: 'Unauthorized' }, 401);
  const db = await connectDB();
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(session.user.id) },
    { projection: { forumNotify: 1 } },
  );
  return json({ mode: storedForumNotify(user?.forumNotify) });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id || !ObjectId.isValid(session.user.id)) return json({ error: 'Unauthorized' }, 401);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid mode' }, 400);
  const { mode } = parsed.data;

  const db = await connectDB();
  await db.collection('users').updateOne(
    { _id: new ObjectId(session.user.id) },
    mode === 'digest' ? { $unset: { forumNotify: '' } } : { $set: { forumNotify: mode } },
  );
  return json({ mode });
};
```

- [ ] **Step 2: The switch, directly under the panel head (always in view, before the scrolling list)**

Full diff of the panel for this plan (the glyph + row text hunks are Task 2's, the rest is this task):

```diff
diff --git a/src/components/forum/kiosk/NotificationPanel.svelte b/src/components/forum/kiosk/NotificationPanel.svelte
index a90508b9..bdb75505 100644
--- a/src/components/forum/kiosk/NotificationPanel.svelte
+++ b/src/components/forum/kiosk/NotificationPanel.svelte
@@ -7,6 +7,7 @@
   import type { NotificationItem } from '../../../types/notification';
   import { detectPushState, subscribeToPush, unsubscribeFromPush, type PushUiState } from '../../../lib/pushClient';
   import { showError } from '../../../utils/toast';
+  import { FORUM_NOTIFY_MODES, storedForumNotify, type ForumNotifyMode } from '../../../lib/forum/forumNotifyRules';
 
   let { onClose } = $props<{ onClose: (restoreFocus: boolean) => void }>();
 
@@ -39,6 +40,39 @@
     pushState = 'ready';
   }
 
+  // Forum preference (digest · every post · off). null = not loaded yet (row hidden).
+  let forumMode = $state<ForumNotifyMode | null>(null);
+  let forumBusy = $state(false);
+
+  $effect(() => {
+    let alive = true;
+    fetch('/api/profile/forum-notify')
+      .then((r) => (r.ok ? r.json() : null))
+      .then((d) => { if (alive && d) forumMode = storedForumNotify(d.mode); })
+      .catch(() => {});
+    return () => { alive = false; };
+  });
+
+  async function setForumMode(mode: ForumNotifyMode) {
+    if (forumBusy || mode === forumMode) return;
+    const previous = forumMode;
+    forumMode = mode; // optimistic
+    forumBusy = true;
+    try {
+      const res = await fetch('/api/profile/forum-notify', {
+        method: 'POST',
+        headers: { 'Content-Type': 'application/json' },
+        body: JSON.stringify({ mode }),
+      });
+      if (!res.ok) throw new Error(String(res.status));
+    } catch {
+      forumMode = previous;
+      showError($t['nc.forumNotify.error']);
+    } finally {
+      forumBusy = false;
+    }
+  }
+
   let items = $state<NotificationItem[] | null>(null);
   let failed = $state(false);
   // Ids that were unread at fetch time — POST /read marks them server-side,
@@ -182,6 +216,7 @@
     moderation: { g: '§', c: 'var(--k-plum, #6f2f59)' },
     official: { g: '◉', c: 'var(--k-teal, #3f8f9f)' },
     blog: { g: '¶', c: 'var(--k-rust, #a3552e)' },
+    forum: { g: '✦', c: 'var(--k-wine, #b23a5b)' },
     admin_hint: { g: '!', c: 'var(--k-plum, #6f2f59)' },
   };
 
@@ -206,6 +241,10 @@
         const n = it.meta?.count ?? 1;
         return n > 1 ? tStr($t['nc.blog.many'], { n: String(n) }) : tStr($t['nc.blog.one'], { title });
       }
+      case 'forum': {
+        const n = it.meta?.count ?? 1;
+        return n > 1 ? tStr($t['nc.forum.many'], { n: String(n) }) : tStr($t['nc.forum.one'], { title });
+      }
       case 'market_contact':
         return tStr($t['nc.market'], { title });
       case 'moderation': {
@@ -246,6 +285,23 @@
         <span class="nc-head-neu font-dmmono">{freshIds.size} {$t['nc.neu']}</span>
       {/if}
     </div>
+    {#if forumMode !== null}
+      <div class="nc-pref" role="group" aria-label={$t['nc.forumNotify.label']}>
+        <span class="nc-pref-label font-dmmono">{$t['nc.forumNotify.label']}</span>
+        <span class="nc-pref-opts">
+          {#each FORUM_NOTIFY_MODES as mode (mode)}
+            <button
+              type="button"
+              class="nc-pref-opt font-dmmono"
+              class:nc-pref-on={forumMode === mode}
+              aria-pressed={forumMode === mode}
+              disabled={forumBusy}
+              onclick={() => setForumMode(mode)}
+            >{$t[`nc.forumNotify.${mode}`]}</button>
+          {/each}
+        </span>
+      </div>
+    {/if}
     {#if failed}
       <div class="nc-empty font-instrument">{$t['nc.error']}</div>
     {:else if items === null}
```

- [ ] **Step 3: Styles in `global.css`, before the `.nc-foot--live` comment**

```diff
diff --git a/src/styles/global.css b/src/styles/global.css
index 6197e5f0..7bb34bc4 100644
--- a/src/styles/global.css
+++ b/src/styles/global.css
@@ -872,6 +872,21 @@ option:disabled {
 /* Foot slot — anatomy from R1, renders nothing (R2: push opt-in). */
 .nc-foot { border-top: 1.5px solid var(--k-ink); background: var(--k-paper-warm); height: 10px; }
 
+/* Forum preference row under the head — always in view, before the (scrolling) list. */
+.nc-pref {
+  display: flex; align-items: center; justify-content: space-between; gap: 10px;
+  padding: 9px 14px; border-bottom: 1.5px solid var(--k-ink); background: var(--k-paper-warm);
+}
+.nc-pref-label { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--k-ink-soft); }
+.nc-pref-opts { display: inline-flex; border: 1.5px solid var(--k-ink); border-radius: 999px; overflow: hidden; flex-shrink: 0; }
+.nc-pref-opt {
+  font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
+  padding: 6px 10px; min-height: 28px; background: transparent; color: var(--k-ink); cursor: pointer;
+}
+.nc-pref-opt + .nc-pref-opt { border-left: 1.5px solid var(--k-ink); }
+.nc-pref-opt.nc-pref-on { background: var(--k-ink); color: var(--k-paper); }
+.nc-pref-opt:disabled { cursor: default; }
+
 /* Foot slot with live content (R2 push opt-in). Base .nc-foot stays the
    empty 10px strip for unsupported browsers. */
 .nc-foot--live {
```

- [ ] **Step 4: Copy (DE + EN, right before `'nc.push.enable'`; the `nc.forum.*` rows are Task 2's)**

```diff
diff --git a/src/lib/kiosk-i18n.ts b/src/lib/kiosk-i18n.ts
index 7ccb94a7..336c0a0e 100644
--- a/src/lib/kiosk-i18n.ts
+++ b/src/lib/kiosk-i18n.ts
@@ -140,6 +140,13 @@ const de = {
   'nc.time.m': 'vor {n} Min.',
   'nc.time.h': 'vor {n} Std.',
   'nc.time.d': 'vor {n} Tg.',
+  'nc.forum.one': 'Neu im Forum: ‚{title}‘',
+  'nc.forum.many': '{n} neue Beiträge im Forum',
+  'nc.forumNotify.label': 'Neue Forumsbeiträge',
+  'nc.forumNotify.digest': 'täglich',
+  'nc.forumNotify.each': 'jeden',
+  'nc.forumNotify.off': 'aus',
+  'nc.forumNotify.error': 'Die Einstellung konnte nicht gespeichert werden.',
   'nc.push.enable': 'Push-Mitteilungen aktivieren',
   'nc.push.active': 'Push aktiv auf diesem Gerät',
   'nc.push.disable': 'deaktivieren',
@@ -2240,6 +2247,13 @@ const en: Dict = {
   'nc.time.m': '{n} min ago',
   'nc.time.h': '{n} h ago',
   'nc.time.d': '{n} d ago',
+  'nc.forum.one': 'New in the forum: ‘{title}’',
+  'nc.forum.many': '{n} new posts in the forum',
+  'nc.forumNotify.label': 'New forum posts',
+  'nc.forumNotify.digest': 'daily',
+  'nc.forumNotify.each': 'each one',
+  'nc.forumNotify.off': 'off',
+  'nc.forumNotify.error': 'The setting could not be saved.',
   'nc.push.enable': 'Enable push notifications',
   'nc.push.active': 'Push active on this device',
   'nc.push.disable': 'disable',
```

- [ ] **Step 5: Budgets** → tsc 16, svelte-check 81.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/profile/forum-notify.ts src/components/forum/kiosk/NotificationPanel.svelte src/styles/global.css src/lib/kiosk-i18n.ts
git commit -m "feat: forum notification preference — täglich · jeden · aus"
```

---

### Task 5: Dev e2e + browser gate + docs

**Files:**
- Probes (gitignored, on disk in the main checkout): `scratchpad/plan-unread/notify-probe.cjs`, `scratchpad/plan-unread/digest-e2e.mts` (dev-DB only, refuses any db name without „dev").
- Modify: `CLAUDE.md` (root), `src/components/forum/kiosk/CLAUDE.md`, `src/pages/api/news/CLAUDE.md`

- [ ] **Step 1: Build + serve** (`npx astro build --config scratchpad/astro.config.preview.mjs`; `PORT=4655 HOST=127.0.0.1 node --env-file=.env dist/server/entry.mjs` in the background).

- [ ] **Step 2: Reset, then the browser probe**

```bash
npx tsx --env-file=.env scratchpad/plan-unread/digest-e2e.mts cleanup
NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/plan-unread/notify-probe.cjs http://127.0.0.1:4655
```
Expected `ALL PASS` (11): digest by default, unknown mode → 400, the switch shows „täglich · jeden · aus" with „täglich" selected, choosing „jeden" is saved, the admin's post (admins skip moderation) gives Ayşe („jeden") one row that opens the post, Jonas (digest) and the admin get none, the panel row reads „Neu im Forum: …", the switch fits a 390 px phone.

- [ ] **Step 3: The digest on the dev DB, twice**

```bash
npx tsx --env-file=.env scratchpad/plan-unread/digest-e2e.mts run
```
Expected: `first run : posts 1, groups 1, recipients N` (every digest member except the admin author; Ayşe is on „jeden" and gets nothing), `second run: day already claimed`, `digestDays: [<today, Berlin>]`. Then `… cleanup` (removes the probe post, the forum rows, the digest day, resets the preferences).

- [ ] **Step 4: Stop the server** (own call): `fuser -k 4655/tcp`.

- [ ] **Step 5: Docs**

Root `CLAUDE.md`: `users` gains `forumNotify?: 'each' | 'off'` (absent = digest; `GET/POST /api/profile/forum-notify`; unset by the tombstone); `notifications.type` gains `'forum'`; new collection `forumDigests` (`{ _id: <Berlin day>, until, sentAt }`, claim-by-insert BEFORE sending, at-most-once per day — never delete a row in prod for „today", the digest would go out again); the Newsboard „Second daily fetch" note: the afternoon run finds the digest day claimed. `src/components/forum/kiosk/CLAUDE.md`: section „Forum notifications" (the three modes, what is left out, the 7-day guard on approval, the switch under the panel head, draft copy keys `nc.forum.*`, `nc.forumNotify.*`). `src/pages/api/news/CLAUDE.md`: `sendForumDigest()` runs after `announceNewBlogPosts()`, before the OpenAI early-return.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md src/components/forum/kiosk/CLAUDE.md src/pages/api/news/CLAUDE.md
git commit -m "docs: forum notifications — digest, every post, preference"
```
