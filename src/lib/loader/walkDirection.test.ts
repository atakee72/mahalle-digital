import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkDirection, sectionIndex } from './walkDirection';

test('sections follow the nav bar order', () => {
  assert.deepEqual(
    ['/forum', '/calendar', '/newsboard', '/marketplace', '/schillerkiez', '/blog'].map(sectionIndex),
    [0, 1, 2, 3, 4, 5]
  );
});

test('a page inside a section counts as that section', () => {
  assert.equal(sectionIndex('/topics/abc123'), 0);
  assert.equal(sectionIndex('/announcements/abc'), 0);
  assert.equal(sectionIndex('/recommendations/abc'), 0);
  assert.equal(sectionIndex('/events/abc'), 1);
  assert.equal(sectionIndex('/marketplace/abc/edit'), 3);
  assert.equal(sectionIndex('/schillerkiez/druck'), 4);
  assert.equal(sectionIndex('/blog/das-klemmbrett'), 5);
});

test('a prefix must end at a path boundary', () => {
  assert.equal(sectionIndex('/blogroll'), -1);
  assert.equal(sectionIndex('/forumx'), -1);
});

test('pages without a place in the nav bar have no section', () => {
  for (const p of ['/profile', '/search', '/bookmarks', '/nachbarn/ayse', '/', '/login']) assert.equal(sectionIndex(p), -1);
});

test('a target further right in the nav bar walks right', () => {
  assert.equal(walkDirection('/forum', '/blog', false), 'right');
  assert.equal(walkDirection('/calendar', '/newsboard', false), 'right');
  assert.equal(walkDirection('/topics/abc', '/marketplace', false), 'right');
});

test('a target further left in the nav bar walks left', () => {
  assert.equal(walkDirection('/blog', '/schillerkiez', false), 'left');
  assert.equal(walkDirection('/blog/some-post', '/forum', false), 'left');
});

test('the nav bar position wins over the back button', () => {
  assert.equal(walkDirection('/forum', '/blog', true), 'right');
  assert.equal(walkDirection('/blog', '/forum', true), 'left');
});

test('inside one section: deeper walks right, back up walks left', () => {
  assert.equal(walkDirection('/forum', '/topics/abc', false), 'right');
  assert.equal(walkDirection('/topics/abc', '/forum', false), 'left');
  assert.equal(walkDirection('/blog', '/blog/a-post', false), 'right');
  assert.equal(walkDirection('/blog/a-post', '/blog', false), 'left');
  assert.equal(walkDirection('/blog/a-post', '/blog/another', false), 'right');
});

test('inside one section the back button walks left', () => {
  assert.equal(walkDirection('/blog/a-post', '/blog/another', true), 'left');
});

test('a page without a place walks right, and left on the back button', () => {
  assert.equal(walkDirection('/forum', '/profile', false), 'right');
  assert.equal(walkDirection('/profile', '/forum', false), 'right');
  assert.equal(walkDirection('/search', '/profile', false), 'right');
  assert.equal(walkDirection('/profile', '/forum', true), 'left');
});

test('a trailing slash changes nothing', () => {
  assert.equal(walkDirection('/blog/', '/forum/', false), 'left');
  assert.equal(walkDirection('/blog/a-post/', '/blog/', false), 'left');
});
