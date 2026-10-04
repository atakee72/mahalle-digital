import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from 'mongodb';
import {
  claimIssue, markIssue, loadIssueData, loadRecipients, findSentIssue, loadSentIssue, listSentIssues, KIEZ_BRIEF_COLLECTION,
  type IssueDoc,
} from './kiezBriefStore';

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
        if (filter?.sentAt?.$type === 'date') list = list.filter((r) => r.sentAt instanceof Date);
        if (filter?.isOfficial === true) list = list.filter((r) => r.isOfficial === true);
        if (filter?.isOfficial?.$ne === true) list = list.filter((r) => r.isOfficial !== true);
        const cursor = {
          sort: (spec: Record<string, 1 | -1> = {}) => {
            const [key, dir] = Object.entries(spec)[0] ?? [];
            if (key) list.sort((a, b) => (Number(a[key]) - Number(b[key])) * (dir as number));
            return cursor;
          },
          limit: (n: number) => { list = list.slice(0, n); return cursor; },
          toArray: async () => list,
        };
        return cursor;
      },
      countDocuments: async (filter: any) => {
        calls.push({ collection: name, op: 'countDocuments', filter });
        return rows(name).length;
      },
      findOne: async (filter: any) => {
        calls.push({ collection: name, op: 'findOne', filter });
        return rows(name).find((r) => r._id === filter._id && (filter.sentAt?.$type !== 'date' || r.sentAt instanceof Date)) ?? null;
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
    topics: [{ _id: 't1', title: 'Frage', author: '6abfe378539f08486ac89c2a', comments: ['c1', 'c2'], date: NOW - 2 * HOUR, images: [{ url: 'https://res.cloudinary.com/demo/image/upload/v1/mahalle/posts/a.jpg' }] }],
    announcements: [],
    recommendations: [{ _id: 'r1', title: 'Tipp', author: 'kaputt', comments: [], date: NOW - DAY }],
    events: [{ _id: 'e1', title: 'Flohmarkt', startDate: new Date(NOW + 2 * DAY), allDay: true, location: ' Herrfurthplatz ' }],
    listings: [{ _id: 'l1', title: 'Lampe', listingType: 'sell', price: 12.5, createdAt: new Date(NOW - 3 * DAY), images: ['https://res.cloudinary.com/other/image/upload/v1/mahalle/listings/b.jpg'] }, { _id: 'l2', title: 'Stuhl', listingType: 'gift', price: 0, createdAt: new Date(NOW - HOUR) }],
    users: [{ _id: '6abfe378539f08486ac89c2a', name: 'Ayşe' }],
    schillerkiez_air_daily: [],
    schillerkiez_air_log: [{ ts: new Date(NOW - HOUR), lqi: 2 }],
  });
  const blog = [
    { slug: 'neu', title: 'Neu', description: 'd', pubDate: new Date(NOW - DAY) },
    { slug: 'alt', title: 'Alt', description: 'd', pubDate: new Date(NOW - 30 * DAY) },
    { slug: 'entwurf', title: 'E', description: 'd', pubDate: new Date(NOW - DAY), draft: true },
  ];
  const d = await loadIssueData(db, '2026-W41', NOW, blog, { cloud: 'demo' });
  assert.equal(d.week, '2026-W41');
  assert.deepEqual(d.posts.map((p) => [p.id, p.kind, p.author, p.comments]), [['t1', 'topic', 'Ayşe', 2], ['r1', 'recommendation', null, 0]]);
  assert.deepEqual(d.events, [{ id: 'e1', title: 'Flohmarkt', startMs: NOW + 2 * DAY, allDay: true, location: 'Herrfurthplatz' }]);
  assert.deepEqual(d.listings.map((l) => [l.id, l.kind, l.price]), [['l2', 'gift', null], ['l1', 'sell', 12.5]]);
  assert.equal(d.posts[0].image, 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_160,h_160,c_fill/v1/mahalle/posts/a.jpg');
  assert.equal(d.listings.find((l) => l.id === 'l1')!.image, null); // another cloud: dropped
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

const issue = (week: string, patch: Partial<IssueDoc> = {}): IssueDoc => ({
  _id: week, windowFrom: new Date(NOW - 7 * DAY), windowTo: new Date(NOW), claimedAt: new Date(NOW), fallback: false, ...patch,
});

test('findSentIssue: only a sent week; skipped, unsent, unknown and malformed keys are null', async () => {
  const { db, calls } = fakeDb({
    [KIEZ_BRIEF_COLLECTION]: [
      issue('2026-W41', { recipients: 12, sentAt: new Date(NOW + 60_000) }),
      issue('2026-W40', { skipped: 'quiet', recipients: 0 }),
      issue('2026-W39', { recipients: 0 }), // claimed, never sent (failed send or no transport)
    ],
  });
  assert.equal((await findSentIssue(db, '2026-W41'))?._id, '2026-W41');
  assert.equal(await findSentIssue(db, '2026-W40'), null);
  assert.equal(await findSentIssue(db, '2026-W39'), null);
  assert.equal(await findSentIssue(db, '2026-W38'), null);
  assert.deepEqual(calls[0].filter, { _id: '2026-W41', sentAt: { $type: 'date' } });
  const before = calls.length;
  for (const bad of ['', '2026-W00', '2026-W54', '2026-w41', '2026-W41/..', ' 2026-W41', '../admin', undefined, null, 41, { $ne: null }]) {
    assert.equal(await findSentIssue(db, bad), null);
  }
  assert.equal(calls.length, before); // a malformed key never reaches the database
});

test('loadSentIssue: the STORED window, not today\'s; no air lookup at all', async () => {
  const LATER = NOW + 30 * DAY; // the member opens the issue a month later
  const { db, calls } = fakeDb({
    topics: [{ _id: 't1', title: 'Frage', author: 'x', comments: [], date: NOW - HOUR }],
    announcements: [], recommendations: [], events: [], listings: [],
    schillerkiez_air_log: [{ ts: new Date(LATER), lqi: 4 }],
  });
  const d = await loadSentIssue(db, issue('2026-W41', { sentAt: new Date(NOW) }), [{ slug: 'neu', title: 'Neu', description: 'd', pubDate: new Date(NOW - DAY) }, { slug: 'spaeter', title: 'S', description: 'd', pubDate: new Date(LATER - DAY) }], { cloud: 'demo' });
  assert.equal(d.week, '2026-W41');
  assert.equal(d.air, null);
  assert.equal(calls.some((c) => c.collection.startsWith('schillerkiez_air')), false);
  assert.deepEqual(calls.find((c) => c.collection === 'topics')!.filter.date, { $gt: NOW - 7 * DAY, $lte: NOW });
  assert.deepEqual(calls.find((c) => c.collection === 'events')!.filter.startDate, { $gte: new Date(NOW), $lt: new Date(NOW + 7 * DAY) });
  assert.deepEqual(d.blog.map((b) => b.slug), ['neu']); // a post published after the issue is not in it
});

test('loadSentIssue: the caller cannot switch the air line back on', async () => {
  const { db, calls } = fakeDb({ topics: [], announcements: [], recommendations: [], events: [], listings: [], schillerkiez_air_log: [{ ts: new Date(NOW), lqi: 2 }] });
  const d = await loadSentIssue(db, issue('2026-W41', { sentAt: new Date(NOW) }), [], { air: true });
  assert.equal(d.air, null);
  assert.equal(calls.some((c) => c.collection.startsWith('schillerkiez_air')), false);
});

test('listSentIssues: sent weeks only, newest first, capped', async () => {
  const { db, calls } = fakeDb({
    [KIEZ_BRIEF_COLLECTION]: [
      issue('2026-W40', { sentAt: new Date(NOW - 7 * DAY) }),
      issue('2026-W42', { sentAt: new Date(NOW + 7 * DAY) }),
      issue('2026-W41', { skipped: 'quota', recipients: 0 }),
      issue('2026-W39', { sentAt: new Date(NOW - 14 * DAY) }),
    ],
  });
  assert.deepEqual(await listSentIssues(db), [
    { week: '2026-W42', sentAtMs: NOW + 7 * DAY },
    { week: '2026-W40', sentAtMs: NOW - 7 * DAY },
    { week: '2026-W39', sentAtMs: NOW - 14 * DAY },
  ]);
  assert.deepEqual(calls[0].filter, { sentAt: { $type: 'date' } });
  assert.deepEqual((await listSentIssues(db, 2)).map((i) => i.week), ['2026-W42', '2026-W40']);
  assert.deepEqual(await listSentIssues(fakeDb().db), []);
});

test('issue data: the week\'s official announcements are their own section, never in the forum list; news is one number', async () => {
  const { db, calls } = fakeDb({
    topics: [], recommendations: [], events: [], listings: [],
    announcements: [
      { _id: 'o1', title: 'Neu: die Suche', body: 'Oben rechts die **Lupe** antippen.', date: NOW - 3 * HOUR, isOfficial: true },
      { _id: 'a1', title: 'Hofflohmarkt', author: 'kaputt', comments: [], date: NOW - 5 * HOUR },
    ],
    news: [{ _id: 'n1' }, { _id: 'n2' }, { _id: 'n3' }],
  });
  const d = await loadIssueData(db, '2026-W41', NOW, [], { air: false });
  assert.deepEqual(d.official, [{ id: 'o1', title: 'Neu: die Suche', excerpt: 'Oben rechts die Lupe antippen.', dateMs: NOW - 3 * HOUR }]);
  assert.deepEqual(d.posts.map((p) => p.id), ['a1']);
  assert.equal(d.newsCount, 3);
  const official = calls.find((c) => c.collection === 'announcements' && c.filter.isOfficial === true)!.filter;
  assert.deepEqual(official.date, { $gt: NOW - 7 * DAY, $lte: NOW });
  assert.deepEqual(official.hasWarningLabel, { $ne: true });
  const news = calls.find((c) => c.collection === 'news')!;
  assert.equal(news.op, 'countDocuments');
  assert.deepEqual(news.filter, { moderationStatus: 'approved', fetchDate: { $gt: '2026-10-04', $lte: '2026-10-11' } });
});

test('a failing news count drops the teaser, nothing else', async () => {
  const base = fakeDb({ topics: [{ _id: 't1', title: 'Frage', author: 'x', comments: [], date: NOW - HOUR }], announcements: [], recommendations: [], events: [], listings: [] });
  const db = {
    collection: (name: string) => (name === 'news' ? { countDocuments: async () => { throw new Error('news down'); } } : base.db.collection(name)),
  } as unknown as Db;
  const d = await loadIssueData(db, '2026-W41', NOW, [], { air: false });
  assert.equal(d.newsCount, 0);
  assert.deepEqual(d.posts.map((p) => p.id), ['t1']);
});
