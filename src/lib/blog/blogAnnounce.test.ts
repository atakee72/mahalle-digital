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
