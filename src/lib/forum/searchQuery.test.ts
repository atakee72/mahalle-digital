import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeQuery, escapeRegex, buildSearchRegex, buildPostSearchFilter,
  excerptAround, KIND_BY_COLLECTION, PATH_BY_KIND, SEARCH_MAX_LEN,
} from './searchQuery';

test('normalizeQuery: trims, collapses whitespace, enforces 2–80', () => {
  assert.equal(normalizeQuery('  Schiller   markt '), 'Schiller markt');
  assert.equal(normalizeQuery('a'), null);
  assert.equal(normalizeQuery('   '), null);
  assert.equal(normalizeQuery(''), null);
  assert.equal(normalizeQuery(undefined), null);
  assert.equal(normalizeQuery(42), null);
  assert.equal(normalizeQuery('x'.repeat(SEARCH_MAX_LEN)), 'x'.repeat(SEARCH_MAX_LEN));
  assert.equal(normalizeQuery('x'.repeat(SEARCH_MAX_LEN + 1)), null);
  assert.equal(normalizeQuery('ab'), 'ab');
});

test('escapeRegex: metacharacters search literally', () => {
  assert.equal(escapeRegex('c++'), 'c\\+\\+');
  assert.equal(escapeRegex('(a) [b] {c} .*?^$|\\/'), '\\(a\\) \\[b\\] \\{c\\} \\.\\*\\?\\^\\$\\|\\\\\\/');
  assert.equal(buildSearchRegex('c++').test('I love C++ and Rust'), true);
  assert.equal(buildSearchRegex('.*').test('anything'), false);
  assert.equal(buildSearchRegex('.*').test('a .* b'), true);
  assert.doesNotThrow(() => buildSearchRegex('('));
});

test('buildPostSearchFilter: title, body, tags, case-insensitive', () => {
  const f = buildPostSearchFilter('Fahrrad') as { $or: Array<Record<string, RegExp>> };
  assert.equal(f.$or.length, 3);
  assert.deepEqual(f.$or.map((c) => Object.keys(c)[0]), ['title', 'body', 'tags']);
  for (const c of f.$or) {
    const rx = Object.values(c)[0];
    assert.ok(rx instanceof RegExp);
    assert.equal(rx.flags, 'i');
    assert.equal(rx.test('mein FAHRRAD ist weg'), true);
  }
});

test('excerptAround: window around the first match, ellipses, whitespace collapsed', () => {
  const body = 'A'.repeat(300) + ' Schillermarkt am Herrfurthplatz ' + 'B'.repeat(300);
  const ex = excerptAround(body, 'schillermarkt', 60);
  assert.ok(ex.length <= 60 + 2, ex);
  assert.ok(/Schillermarkt/.test(ex));
  assert.ok(ex.startsWith('…') && ex.endsWith('…'));
  assert.equal(excerptAround('kurz und gut', 'gut', 160), 'kurz und gut');
  assert.equal(excerptAround('line one\n\n   line two', 'two', 160), 'line one line two');
  assert.equal(excerptAround('no match here at all', 'zzz', 8), 'no matc…'); // len-1 chars + ellipsis
  assert.equal(excerptAround(null, 'x'), '');
  assert.equal(excerptAround(12, 'x'), '');
});

test('kind and path maps agree with the detail routes', () => {
  assert.equal(KIND_BY_COLLECTION.topics, 'discussion');
  assert.equal(KIND_BY_COLLECTION.announcements, 'announcement');
  assert.equal(KIND_BY_COLLECTION.recommendations, 'recommendation');
  assert.equal(PATH_BY_KIND.discussion, '/topics');
  assert.equal(PATH_BY_KIND.announcement, '/announcements');
  assert.equal(PATH_BY_KIND.recommendation, '/recommendations');
});
