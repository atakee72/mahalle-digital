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
