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

test('digest members: only a stored digest, not banned, not anonymized; the forum visit is read', async () => {
  const { db, calls } = fakeDb({
    users: [{ _id: 'u1', lastVisit: { forum: new Date(NOW - HOUR) } }, { _id: 'u2' }],
  });
  assert.deepEqual(await loadDigestMembers(db), [
    { id: 'u1', forumVisitMs: NOW - HOUR },
    { id: 'u2', forumVisitMs: null },
  ]);
  assert.deepEqual(calls[0].filter, {
    anonymized: { $ne: true }, isBanned: { $ne: true }, forumNotify: 'digest',
  });
});

test('every-post recipients: the author is left out, and a post is announced only once', async () => {
  const post = { id: 'p1', kind: 'topic' as const, title: 'Frage', authorId: 'u1', dateMs: NOW };
  const { db, data, calls } = fakeDb({ users: [{ _id: 'u1' }, { _id: 'u2' }, { _id: 'u3' }] });
  assert.deepEqual(await eachRecipients(db, post), ['u2', 'u3']);
  assert.deepEqual(calls.find((c) => c.collection === 'users')!.filter, {
    anonymized: { $ne: true }, isBanned: { $ne: true }, forumNotify: { $nin: ['digest', 'off'] },
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
