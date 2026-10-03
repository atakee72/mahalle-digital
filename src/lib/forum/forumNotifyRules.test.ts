import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  storedForumNotify, digestWindowStart, berlinDay, newestFirst, digestPostsFor,
  forumNotification, planDigest, DIGEST_MAX_LOOKBACK_MS, type ForumPostRef,
} from './forumNotifyRules';

const NOW = Date.parse('2026-10-03T06:00:00.000Z');
const HOUR = 3_600_000;
const post = (id: string, authorId: string, hoursAgo: number, kind: ForumPostRef['kind'] = 'topic'): ForumPostRef =>
  ({ id, kind, title: `Titel ${id}`, authorId, dateMs: NOW - hoursAgo * HOUR });

test('the stored preference falls back to every post', () => {
  assert.equal(storedForumNotify('digest'), 'digest');
  assert.equal(storedForumNotify('off'), 'off');
  for (const v of [undefined, null, '', 'each', 'DIGEST', 1, {}]) assert.equal(storedForumNotify(v), 'each');
});

test('the window starts where the previous digest ended', () => {
  assert.equal(digestWindowStart(NOW - 23 * HOUR, NOW), NOW - 23 * HOUR);
});

test('the first digest and a broken previous stamp look 24 hours back', () => {
  assert.equal(digestWindowStart(null, NOW), NOW - 24 * HOUR);
  assert.equal(digestWindowStart(NaN, NOW), NOW - 24 * HOUR);
  assert.equal(digestWindowStart(NOW + HOUR, NOW), NOW - 24 * HOUR);
});

test('after missed mornings the window is capped at two days', () => {
  assert.equal(digestWindowStart(NOW - 9 * 24 * HOUR, NOW), NOW - DIGEST_MAX_LOOKBACK_MS);
});

test('the day key is the Berlin calendar day, also right after midnight', () => {
  assert.equal(berlinDay(Date.parse('2026-10-02T21:59:00.000Z')), '2026-10-02'); // 23:59 Berlin (CEST)
  assert.equal(berlinDay(Date.parse('2026-10-02T22:00:00.000Z')), '2026-10-03'); // 00:00 Berlin
  assert.equal(berlinDay(Date.parse('2026-12-31T23:30:00.000Z')), '2027-01-01'); // 00:30 Berlin (CET)
});

test('own posts and posts seen at the last forum visit are left out', () => {
  const posts = newestFirst([post('a', 'me', 1), post('b', 'x', 2), post('c', 'y', 10), post('d', 'x', 30)]);
  const start = NOW - 24 * HOUR;
  assert.deepEqual(digestPostsFor({ id: 'me', forumVisitMs: null }, posts, start).map((p) => p.id), ['b', 'c']);
  assert.deepEqual(digestPostsFor({ id: 'me', forumVisitMs: NOW - 5 * HOUR }, posts, start).map((p) => p.id), ['b']);
  assert.deepEqual(digestPostsFor({ id: 'me', forumVisitMs: NOW }, posts, start), []);
  // a visit long before the window does not widen it
  assert.deepEqual(digestPostsFor({ id: 'z', forumVisitMs: NOW - 90 * HOUR }, posts, start).map((p) => p.id), ['a', 'b', 'c']);
});

test('one post links to the post, several to the forum with a count', () => {
  assert.equal(forumNotification([]), null);
  assert.deepEqual(forumNotification([post('r1', 'x', 1, 'recommendation')]), {
    target: { contentType: 'recommendation', contentId: 'r1', title: 'Titel r1', href: '/recommendations/r1' },
  });
  assert.deepEqual(forumNotification([post('a', 'x', 1), post('b', 'y', 2), post('c', 'y', 3)]), {
    target: { contentType: 'forum', contentId: 'a', title: 'Titel a', href: '/forum' },
    meta: { count: 3 },
  });
});

test('members who are told the same thing share a group; nobody gets an empty one', () => {
  const posts = [post('a', 'u1', 1), post('b', 'u2', 2)];
  const members = [
    { id: 'u1', forumVisitMs: null },            // author of a → hears about b
    { id: 'u2', forumVisitMs: null },            // author of b → hears about a
    { id: 'u3', forumVisitMs: null },            // both
    { id: 'u4', forumVisitMs: null },            // both
    { id: 'u5', forumVisitMs: NOW },             // has seen everything → nothing
  ];
  const groups = planDigest(members, posts, NOW - 24 * HOUR);
  const byUsers = Object.fromEntries(groups.map((g) => [g.userIds.join('+'), g]));
  assert.deepEqual(Object.keys(byUsers).sort(), ['u1', 'u2', 'u3+u4']);
  assert.equal(byUsers['u1'].target.contentId, 'b');
  assert.equal(byUsers['u1'].meta, undefined);
  assert.equal(byUsers['u2'].target.contentId, 'a');
  assert.deepEqual(byUsers['u3+u4'].meta, { count: 2 });
  assert.equal(byUsers['u3+u4'].target.href, '/forum');
});

test('no posts, no groups', () => {
  assert.deepEqual(planDigest([{ id: 'u1', forumVisitMs: null }], [], NOW - 24 * HOUR), []);
});

test('posts of the same millisecond keep a stable order', () => {
  assert.deepEqual(newestFirst([post('b', 'x', 1), post('a', 'x', 1), post('c', 'x', 0)]).map((p) => p.id), ['c', 'a', 'b']);
});
