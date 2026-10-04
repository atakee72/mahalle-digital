import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  storedNewsletterMode, isoWeek, issueWeek, weekLabel, windowFor, arrangeData, isQuiet, subjectFor,
  preheaderFor, withUtm, berlinWeekday, fmtEventWhen, fmtPrice, unsubscribeHeaders, excerptOf, thumb,
  storedMailLocale, escapeHtml, MAIL_COPY, NAME_PLACEHOLDER, MAX_POSTS, MAX_EVENTS, MAX_LISTINGS, WINDOW_MS,
  type BriefData,
} from './kiezBriefRules';

const SUN_18 = Date.parse('2026-10-11T16:00:00.000Z'); // Sunday 18:00 CEST, ISO week 41
const MON_06 = Date.parse('2026-10-12T06:00:00.000Z'); // Monday 08:00 CEST — the fallback, ISO week 42

const empty = (): BriefData => ({ week: '2026-W41', posts: [], events: [], listings: [], blog: [], air: null });
const post = (id: string, h: number): BriefData['posts'][number] => ({ id, kind: 'topic', title: `T${id}`, author: 'A', comments: 0, dateMs: SUN_18 - h * 3_600_000, excerpt: null, image: null });

test('the stored preference falls back to weekly', () => {
  assert.equal(storedNewsletterMode('off'), 'off');
  for (const v of [undefined, null, '', 'weekly', 'OFF', 1]) assert.equal(storedNewsletterMode(v), 'weekly');
});

test('ISO week of a Berlin day, around the year boundary too', () => {
  assert.equal(isoWeek(SUN_18), '2026-W41');
  assert.equal(isoWeek(MON_06), '2026-W42');
  assert.equal(isoWeek(Date.parse('2026-01-01T12:00:00.000Z')), '2026-W01');
  assert.equal(isoWeek(Date.parse('2027-01-03T12:00:00.000Z')), '2026-W53'); // Sunday 3 Jan 2027 is still ISO week 53 of 2026
  assert.equal(isoWeek(Date.parse('2026-10-11T22:30:00.000Z')), '2026-W42'); // 00:30 Berlin Monday
});

test('Sunday evening and the Monday-morning fallback share one issue key', () => {
  assert.equal(issueWeek(SUN_18), '2026-W41');
  assert.equal(issueWeek(MON_06), '2026-W41');
  assert.equal(issueWeek(Date.parse('2026-10-13T06:00:00.000Z')), '2026-W42'); // Tuesday: next issue
  assert.equal(weekLabel('2026-W05'), 'KW 5');
});

test('the window looks seven days back and seven days ahead', () => {
  assert.deepEqual(windowFor(SUN_18), { fromMs: SUN_18 - WINDOW_MS, toMs: SUN_18, aheadMs: SUN_18 + WINDOW_MS });
});

test('sections are ordered and capped, an invalid air grade is dropped', () => {
  const d = empty();
  d.posts = Array.from({ length: MAX_POSTS + 3 }, (_, i) => post(String(i), i));
  d.events = [{ id: 'b', title: 'B', startMs: 2, allDay: false, location: null }, { id: 'a', title: 'A', startMs: 1, allDay: true, location: 'Platz' }];
  d.listings = Array.from({ length: MAX_LISTINGS + 1 }, (_, i) => ({ id: String(i), title: 'L', kind: 'sell' as const, price: 1, createdMs: i, image: null }));
  d.air = { lqi: 7 };
  const a = arrangeData(d);
  assert.equal(a.posts.length, MAX_POSTS);
  assert.equal(a.posts[0].id, '0'); // newest first
  assert.deepEqual(a.events.map((e) => e.id), ['a', 'b']); // nearest first
  assert.equal(a.listings.length, MAX_LISTINGS);
  assert.equal(a.listings[0].id, String(MAX_LISTINGS)); // newest first
  assert.equal(a.air, null);
  assert.deepEqual(arrangeData({ ...empty(), air: { lqi: 2 } }).air, { lqi: 2 });
  assert.equal(MAX_EVENTS, 8);
});

test('a quiet week is one without content; the air line alone does not count', () => {
  assert.equal(isQuiet(empty()), true);
  assert.equal(isQuiet({ ...empty(), air: { lqi: 1 } }), true);
  assert.equal(isQuiet({ ...empty(), blog: [{ slug: 's', title: 't', description: 'd', pubMs: 1, cover: null }] }), false);
});

test('the subject names the two biggest counts, singular and plural', () => {
  const d = empty();
  d.posts = [post('1', 1), post('2', 2), post('3', 3)];
  d.events = [{ id: 'e', title: 'E', startMs: 1, allDay: false, location: null }];
  d.listings = [{ id: 'l', title: 'L', kind: 'gift', price: null, createdMs: 1, image: null }];
  assert.equal(subjectFor(d), 'Kiez-Brief · KW 41 · 3 neue Beiträge, 1 Termin');
  d.listings.push({ id: 'l2', title: 'L', kind: 'gift', price: null, createdMs: 2, image: null });
  assert.equal(subjectFor(d), 'Kiez-Brief · KW 41 · 3 neue Beiträge, 2 neue Anzeigen'); // the two biggest counts
  assert.equal(subjectFor({ ...empty(), posts: [post('1', 1)] }), 'Kiez-Brief · KW 41 · 1 neuer Beitrag');
  assert.equal(subjectFor(empty()), 'Kiez-Brief · KW 41');
});

test('the preheader prefers the newest post, then the next event', () => {
  assert.equal(preheaderFor({ ...empty(), posts: [post('9', 1)] }), 'T9');
  assert.equal(preheaderFor({ ...empty(), events: [{ id: 'e', title: 'Flohmarkt', startMs: 1, allDay: true, location: null }] }), 'Flohmarkt');
  assert.equal(preheaderFor(empty()), 'Neues aus dem Schillerkiez');
});

test('links carry the source; Berlin times and prices print the German way', () => {
  assert.equal(withUtm('https://x/topics/1'), 'https://x/topics/1?utm_source=kiez-brief');
  assert.equal(withUtm('https://x/calendar?x=1'), 'https://x/calendar?x=1&utm_source=kiez-brief');
  assert.equal(fmtEventWhen(Date.parse('2026-10-13T17:00:00.000Z'), false), 'Di. 13.10. · 19:00');
  assert.equal(fmtEventWhen(Date.parse('2026-10-17T00:00:00.000Z'), true), 'Sa. 17.10. · ganztägig');
  assert.equal(fmtEventWhen(Date.parse('2026-12-01T18:30:00.000Z'), false), 'Di. 1.12. · 19:30'); // CET
  assert.equal(fmtPrice(12), '12 €');
  assert.equal(fmtPrice(12.5), '12,50 €');
  assert.equal(fmtPrice(null), null);
});

test('the one-click headers follow RFC 8058', () => {
  assert.deepEqual(unsubscribeHeaders('https://x/api/newsletter/unsubscribe?t=abc', 'admin@x'), {
    'List-Unsubscribe': '<https://x/api/newsletter/unsubscribe?t=abc>, <mailto:admin@x?subject=unsubscribe>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  });
});

test('berlinWeekday reads the Berlin day, not the UTC day', () => {
  assert.equal(berlinWeekday(SUN_18), 0);
  assert.equal(berlinWeekday(MON_06), 1);
  assert.equal(berlinWeekday(Date.parse('2026-10-12T23:30:00.000Z')), 2); // Tuesday 01:30 CEST
});

test('an excerpt is one plain line, cut at a word, links and marks stripped', () => {
  assert.equal(excerptOf('**Hallo** Kiez! Siehe [hier](https://x.y/z) und https://a.b/c.\n\n# Mehr'), 'Hallo Kiez! Siehe hier und Mehr');
  assert.equal(excerptOf('<p>Tag</p>'), 'Tag');
  assert.equal(excerptOf(''), null);
  assert.equal(excerptOf(42), null);
  const long = 'wort '.repeat(60).trim();
  const e = excerptOf(long)!;
  assert.ok(e.endsWith(' …') && e.length <= 143, e);
});

test('thumbnails: a Cloudinary photo gets a square fill transform, every other origin is dropped', () => {
  assert.equal(thumb('https://res.cloudinary.com/demo/image/upload/v1/mahalle/posts/a.jpg', 120), 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_120,h_120,c_fill/v1/mahalle/posts/a.jpg');
  assert.equal(thumb('https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v1/a.jpg', 80), 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_80,h_80,c_fill/v1/a.jpg');
  assert.equal(thumb('https://example.org/x.png', 80), null); // foreign origin: never into a mail
  assert.equal(thumb('https://evil.example/res.cloudinary.com/upload/x.png', 80), null);
  assert.equal(thumb('http://insecure/x.png', 80), null);
  assert.equal(thumb(null, 80), null);
});

test('the mail language follows the stored toggle and falls back to German', () => {
  assert.equal(storedMailLocale('en'), 'en');
  for (const v of [undefined, null, '', 'de', 'EN', 'tr', 1]) assert.equal(storedMailLocale(v), 'de');
});

test('the English mail has an English subject, week label and preheader fallback', () => {
  const d = { ...empty(), posts: [post('1', 1), post('2', 2)], events: [{ id: 'e', title: 'E', startMs: 1, allDay: false, location: null }] };
  assert.equal(subjectFor(d, 'en'), 'Kiez-Brief · CW 41 · 2 new posts, 1 event');
  assert.equal(subjectFor(d, 'de'), 'Kiez-Brief · KW 41 · 2 neue Beiträge, 1 Termin');
  assert.equal(preheaderFor(empty(), 'en'), 'News from the Schillerkiez');
  assert.equal(weekLabel('2026-W05', 'en'), 'CW 5');
});

test('only the English mail asks the post page to translate; the German mail has no such hint', () => {
  assert.equal(withUtm('https://x/topics/1', true), 'https://x/topics/1?utm_source=kiez-brief&translate=1');
  assert.equal(withUtm('https://x/topics/1'), 'https://x/topics/1?utm_source=kiez-brief');
  assert.equal(MAIL_COPY.de.linksHint, null);
  assert.match(MAIL_COPY.en.linksHint!, /translated/);
  assert.ok(MAIL_COPY.de.greeting.includes(NAME_PLACEHOLDER) && MAIL_COPY.en.greeting.includes(NAME_PLACEHOLDER));
});

test('a name is escaped before it goes into rendered HTML', () => {
  assert.equal(escapeHtml(`<b>O'Neil & "Co"</b>`), '&lt;b&gt;O&#39;Neil &amp; &quot;Co&quot;&lt;/b&gt;');
  assert.equal(escapeHtml('Ayşe'), 'Ayşe');
});

