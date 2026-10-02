import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VISIT_SESSION_MS, NO_NEWS, toMs, isNewItem, pickBaseline, parseBaseline,
  forumNewsFilter, eventNewsFilter, listingNewsFilter, blogHasNews,
} from './visitRules';

const T0 = Date.parse('2026-10-03T08:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

test('toMs reads numbers, dates and ISO strings and refuses the rest', () => {
  assert.equal(toMs(T0), T0);
  assert.equal(toMs(new Date(T0)), T0);
  assert.equal(toMs(iso(T0)), T0);
  for (const bad of [null, undefined, '', 'gestern', NaN, new Date('x'), {}, true]) assert.equal(toMs(bad), null);
});

test('an item is new only when it is younger than the baseline', () => {
  assert.equal(isNewItem(T0 + 1, 'a', iso(T0), 'me'), true);
  assert.equal(isNewItem(T0, 'a', iso(T0), 'me'), false);
  assert.equal(isNewItem(T0 - 1, 'a', iso(T0), 'me'), false);
});

test('without a baseline nothing is new (first visit)', () => {
  assert.equal(isNewItem(T0 + 1, 'a', null, 'me'), false);
  assert.equal(isNewItem(T0 + 1, 'a', undefined, 'me'), false);
});

test('own content is never new; an item without author or a logged-out viewer still can be', () => {
  assert.equal(isNewItem(T0 + 1, 'me', iso(T0), 'me'), false);
  assert.equal(isNewItem(T0 + 1, null, iso(T0), 'me'), true);
  assert.equal(isNewItem(T0 + 1, 'a', iso(T0), null), true);
});

test('an unreadable creation date is not new', () => {
  assert.equal(isNewItem(undefined, 'a', iso(T0), 'me'), false);
  assert.equal(isNewItem('kaputt', 'a', iso(T0), 'me'), false);
});

test('a reload inside the visit keeps the baseline, a later visit takes the server stamp', () => {
  const first = pickBaseline(null, iso(T0), T0 + 1000);
  assert.deepEqual(first, { since: iso(T0), at: T0 + 1000 });
  const reload = pickBaseline(first, iso(T0 + 1000), T0 + 60_000);
  assert.deepEqual(reload, first);
  const later = pickBaseline(first, iso(T0 + 60_000), first.at + VISIT_SESSION_MS);
  assert.deepEqual(later, { since: iso(T0 + 60_000), at: first.at + VISIT_SESSION_MS });
});

test('a stored baseline from the future (clock change) is dropped', () => {
  const b = pickBaseline({ since: iso(T0), at: T0 + 5000 }, null, T0);
  assert.deepEqual(b, { since: null, at: T0 });
});

test('parseBaseline accepts its own output and refuses anything else', () => {
  const b = { since: iso(T0), at: T0 };
  assert.deepEqual(parseBaseline(JSON.stringify(b)), b);
  assert.deepEqual(parseBaseline(JSON.stringify({ since: null, at: T0 })), { since: null, at: T0 });
  for (const bad of [null, '', '{', '[]', '{"since":"x","at":1}', '{"since":null,"at":"1"}', '{"since":5,"at":1}']) {
    assert.equal(parseBaseline(bad), null);
  }
});

test('the dot filters look only at public content of other members', () => {
  const f = forumNewsFilter(T0, 'me');
  assert.deepEqual(f.date, { $gt: T0 });
  assert.deepEqual(f.author, { $ne: 'me' });
  assert.deepEqual(f.$or, [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }]);

  const e = eventNewsFilter(T0, 'me', T0 + 5);
  assert.deepEqual(e.endDate, { $gte: new Date(T0 + 5) });
  assert.deepEqual(e.author, { $ne: 'me' });

  const l = listingNewsFilter(T0, 'me');
  assert.deepEqual(l.createdAt, { $gt: new Date(T0) });
  assert.deepEqual(l.sellerId, { $ne: 'me' });
  assert.deepEqual(l.status, { $in: ['available', 'reserved'] });
});

test('the blog has news when a post is dated after the visit, but not for a future-dated post', () => {
  assert.equal(blogHasNews([iso(T0 - 1), new Date(T0 + 10)], T0, T0 + 100), true);
  assert.equal(blogHasNews([iso(T0 - 1), iso(T0)], T0, T0 + 100), false);
  assert.equal(blogHasNews([iso(T0 + 500)], T0, T0 + 100), false);
  assert.equal(blogHasNews([], T0, T0 + 100), false);
  assert.equal(blogHasNews(['kaputt', null], T0, T0 + 100), false);
});

test('NO_NEWS names all four sections', () => {
  assert.deepEqual(NO_NEWS, { forum: false, kalender: false, markt: false, blog: false });
});
