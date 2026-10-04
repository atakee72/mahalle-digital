import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from 'mongodb';
import { claimIssue, markIssue, loadIssueData, loadRecipients, KIEZ_BRIEF_COLLECTION } from './kiezBriefStore';

const NOW = Date.parse('2026-10-11T16:00:00.000Z'); // Sunday 18:00 CEST
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** In-memory Db double for the handful of calls the store makes. */
function fakeDb(seed: Record<string, any[]> = {}) {
  const data: Record<string, any[]> = { ...seed };
  const calls: { collection: string; op: string; filter?: any; update?: any }[] = [];
  const rows = (n: string) => (data[n] ??= []);
  const db = {
    collection: (name: string) => ({
      find: (filter: any) => {
        calls.push({ collection: name, op: 'find', filter });
        let list = [...rows(name)];
        if (filter?._id?.$in) list = list.filter((r) => filter._id.$in.some((id: any) => String(id) === String(r._id)));
        const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => list };
        return cursor;
      },
      insertOne: async (doc: any) => {
        if (rows(name).some((r) => r._id === doc._id)) throw Object.assign(new Error('dup'), { code: 11000 });
        rows(name).push(doc);
      },
      updateOne: async (filter: any, update: any) => { calls.push({ collection: name, op: 'updateOne', filter, update }); },
    }),
  } as unknown as Db;
  return { db, data, calls };
}

test('an issue is claimed once; the second claim of the same week loses', async () => {
  const { db, data } = fakeDb();
  assert.equal(await claimIssue(db, '2026-W41', NOW, false), true);
  assert.equal(await claimIssue(db, '2026-W41', NOW + 14 * HOUR, true), false);
  assert.equal(data[KIEZ_BRIEF_COLLECTION].length, 1);
  assert.deepEqual(data[KIEZ_BRIEF_COLLECTION][0].windowFrom, new Date(NOW - 7 * DAY));
  assert.equal(data[KIEZ_BRIEF_COLLECTION][0].fallback, false);
});

test('a database error other than the duplicate key is passed on', async () => {
  const db = { collection: () => ({ insertOne: async () => { throw Object.assign(new Error('down'), { code: 91 }); } }) } as unknown as Db;
  await assert.rejects(() => claimIssue(db, '2026-W41', NOW, false), /down/);
});

test('markIssue patches the claim row', async () => {
  const { db, calls } = fakeDb();
  await markIssue(db, '2026-W41', { recipients: 3, sentAt: new Date(NOW) });
  assert.deepEqual(calls[0].filter, { _id: '2026-W41' });
  assert.deepEqual(calls[0].update, { $set: { recipients: 3, sentAt: new Date(NOW) } });
});

test('issue data: public posts of the week with author names, next week\'s events, new listings, blog in window', async () => {
  const { db, calls } = fakeDb({
    topics: [{ _id: 't1', title: 'Frage', author: '6abfe378539f08486ac89c2a', comments: ['c1', 'c2'], date: NOW - 2 * HOUR }],
    announcements: [],
    recommendations: [{ _id: 'r1', title: 'Tipp', author: 'kaputt', comments: [], date: NOW - DAY }],
    events: [{ _id: 'e1', title: 'Flohmarkt', startDate: new Date(NOW + 2 * DAY), allDay: true, location: ' Herrfurthplatz ' }],
    listings: [{ _id: 'l1', title: 'Lampe', listingType: 'sell', price: 12.5, createdAt: new Date(NOW - 3 * DAY) }, { _id: 'l2', title: 'Stuhl', listingType: 'gift', price: 0, createdAt: new Date(NOW - HOUR) }],
    users: [{ _id: '6abfe378539f08486ac89c2a', name: 'Ayşe' }],
    schillerkiez_air_daily: [],
    schillerkiez_air_log: [{ ts: new Date(NOW - HOUR), lqi: 2 }],
  });
  const blog = [
    { slug: 'neu', title: 'Neu', description: 'd', pubDate: new Date(NOW - DAY) },
    { slug: 'alt', title: 'Alt', description: 'd', pubDate: new Date(NOW - 30 * DAY) },
    { slug: 'entwurf', title: 'E', description: 'd', pubDate: new Date(NOW - DAY), draft: true },
  ];
  const d = await loadIssueData(db, '2026-W41', NOW, blog);
  assert.equal(d.week, '2026-W41');
  assert.deepEqual(d.posts.map((p) => [p.id, p.kind, p.author, p.comments]), [['t1', 'topic', 'Ayşe', 2], ['r1', 'recommendation', null, 0]]);
  assert.deepEqual(d.events, [{ id: 'e1', title: 'Flohmarkt', startMs: NOW + 2 * DAY, allDay: true, location: 'Herrfurthplatz' }]);
  assert.deepEqual(d.listings.map((l) => [l.id, l.kind, l.price]), [['l2', 'gift', null], ['l1', 'sell', 12.5]]);
  assert.deepEqual(d.blog.map((b) => b.slug), ['neu']);
  assert.deepEqual(d.air, { lqi: 2 });
  const topics = calls.find((c) => c.collection === 'topics')!.filter;
  assert.deepEqual(topics.date, { $gt: NOW - 7 * DAY, $lte: NOW });
  assert.deepEqual(topics.isOfficial, { $ne: true });
  assert.deepEqual(topics.hasWarningLabel, { $ne: true });
  const events = calls.find((c) => c.collection === 'events')!.filter;
  assert.deepEqual(events.startDate, { $gte: new Date(NOW), $lt: new Date(NOW + 7 * DAY) });
  assert.deepEqual(events.visibility, { $ne: 'private' });
  const listings = calls.find((c) => c.collection === 'listings')!.filter;
  assert.deepEqual(listings.status, { $in: ['available', 'reserved'] });
  const users = calls.find((c) => c.collection === 'users')!.filter;
  assert.equal(users._id.$in.length, 1); // the unreadable author id is not looked up
});

test('a failing air lookup leaves the air line out, nothing else', async () => {
  const base = fakeDb({ topics: [], announcements: [], recommendations: [], events: [], listings: [] });
  const db = {
    collection: (name: string) => (name.startsWith('schillerkiez_air') ? { find: () => { throw new Error('air down'); } } : base.db.collection(name)),
  } as unknown as Db;
  const d = await loadIssueData(db, '2026-W41', NOW, []);
  assert.equal(d.air, null);
  assert.equal(d.posts.length, 0);
});

test('recipients: verified, not anonymized, not banned, not off, not in deletion grace, with an e-mail string', async () => {
  const { db, calls } = fakeDb({ users: [{ _id: 'u1', email: 'a@b.c', name: 'A', locale: 'en' }, { _id: 'u2', email: 'd@e.f' }] });
  assert.deepEqual(await loadRecipients(db), [{ id: 'u1', email: 'a@b.c', name: 'A', locale: 'en' }, { id: 'u2', email: 'd@e.f', name: null, locale: 'de' }]);
  assert.deepEqual(calls[0].filter, {
    emailVerified: true, anonymized: { $ne: true }, isBanned: { $ne: true }, newsletter: { $ne: 'off' }, deletionScheduledAt: { $exists: false }, email: { $type: 'string' },
  });
});
