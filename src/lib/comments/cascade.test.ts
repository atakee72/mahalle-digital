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
