import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from 'mongodb';
import { getSectionNews } from './sectionNews';

const NOW = Date.parse('2026-10-03T08:00:00.000Z');
const HOUR = 3_600_000;

/** A Db double: `hits` names the collections whose query finds a document; every call is recorded. */
function fakeDb(hits: string[]) {
  const calls: { collection: string; filter: Record<string, any> }[] = [];
  const db = {
    collection: (name: string) => ({
      findOne: async (filter: Record<string, any>) => {
        calls.push({ collection: name, filter });
        return hits.includes(name) ? { _id: 'x' } : null;
      },
    }),
  } as unknown as Db;
  return { db, calls };
}

test('a member without any visit stamp gets no dot and no query', async () => {
  const { db, calls } = fakeDb(['topics', 'events', 'listings']);
  const news = await getSectionNews(db, 'me', undefined, [new Date(NOW - HOUR)], NOW);
  assert.deepEqual(news, { forum: false, kalender: false, markt: false, blog: false });
  assert.equal(calls.length, 0);
});

test('only sections with a stamp are asked, each with its own stamp', async () => {
  const { db, calls } = fakeDb(['announcements']);
  const forumAt = new Date(NOW - 5 * HOUR);
  const news = await getSectionNews(db, 'me', { forum: forumAt }, [], NOW);
  assert.deepEqual(news, { forum: true, kalender: false, markt: false, blog: false });
  assert.deepEqual(calls.map((c) => c.collection).sort(), ['announcements', 'recommendations', 'topics']);
  for (const c of calls) {
    assert.deepEqual(c.filter.date, { $gt: forumAt.getTime() });
    assert.deepEqual(c.filter.author, { $ne: 'me' });
  }
});

test('calendar, market and blog each follow their own stamp', async () => {
  const { db, calls } = fakeDb(['events', 'listings']);
  const news = await getSectionNews(
    db, 'me',
    { kalender: new Date(NOW - HOUR), markt: new Date(NOW - 2 * HOUR).toISOString(), blog: new Date(NOW - 3 * HOUR) },
    [new Date(NOW - 2 * HOUR)],
    NOW,
  );
  assert.deepEqual(news, { forum: false, kalender: true, markt: true, blog: true });
  assert.deepEqual(calls.map((c) => c.collection).sort(), ['events', 'listings']);
  const listing = calls.find((c) => c.collection === 'listings')!;
  assert.deepEqual(listing.filter.createdAt, { $gt: new Date(NOW - 2 * HOUR) });
});

test('a blog post older than the blog visit raises no dot', async () => {
  const { db } = fakeDb([]);
  const news = await getSectionNews(db, 'me', { blog: new Date(NOW - HOUR) }, [new Date(NOW - 2 * HOUR)], NOW);
  assert.equal(news.blog, false);
});

test('an unreadable stamp counts as no stamp', async () => {
  const { db, calls } = fakeDb(['topics']);
  const news = await getSectionNews(db, 'me', { forum: 'kaputt' }, [], NOW);
  assert.equal(news.forum, false);
  assert.equal(calls.length, 0);
});
