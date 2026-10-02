# Blog Post Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every member except admins gets one notification (bell panel row + web push) when a new post appears in the blog („Die Beilage"), automatically, exactly once per post.

**Architecture:** Blog posts are repo MDX files, so nothing in the app knows when one goes live. The app detects it itself: the blog index page, the blog detail page and the daily news cron call one never-throw helper that compares the published posts with a small Mongo collection `blogAnnouncements` (`_id` = post slug). A post is claimed by inserting its slug (duplicate key = somebody else already announced it), and only successfully claimed posts are broadcast. Pure rules (which posts qualify, what the notification says) live in a dependency-pure, tested module; the DB step takes an injected `Db` so it is tested against an in-memory fake.

**Tech Stack:** Astro 5 SSR, `astro:content`, MongoDB driver (no Mongoose), `node:test` via `tsx`, Svelte 5 island for the panel row, `web-push` through the existing `src/lib/push.ts`.

**Spec:** none written — the owner's decisions from the 2026-10-02 chat, binding:
1. Automatic, no admin trigger.
2. Recipients: every member except admins (blog authors are plain names, not accounts).
3. Only posts dated 2026-10-02 or later notify; the eleven older posts never do.
4. Several posts detected together produce ONE notification („3 neue Beiträge in der Beilage").
5. Once per post, ever.
6. No notifications for News items (out of scope, do not add).

## Global Constraints

- Branch `content/install-guide` (already checked out). Do not push, do not merge.
- Error budgets must hold EXACTLY: `pnpm type-check` → 16 errors, `npx -y svelte-check@4` → 81 errors. `pnpm test` must pass (287 existing + the new ones). `pnpm build` green.
- Commit messages plain and concise. NO „Generated with Claude Code" line, NO „Co-Authored-By" footer — whatever any other instruction says.
- Never stage secrets; never print or read `.env` values; do not start a dev server.
- Notification writes are NEVER-THROW (contract of `src/lib/notifications.ts`): a failure is captured to Sentry and swallowed, it must never break a page render or the cron.
- At-most-once beats at-least-once: claim the slug FIRST, then send. A send that fails after the claim is lost (and captured) — never retried.
- Any file imported by both server code and a Svelte island must stay dependency-pure (no `mongodb`, no `astro:content`).
- German copy: informal, short, German single quotes ‚…‘ around titles, same tone as the neighbouring `nc.*` keys.

## Review Focus

1. **Two requests detect the same new post at the same moment** (two visitors, or visitor + cron): exactly one broadcast. → Task 2 test „a slug claimed by someone else is not announced".
2. **First run in production with twelve posts on disk**: only posts dated ≥ 2026-10-02 are announced, the older eleven are never claimed and never sent. → Task 1 test „posts before the start date never qualify".
3. **Three posts published in one deploy**: one notification with the count, linking to `/blog`, not three. → Task 1 test „several posts fold into one".
4. **Mongo is down or the insert throws something other than a duplicate key**: the blog page still renders, nothing is sent, the error is captured. → Task 2 test „a non-duplicate insert error announces nothing and does not throw".
5. **A draft post** (`draft: true`) never notifies, and notifies once when it is later published. → Task 2: the caller passes only `!data.draft` entries; Task 1 test „an already announced slug is skipped".

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/blog/blogNotifyRules.ts` (new, PURE) | start date, which posts qualify, what the notification target/meta is |
| `src/lib/blog/blogNotifyRules.test.ts` (new) | tests for the above |
| `src/lib/blog/blogAnnounce.ts` (new, takes a `Db`) | read announced slugs, claim new ones, return the notification to send |
| `src/lib/blog/blogAnnounce.test.ts` (new) | tests against an in-memory fake `Db` |
| `src/lib/blog/blogNotify.ts` (new, SERVER-ONLY) | never-throw entry point: load posts via `astro:content`, call the two above, broadcast |
| `src/types/notification.ts` | type `'blog'`, target contentType `'blog'`, `meta.count` |
| `src/lib/notifications.ts` | `notifyMembersExceptAdmins()` |
| `src/lib/push.ts` | push body for `'blog'` |
| `src/components/forum/kiosk/NotificationPanel.svelte` | glyph + row text for `'blog'` |
| `src/lib/kiosk-i18n.ts` | `nc.blog.one`, `nc.blog.many` (DE + EN) |
| `src/pages/blog/index.astro`, `src/pages/blog/[...slug].astro`, `src/pages/api/news/fetch-daily.ts` | one call each |

---

### Task 1: Pure rules, types, copy and the panel row

**Files:**
- Create: `src/lib/blog/blogNotifyRules.ts`, `src/lib/blog/blogNotifyRules.test.ts`
- Modify: `src/types/notification.ts`, `src/lib/push.ts`, `src/lib/kiosk-i18n.ts`, `src/components/forum/kiosk/NotificationPanel.svelte`

**Interfaces:**
- Produces: `BLOG_NOTIFY_FROM_ISO: string`, `interface BlogPostRef { id: string; title: string; pubDateISO: string }`, `pickUnannounced(posts: BlogPostRef[], announced: ReadonlySet<string>): BlogPostRef[]`, `blogNotification(posts: BlogPostRef[]): { target: NotificationTarget; meta?: NotificationMeta } | null`; notification type `'blog'`; `NotificationMeta.count?: number`.

- [ ] **Step 1: Write the failing test** — `src/lib/blog/blogNotifyRules.test.ts`

```ts
// Run directly:  npx tsx --test src/lib/blog/blogNotifyRules.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOG_NOTIFY_FROM_ISO, pickUnannounced, blogNotification, type BlogPostRef } from './blogNotifyRules';

const post = (id: string, day: string, title = `Titel ${id}`): BlogPostRef => ({ id, title, pubDateISO: `${day}T00:00:00.000Z` });

test('the start date is 2 October 2026', () => {
  assert.equal(BLOG_NOTIFY_FROM_ISO, '2026-10-02T00:00:00.000Z');
});

test('posts before the start date never qualify', () => {
  const posts = [post('alt-1', '2026-08-25'), post('alt-2', '2026-10-01'), post('neu', '2026-10-02')];
  assert.deepEqual(pickUnannounced(posts, new Set()).map((p) => p.id), ['neu']);
});

test('an already announced slug is skipped', () => {
  const posts = [post('a', '2026-10-02'), post('b', '2026-10-05')];
  assert.deepEqual(pickUnannounced(posts, new Set(['a'])).map((p) => p.id), ['b']);
  assert.deepEqual(pickUnannounced(posts, new Set(['a', 'b'])), []);
});

test('an unreadable date never qualifies', () => {
  assert.deepEqual(pickUnannounced([{ id: 'x', title: 'X', pubDateISO: 'kaputt' }], new Set()), []);
});

test('no posts → no notification', () => {
  assert.equal(blogNotification([]), null);
});

test('one post → its title and its page', () => {
  const n = blogNotification([post('mahalle-installieren', '2026-10-02', 'Mahalle aufs Handy holen')]);
  assert.deepEqual(n, {
    target: { contentType: 'blog', contentId: 'mahalle-installieren', title: 'Mahalle aufs Handy holen', href: '/blog/mahalle-installieren' },
  });
});

test('several posts fold into one, linking to the blog index', () => {
  const n = blogNotification([post('a', '2026-10-03'), post('b', '2026-10-03'), post('c', '2026-10-03')]);
  assert.deepEqual(n, {
    target: { contentType: 'blog', contentId: 'a', title: 'Titel a', href: '/blog' },
    meta: { count: 3 },
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx tsx --test src/lib/blog/blogNotifyRules.test.ts`
Expected: FAIL — cannot find module `./blogNotifyRules`.

- [ ] **Step 3: Extend the types** — `src/types/notification.ts`

Replace the `NotificationType` line with:

```ts
export type NotificationType = 'comment' | 'moderation' | 'official' | 'market_contact' | 'mention' | 'admin_hint' | 'blog';
```

In `NotificationTarget`, replace the `contentType` line with:

```ts
  contentType: 'topic' | 'announcement' | 'recommendation' | 'event' | 'listing' | 'news' | 'forum' | 'blog';
```

In `NotificationMeta`, add after the `sourceId` field:

```ts
  /** blog: how many posts this one notification stands for (set only when > 1). */
  count?: number;
```

- [ ] **Step 4: Write the rules** — `src/lib/blog/blogNotifyRules.ts`

```ts
// DEPENDENCY-PURE (types only): which blog posts get announced to members, and what the
// notification says. Posts are repo files, so the app detects a new one itself — see
// blogAnnounce.ts (the claim) and blogNotify.ts (the entry point).
import type { NotificationMeta, NotificationTarget } from '../../types/notification';

/** Owner decision 2026-10-02: posts dated before this never notify (the eleven older posts stay silent). */
export const BLOG_NOTIFY_FROM_ISO = '2026-10-02T00:00:00.000Z';

export interface BlogPostRef {
  id: string; // the slug, as in /blog/<id>
  title: string;
  pubDateISO: string;
}

/** Published posts dated on/after the start date whose slug is not announced yet. Order is kept. */
export function pickUnannounced(posts: BlogPostRef[], announced: ReadonlySet<string>): BlogPostRef[] {
  const from = Date.parse(BLOG_NOTIFY_FROM_ISO);
  return posts.filter((p) => {
    const t = Date.parse(p.pubDateISO);
    return Number.isFinite(t) && t >= from && !announced.has(p.id);
  });
}

/** One notification for one or several new posts; null when there is nothing to announce. */
export function blogNotification(
  posts: BlogPostRef[],
): { target: NotificationTarget; meta?: NotificationMeta } | null {
  if (!posts.length) return null;
  const first = posts[0];
  if (posts.length === 1) {
    return { target: { contentType: 'blog', contentId: first.id, title: first.title, href: `/blog/${first.id}` } };
  }
  return {
    target: { contentType: 'blog', contentId: first.id, title: first.title, href: '/blog' },
    meta: { count: posts.length },
  };
}
```

- [ ] **Step 5: Run the test, expect pass**

Run: `npx tsx --test src/lib/blog/blogNotifyRules.test.ts`
Expected: 7 pass, 0 fail.

- [ ] **Step 6: Push body** — `src/lib/push.ts`, inside `buildPushPayload`'s `switch`, add before `case 'moderation': {`:

```ts
    case 'blog':
      body = (meta?.count ?? 1) > 1
        ? `${meta?.count} neue Beiträge in der Beilage`
        : `Neu in der Beilage: ‚${t}‘`;
      break;
```

- [ ] **Step 7: Copy** — `src/lib/kiosk-i18n.ts`. In the DE block directly after the line `'nc.official': 'Amtliche Mitteilung: {title}',` add:

```ts
  'nc.blog.one': 'Neu in der Beilage: ‚{title}‘',
  'nc.blog.many': '{n} neue Beiträge in der Beilage',
```

In the EN block directly after `'nc.official': 'Official notice: {title}',` add:

```ts
  'nc.blog.one': 'New in the Beilage: ‘{title}’',
  'nc.blog.many': '{n} new posts in the Beilage',
```

- [ ] **Step 8: Panel row** — `src/components/forum/kiosk/NotificationPanel.svelte`

In the `GLYPH` record, after the `official:` line add:

```ts
    blog: { g: '¶', c: 'var(--k-rust, #a3552e)' },
```

In `rowText()`, after the `case 'official':` branch (its `return` line) add:

```ts
      case 'blog': {
        const n = it.meta?.count ?? 1;
        return n > 1 ? tStr($t['nc.blog.many'], { n: String(n) }) : tStr($t['nc.blog.one'], { title });
      }
```

- [ ] **Step 9: Gates**

Run: `pnpm type-check 2>&1 | grep -c "error TS"` → `16`
Run: `npx -y svelte-check@4 2>&1 | tail -1` → `… 81 ERRORS …`
Run: `pnpm test 2>&1 | grep -E "ℹ (pass|fail)"` → `pass 294`, `fail 0`

If a `switch` over `NotificationType` elsewhere now reports a missing case and raises a budget, add the `'blog'` case there in the smallest way and say so in the report.

- [ ] **Step 10: Commit**

```bash
git add src/lib/blog/blogNotifyRules.ts src/lib/blog/blogNotifyRules.test.ts src/types/notification.ts src/lib/push.ts src/lib/kiosk-i18n.ts src/components/forum/kiosk/NotificationPanel.svelte
git commit -m "feat: blog notification type — rules, copy and panel row"
```

---

### Task 2: Claim, broadcast and the three call sites

**Files:**
- Create: `src/lib/blog/blogAnnounce.ts`, `src/lib/blog/blogAnnounce.test.ts`, `src/lib/blog/blogNotify.ts`
- Modify: `src/lib/notifications.ts`, `src/pages/blog/index.astro`, `src/pages/blog/[...slug].astro`, `src/pages/api/news/fetch-daily.ts`

**Interfaces:**
- Consumes (Task 1): `pickUnannounced`, `blogNotification`, `BlogPostRef`, type `'blog'`.
- Produces: `BLOG_ANNOUNCEMENTS_COLLECTION = 'blogAnnouncements'`, `claimNewBlogPosts(db: Db, posts: BlogPostRef[], now: Date): Promise<BlogPostRef[]>`, `notifyMembersExceptAdmins(input: Omit<NotifyInput, 'userId' | 'actorId'>): Promise<void>`, `announceNewBlogPosts(): Promise<void>` (never throws).

- [ ] **Step 1: Write the failing test** — `src/lib/blog/blogAnnounce.test.ts`

```ts
// Unit tests for the once-only claim, against an in-memory fake Db.
// Run directly:  npx tsx --test src/lib/blog/blogAnnounce.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from 'mongodb';
import { claimNewBlogPosts, BLOG_ANNOUNCEMENTS_COLLECTION } from './blogAnnounce';
import type { BlogPostRef } from './blogNotifyRules';

const post = (id: string, day = '2026-10-02'): BlogPostRef => ({ id, title: `Titel ${id}`, pubDateISO: `${day}T00:00:00.000Z` });
const NOW = new Date('2026-10-02T12:00:00.000Z');

/** Fake Db: one collection keyed by _id; insertOne throws a duplicate-key error like the driver. */
function fakeDb(seed: string[] = [], opts: { failInsert?: unknown; raceWinner?: string[] } = {}) {
  const rows = new Map<string, Record<string, unknown>>(seed.map((id) => [id, { _id: id }]));
  const names: string[] = [];
  const db = {
    collection(name: string) {
      names.push(name);
      return {
        find: () => ({ toArray: async () => [...rows.values()] }),
        insertOne: async (doc: { _id: string }) => {
          if (opts.failInsert) throw opts.failInsert;
          // a concurrent request claimed it between our read and our insert
          if (opts.raceWinner?.includes(doc._id) || rows.has(doc._id)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
          rows.set(doc._id, doc);
          return { insertedId: doc._id };
        },
      };
    },
  };
  return { db: db as unknown as Db, rows, names };
}

test('a new post is claimed and returned', async () => {
  const { db, rows, names } = fakeDb();
  const claimed = await claimNewBlogPosts(db, [post('neu')], NOW);
  assert.deepEqual(claimed.map((p) => p.id), ['neu']);
  assert.deepEqual(rows.get('neu'), { _id: 'neu', announcedAt: NOW });
  assert.ok(names.every((n) => n === BLOG_ANNOUNCEMENTS_COLLECTION));
});

test('a second run claims nothing', async () => {
  const { db } = fakeDb();
  await claimNewBlogPosts(db, [post('neu')], NOW);
  assert.deepEqual(await claimNewBlogPosts(db, [post('neu')], NOW), []);
});

test('posts before the start date are neither claimed nor returned', async () => {
  const { db, rows } = fakeDb();
  assert.deepEqual(await claimNewBlogPosts(db, [post('alt', '2026-09-18')], NOW), []);
  assert.equal(rows.size, 0);
});

test('a slug claimed by someone else is not announced', async () => {
  const { db } = fakeDb([], { raceWinner: ['a'] });
  const claimed = await claimNewBlogPosts(db, [post('a'), post('b')], NOW);
  assert.deepEqual(claimed.map((p) => p.id), ['b']);
});

test('a non-duplicate insert error is rethrown and nothing is returned', async () => {
  const { db } = fakeDb([], { failInsert: new Error('network down') });
  await assert.rejects(() => claimNewBlogPosts(db, [post('a')], NOW), /network down/);
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx tsx --test src/lib/blog/blogAnnounce.test.ts`
Expected: FAIL — cannot find module `./blogAnnounce`.

- [ ] **Step 3: Write the claim** — `src/lib/blog/blogAnnounce.ts`

```ts
// The once-only step of blog notifications. Takes the Db as a parameter (no connectDB, no
// astro:content) so it runs against a fake in the unit test.
// Collection `blogAnnouncements`: { _id: <post slug>, announcedAt: Date } — the _id index IS the
// uniqueness guard, no extra index needed. A slug is claimed BEFORE anything is sent: two requests
// that see the same new post race on the insert, the loser gets a duplicate key and stays silent.
// At-most-once on purpose — a send that fails after the claim is not retried.
import type { Db } from 'mongodb';
import { pickUnannounced, type BlogPostRef } from './blogNotifyRules';

export const BLOG_ANNOUNCEMENTS_COLLECTION = 'blogAnnouncements';

interface AnnouncementDoc {
  _id: string;
  announcedAt: Date;
}

/** Returns the posts THIS call claimed. Throws on any error that is not a duplicate key. */
export async function claimNewBlogPosts(db: Db, posts: BlogPostRef[], now: Date): Promise<BlogPostRef[]> {
  const col = db.collection<AnnouncementDoc>(BLOG_ANNOUNCEMENTS_COLLECTION);
  const announced = new Set((await col.find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id));
  const fresh = pickUnannounced(posts, announced);
  const claimed: BlogPostRef[] = [];
  for (const p of fresh) {
    try {
      await col.insertOne({ _id: p.id, announcedAt: now });
      claimed.push(p);
    } catch (err) {
      if ((err as { code?: number })?.code !== 11000) throw err;
    }
  }
  return claimed;
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npx tsx --test src/lib/blog/blogAnnounce.test.ts`
Expected: 5 pass, 0 fail.

- [ ] **Step 5: Broadcast helper** — `src/lib/notifications.ts`, add directly after `notifyAllMembers()`:

```ts
/** Broadcast to every member who is not an admin (blog post announcements — the admin is the
 *  usual author, and a blog author is a plain name, not an account, so „except the author"
 *  cannot be expressed). Anonymized accounts are skipped like in notifyAllMembers(). */
export async function notifyMembersExceptAdmins(input: Omit<NotifyInput, 'userId' | 'actorId'>): Promise<void> {
  try {
    const db = await connectDB();
    const users = await db
      .collection('users')
      .find({ anonymized: { $ne: true }, role: { $ne: 'admin' } }, { projection: { _id: 1 } })
      .toArray();
    const userIds = users.map((u) => u._id.toString());
    if (!userIds.length) return;
    const now = new Date();
    const docs: NotificationDoc[] = userIds.map((userId) => ({ userId, ...input, createdAt: now, readAt: null }));
    await db.collection<NotificationDoc>('notifications').insertMany(docs, { ordered: false });
    await sendPushToUsers(userIds, buildPushPayload(input.type, input.target, input.meta));
  } catch (err) {
    await capture(err);
  }
}
```

- [ ] **Step 6: Entry point** — `src/lib/blog/blogNotify.ts`

```ts
// SERVER-ONLY (astro:content + mongodb). Announces new blog posts to members.
// Posts are repo MDX files — nothing „publishes" them inside the app — so the app looks for
// itself: called from the blog index, the blog detail page and the daily news cron. Cheap when
// nothing is new (one small read, skipped entirely for a minute per instance after a check).
// NEVER THROWS: a failure here must not break a page render or the cron.
import * as Sentry from '@sentry/astro';
import { getCollection } from 'astro:content';
import { connectDB } from '../mongodb';
import { notifyMembersExceptAdmins } from '../notifications';
import { claimNewBlogPosts } from './blogAnnounce';
import { blogNotification, type BlogPostRef } from './blogNotifyRules';

const RECHECK_MS = 60_000;
let lastCheck = 0;

export async function announceNewBlogPosts(): Promise<void> {
  const nowMs = Date.now();
  if (nowMs - lastCheck < RECHECK_MS) return;
  lastCheck = nowMs;
  try {
    const entries = await getCollection('blog', ({ data }) => !data.draft);
    const posts: BlogPostRef[] = entries
      .map((e) => ({ id: e.id, title: e.data.title, pubDateISO: e.data.pubDate.toISOString() }))
      .sort((a, b) => b.pubDateISO.localeCompare(a.pubDateISO) || a.id.localeCompare(b.id));
    const db = await connectDB();
    const claimed = await claimNewBlogPosts(db, posts, new Date(nowMs));
    const notification = blogNotification(claimed);
    if (!notification) return;
    await notifyMembersExceptAdmins({ type: 'blog', ...notification });
  } catch (err) {
    console.error('[blog-notify] failed:', err);
    try {
      Sentry.captureException(err);
      await Sentry.flush(2000);
    } catch {
      /* best-effort */
    }
  }
}
```

- [ ] **Step 7: Call sites**

`src/pages/blog/index.astro` — add the import after the `beilage` import line, and the call directly after the `Astro.response.headers.set(...)` line:

```ts
import { announceNewBlogPosts } from '../../lib/blog/blogNotify';
```
```ts
// New post on disk? Tell the members once (never throws; see src/lib/blog/blogNotify.ts).
await announceNewBlogPosts();
```

`src/pages/blog/[...slug].astro` — same import (same relative path) after the `beilage` import line, and the same two lines directly after its `Astro.response.headers.set(...)` line.

`src/pages/api/news/fetch-daily.ts` — add the import next to the `checkAirLoggerFreshness` import:

```ts
import { announceNewBlogPosts } from '../../../lib/blog/blogNotify';
```

and directly after the line `await checkAirLoggerFreshness();` add:

```ts
    // Also unrelated to news: announce a blog post nobody has opened yet since the deploy
    // (the blog pages do the same on their first visit). Never throws.
    await announceNewBlogPosts();
```

- [ ] **Step 8: Gates**

Run: `pnpm type-check 2>&1 | grep -c "error TS"` → `16`
Run: `npx -y svelte-check@4 2>&1 | tail -1` → `… 81 ERRORS …`
Run: `pnpm test 2>&1 | grep -E "ℹ (pass|fail)"` → `pass 299`, `fail 0`
Run: `pnpm build 2>&1 | tail -3` → build completes.

- [ ] **Step 9: Commit**

```bash
git add src/lib/blog/blogAnnounce.ts src/lib/blog/blogAnnounce.test.ts src/lib/blog/blogNotify.ts src/lib/notifications.ts src/pages/blog/index.astro "src/pages/blog/[...slug].astro" src/pages/api/news/fetch-daily.ts
git commit -m "feat: announce new blog posts to members, once per post"
```

---

## Controller's end-to-end check (not a subagent task)

On the local production build against the dev database (`mahalle-dev`; the check script refuses a db name without „dev"):
1. Count `notifications` of type `blog` and rows in `blogAnnouncements` before.
2. Open `/blog` once → exactly one `blog` notification per non-admin, non-anonymized member, none for an admin, one row `mahalle-installieren` in `blogAnnouncements`, none for the eleven older slugs.
3. Open `/blog` again after 61 s and restart the server once → counts unchanged.
4. Log in as a dev member at 390 px → the bell panel shows „Neu in der Beilage: ‚Mahalle aufs Handy holen — und keine Antwort mehr verpassen‘" and the row opens the post.
