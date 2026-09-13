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
  store.set('flaggedContent', [
    { _id: new ObjectId(), contentId: id, contentType: 'topic', status: 'reviewed' },
    { _id: new ObjectId(), contentType: 'comment', contentId: 'c9', parentPostId: id, parentCollection: 'topics' },
  ]);
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
  assert.equal(store.get('flaggedContent')![1].parentCollection, 'announcements');
  assert.equal(store.get('flaggedContent')![1].contentType, 'comment');
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
