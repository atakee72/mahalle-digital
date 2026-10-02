// Run directly:  npx tsx --test src/lib/blog/blogNotifyRules.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOG_NOTIFY_FROM_ISO, pickUnannounced, blogNotification, type BlogPostRef } from './blogNotifyRules';

const post = (id: string, day: string, title = `Titel ${id}`): BlogPostRef => ({ id, title, pubDateISO: `${day}T00:00:00.000Z` });

test('the start date is 2 October 2026', () => {
  assert.equal(BLOG_NOTIFY_FROM_ISO, '2026-10-02T00:00:00.000Z');
});

test('posts before the start date never qualify', () => {
  const posts = [post('alt-1', '2026-08-25'), post('alt-2', '2026-10-01'), post('neu', '2026-10-02')];
  assert.deepEqual(pickUnannounced(posts, new Set()).map((p) => p.id), ['neu']);
});

test('an already announced slug is skipped', () => {
  const posts = [post('a', '2026-10-02'), post('b', '2026-10-05')];
  assert.deepEqual(pickUnannounced(posts, new Set(['a'])).map((p) => p.id), ['b']);
  assert.deepEqual(pickUnannounced(posts, new Set(['a', 'b'])), []);
});

test('an unreadable date never qualifies', () => {
  assert.deepEqual(pickUnannounced([{ id: 'x', title: 'X', pubDateISO: 'kaputt' }], new Set()), []);
});

test('no posts → no notification', () => {
  assert.equal(blogNotification([]), null);
});

test('one post → its title and its page', () => {
  const n = blogNotification([post('mahalle-installieren', '2026-10-02', 'Mahalle aufs Handy holen')]);
  assert.deepEqual(n, {
    target: { contentType: 'blog', contentId: 'mahalle-installieren', title: 'Mahalle aufs Handy holen', href: '/blog/mahalle-installieren' },
  });
});

test('several posts fold into one, linking to the blog index', () => {
  const n = blogNotification([post('a', '2026-10-03'), post('b', '2026-10-03'), post('c', '2026-10-03')]);
  assert.deepEqual(n, {
    target: { contentType: 'blog', contentId: 'a', title: 'Titel a', href: '/blog' },
    meta: { count: 3 },
  });
});
