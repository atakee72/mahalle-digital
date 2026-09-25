import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTIONS, SEARCH_PER_SECTION, berlinDay, eventHref, eventDayLabel, plainMdx,
  searchBlogEntries, forumToHits, emptyHits, countHits, type BlogSearchEntry, type SiteSearchResult,
} from './siteSearch';

test('SECTIONS: the five member sections in nav order', () => {
  assert.deepEqual(SECTIONS, ['forum', 'calendar', 'marketplace', 'news', 'blog']);
});

test('berlinDay + eventHref: the event day is Berlin time, not UTC', () => {
  assert.equal(berlinDay(new Date('2026-09-26T22:30:00Z')), '2026-09-27'); // CEST +2
  assert.equal(berlinDay(new Date('2026-12-31T23:30:00Z')), '2027-01-01'); // CET +1
  assert.equal(berlinDay('2026-09-26T08:00:00.000Z'), '2026-09-26');
  assert.equal(eventHref('abc', new Date('2026-09-26T22:30:00Z')), '/calendar?event=abc&d=2026-09-27');
  assert.equal(eventHref('abc', 'not a date'), '/calendar?event=abc'); // no `d` rather than a wrong one
  assert.equal(eventHref('abc', null), '/calendar?event=abc');
});

test('eventDayLabel: weekday + day.month (+ time unless all-day), Berlin zone', () => {
  const iso = '2026-09-26T08:00:00.000Z'; // 10:00 Berlin
  assert.equal(eventDayLabel(iso, 'de', false), 'Sa., 26.09. · 10:00');
  assert.equal(eventDayLabel(iso, 'de', true), 'Sa., 26.09.');
  assert.equal(eventDayLabel(iso, 'en', false), 'Sat 26/09 · 10:00'); // en-GB: no comma after the weekday
  assert.equal(eventDayLabel(null, 'de', false), '');
  assert.equal(eventDayLabel('nope', 'de', false), '');
});

test('plainMdx: imports, tags and markdown syntax go, words stay', () => {
  const body = `import Foo from '../x.astro';\n\n# Titel\n\n<Foo prop="1" />\nDer **Schillermarkt** findet [hier](/x) statt.\n\n> Zitat\n\n![alt](img.jpg)`;
  assert.equal(plainMdx(body), 'Titel Der Schillermarkt findet hier statt. Zitat alt');
  assert.equal(plainMdx(''), '');
});

const entry = (over: Partial<BlogSearchEntry>): BlogSearchEntry => ({
  id: 'p', title: 'T', description: 'D', tags: [], author: 'A', draft: false,
  pubDateISO: '2026-09-01T00:00:00.000Z', body: '', ...over,
});

test('searchBlogEntries: drafts never, matches title/description/tags/body, newest first, capped', () => {
  const entries = [
    entry({ id: 'draft', title: 'Schillermarkt geheim', draft: true }),
    entry({ id: 'old', title: 'Alt', body: 'Der Schillermarkt war schön.', pubDateISO: '2026-08-01T00:00:00.000Z' }),
    entry({ id: 'tagged', tags: ['schillermarkt'], pubDateISO: '2026-09-10T00:00:00.000Z' }),
    entry({ id: 'desc', description: 'Rund um den Schillermarkt', pubDateISO: '2026-09-05T00:00:00.000Z' }),
    entry({ id: 'none', title: 'Nichts', body: 'nichts' }),
  ];
  const hits = searchBlogEntries(entries, 'schillermarkt');
  assert.deepEqual(hits.map((h) => h.id), ['tagged', 'desc', 'old']);
  assert.equal(hits[0].section, 'blog');
  assert.equal(hits[0].kind, 'post');
  assert.equal(hits[0].href, '/blog/tagged');
  assert.equal(hits[0].sub, 'A');
  assert.equal(hits[2].excerpt, 'Der Schillermarkt war schön.'); // body match → excerpt around it
  assert.equal(hits[1].excerpt, 'Rund um den Schillermarkt');     // no body match → description
  assert.equal(searchBlogEntries(entries, 'schillermarkt', 1).length, 1);
  // sortDate (order-only) wins over pubDate, like the blog index
  const late = entry({ id: 'late', title: 'Schillermarkt', pubDateISO: '2026-09-20T00:00:00.000Z', sortISO: '2026-08-15T00:00:00.000Z' });
  assert.deepEqual(searchBlogEntries([...entries, late], 'schillermarkt').map((h) => h.id), ['tagged', 'desc', 'late', 'old']);
});

test('forumToHits: posts then comments, comment title = parent title', () => {
  const r = {
    q: 'x',
    posts: [{ _id: 'p1', kind: 'announcement' as const, href: '/announcements/p1', title: 'A', excerpt: 'e', tags: ['t'], date: '2026-09-01T00:00:00.000Z', author: { name: 'Ayşe', handle: 'ayse' } }],
    comments: [{ _id: 'c1', href: '/topics/p2#comment-c1', excerpt: 'ce', date: null, parentTitle: 'Parent' }],
  };
  const hits = forumToHits(r);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], { section: 'forum', kind: 'announcement', id: 'p1', href: '/announcements/p1', title: 'A', excerpt: 'e', date: '2026-09-01T00:00:00.000Z', sub: 'Ayşe', tags: ['t'] });
  assert.deepEqual(hits[1], { section: 'forum', kind: 'comment', id: 'c1', href: '/topics/p2#comment-c1', title: 'Parent', excerpt: 'ce', date: null, sub: null });
});

test('emptyHits + countHits: all five keys always present', () => {
  const r: SiteSearchResult = { q: 'x', hits: emptyHits() };
  assert.deepEqual(Object.keys(r.hits), ['forum', 'calendar', 'marketplace', 'news', 'blog']);
  assert.deepEqual(countHits(r), { total: 0, bySection: { forum: 0, calendar: 0, marketplace: 0, news: 0, blog: 0 } });
  r.hits.news.push({ section: 'news', kind: 'news', id: 'n', href: '/newsboard/n', title: 't', excerpt: '', date: null, sub: 'Quelle' });
  assert.equal(countHits(r).total, 1);
  assert.equal(countHits(r).bySection.news, 1);
  assert.equal(SEARCH_PER_SECTION, 20);
});
