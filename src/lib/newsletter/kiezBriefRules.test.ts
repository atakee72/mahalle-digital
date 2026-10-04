import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  storedNewsletterMode, isoWeek, issueWeek, weekLabel, windowFor, arrangeData, isQuiet, subjectFor,
  preheaderFor, withUtm, berlinWeekday, fmtEventWhen, fmtPrice, unsubscribeHeaders, excerptOf, thumb, inert, personalize, LISTING_KIND_SYMBOL,
  storedMailLocale, escapeHtml, isIssueWeekKey, newsLineFor, pairs, MAX_OFFICIAL, MAIL_COPY, NAME_PLACEHOLDER, MAX_POSTS, MAX_EVENTS, MAX_LISTINGS, WINDOW_MS,
  type BriefData,
} from './kiezBriefRules';

const SUN_18 = Date.parse('2026-10-11T16:00:00.000Z'); // Sunday 18:00 CEST, ISO week 41
const MON_06 = Date.parse('2026-10-12T06:00:00.000Z'); // Monday 08:00 CEST — the fallback, ISO week 42

const empty = (): BriefData => ({ week: '2026-W41', posts: [], events: [], listings: [], blog: [], official: [], newsCount: 0, air: null });
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

const U = 'https://res.cloudinary.com';
const OUT = (w: number, rest: string) => `${U}/demo/image/upload/f_auto,q_auto,w_${w},h_${w},c_fill/${rest}`;
test('thumbnails: only our own cloud and our two upload folders pass, fail closed', () => {
  assert.equal(thumb(`${U}/demo/image/upload/v1/mahalle/posts/a.jpg`, 120, 'demo'), OUT(120, 'v1/mahalle/posts/a.jpg'));
  assert.equal(thumb(`${U}/demo/image/upload/mahalle/listings/a.jpg`, 80, 'demo'), OUT(80, 'mahalle/listings/a.jpg'));
  assert.equal(thumb(`${U}/demo/image/upload/f_auto,q_auto/mahalle/posts/a.jpg`, 80, 'demo'), OUT(80, 'mahalle/posts/a.jpg'));
  assert.equal(thumb(`${U}/demo/image/upload/f_auto,q_auto/v123/mahalle/listings/a.jpg`, 80, 'demo'), OUT(80, 'v123/mahalle/listings/a.jpg'));
  assert.equal(thumb(`${U}/other/image/upload/v1/mahalle/posts/a.jpg`, 80, 'demo'), null); // another account
  assert.equal(thumb(`${U}/demo/image/fetch/https://evil.example/upload/x.png`, 80, 'demo'), null); // proxy form
  assert.equal(thumb(`${U}/demo/raw/upload/v1/mahalle/posts/a.jpg`, 80, 'demo'), null);
  assert.equal(thumb(`${U}/demo/image/upload/v1/elsewhere/a.jpg`, 80, 'demo'), null);
  assert.equal(thumb(`${U}/demo/image/upload/v1/mahalle/avatars/a.jpg`, 80, 'demo'), null);
  assert.equal(thumb(`${U}/demo/image/upload/v1/mahalle/posts/a.jpg`, 80, null), null);
  assert.equal(thumb(`${U}/demo/image/upload/v1/mahalle/posts/a.jpg`, 80, ''), null);
  assert.equal(thumb(`${U}/demo/image/upload/v1/mahalle/posts/a.jpg`, 80, undefined), null);
  assert.equal(thumb(`${U}/demXimage/upload/v1/mahalle/posts/a.jpg`, 80, 'dem.'), null); // regex characters are literal
  assert.equal(thumb(`${U}/d.m/image/upload/v1/mahalle/posts/a.jpg`, 80, 'd.m'), `${U}/d.m/image/upload/f_auto,q_auto,w_80,h_80,c_fill/v1/mahalle/posts/a.jpg`);
  assert.equal(thumb('https://example.org/x.png', 80, 'demo'), null);
  assert.equal(thumb('https://evil.example/res.cloudinary.com/demo/image/upload/mahalle/posts/x.png', 80, 'demo'), null);
  assert.equal(thumb('http://res.cloudinary.com/demo/image/upload/mahalle/posts/x.png', 80, 'demo'), null);
  assert.equal(thumb(null, 80, 'demo'), null);
  // a path that climbs out of our folder, plain or percent-encoded, is refused
  for (const bad of [
    'https://res.cloudinary.com/demo/image/upload/mahalle/posts/../../../../other/image/fetch/https://evil.example/x.png',
    'https://res.cloudinary.com/demo/image/upload/mahalle/posts/%2e%2e/%2e%2e/x.png',
    'https://res.cloudinary.com/demo/image/upload/mahalle/posts/a b.png',
    'https://res.cloudinary.com/demo/image/upload/mahalle/posts/x.png?y=1',
  ]) assert.equal(thumb(bad, 80, 'demo'), null, bad);
});

test('member text cannot spell the placeholders', () => {
  const d = { ...empty(), posts: [{ id: 'p', kind: 'topic' as const, title: '%%NAME%% hallo', author: '%%UNSUB%%', comments: 0, dateMs: 1, excerpt: '%%NAME%%', image: null }],
    events: [{ id: 'e', title: '%%NAME%%', startMs: 1, allDay: false, location: '%%UNSUB%%' }],
    listings: [{ id: 'l', title: '%%NAME%%', kind: 'sell' as const, price: null, createdMs: 1, image: null }],
    blog: [{ slug: 'b', title: '%%NAME%%', description: '%%UNSUB%%', pubMs: 1, cover: null }] };
  const a = arrangeData(d);
  const all = JSON.stringify(a);
  assert.ok(!all.includes('%%'));
  assert.equal(a.posts[0].title.replaceAll('\u200b', ''), '%%NAME%% hallo'); // reads the same to a person
  assert.equal(inert('a %% b'), 'a %\u200b% b');
  assert.equal(arrangeData({ ...d, posts: [{ ...d.posts[0], excerpt: null, author: null }] }).posts[0].excerpt, null);
});

test('personalize: language fallback, escaping, literal replacement patterns', () => {
  const html = '<p>%%NAME%%</p><a href="%%UNSUB%%">x</a>';
  assert.equal(personalize(html, null, 'https://u/1', 'de'), '<p>Nachbar:in</p><a href="https://u/1">x</a>');
  assert.equal(personalize(html, '  ', 'https://u/1', 'en'), '<p>neighbour</p><a href="https://u/1">x</a>');
  assert.equal(personalize(html, '<b>x</b>', 'u', 'de'), '<p>&lt;b&gt;x&lt;/b&gt;</p><a href="u">x</a>');
  assert.equal(personalize(html, '$`', 'u', 'de'), '<p>$`</p><a href="u">x</a>');
  assert.equal(personalize(html, "$& $' $$", 'u', 'de'), '<p>$&amp; $&#39; $$</p><a href="u">x</a>');
  assert.equal(personalize(html, '%%UNSUB%%', 'https://u/1', 'de'), '<p>%%UNSUB%%</p><a href="https://u/1">x</a>');
  assert.equal(personalize(html, 'A', 'https://u/?a=$&b', 'de'), '<p>A</p><a href="https://u/?a=$&b">x</a>');
});

test('English prices and listing symbols', () => {
  assert.equal(fmtPrice(12, 'en'), '€12');
  assert.equal(fmtPrice(12.5, 'en'), '€12.50');
  assert.equal(fmtPrice(12.5, 'de'), '12,50 €');
  assert.equal(fmtPrice(null, 'en'), null);
  assert.deepEqual(LISTING_KIND_SYMBOL, { sell: '€', exchange: '⇄', gift: '♡' });
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


test('isIssueWeekKey: exactly the keys issueWeek() produces', () => {
  for (const ok of ['2026-W41', '2026-W01', '2026-W53', '2031-W09', issueWeek(SUN_18), issueWeek(MON_06)]) assert.equal(isIssueWeekKey(ok), true, ok);
  for (const bad of ['', '2026-W0', '2026-W00', '2026-W54', '2026-W411', '26-W41', '2026-w41', '2026W41', '2026-W41 ', '2026-W41\n', '2026-W41/x', '..', 41, null, undefined, ['2026-W41'], { $gt: '' }]) {
    assert.equal(isIssueWeekKey(bad), false, String(bad));
  }
});

test('the mail copy names the browser view and the list in both languages', () => {
  assert.equal(MAIL_COPY.de.viewInBrowser, 'Im Browser ansehen');
  assert.equal(MAIL_COPY.de.allIssues, 'Alle Ausgaben');
  assert.equal(MAIL_COPY.en.viewInBrowser, 'View in browser');
  assert.equal(MAIL_COPY.en.allIssues, 'All issues');
});

test('official announcements: newest first, capped, inert; they alone make a week worth a mail', () => {
  const off = (id: string, h: number) => ({ id, title: `Neu %%NAME%% ${id}`, excerpt: 'x %%UNSUB%%', dateMs: SUN_18 - h * 3_600_000 });
  const d = arrangeData({ ...empty(), official: [off('a', 30), off('b', 2), off('c', 50), off('d', 10)] });
  assert.equal(MAX_OFFICIAL, 3);
  assert.deepEqual(d.official.map((o) => o.id), ['b', 'd', 'a']);
  assert.equal(d.official.some((o) => o.title.includes('%%') || o.excerpt!.includes('%%')), false);
  assert.equal(isQuiet(d), false);
  assert.equal(preheaderFor({ ...empty(), official: [{ id: 'o', title: 'Neue Suche', excerpt: null, dateMs: 1 }] }), 'Neue Suche');
});

test('the Kurier teaser is garnish: a week with only news is still quiet; a broken count becomes 0', () => {
  assert.equal(isQuiet(arrangeData({ ...empty(), newsCount: 23 })), true);
  assert.equal(arrangeData({ ...empty(), newsCount: 23 }).newsCount, 23);
  for (const bad of [-1, 2.5, NaN, Infinity]) assert.equal(arrangeData({ ...empty(), newsCount: bad }).newsCount, 0);
  assert.equal(newsLineFor(23), 'Neugierig, was diese Woche los war? Im Kurier: 23 Artikel.');
  assert.equal(newsLineFor(1), 'Neugierig, was diese Woche los war? Im Kurier: 1 Artikel.');
  assert.equal(newsLineFor(23, 'en'), 'Curious what happened this week? On the news board: 23 articles.');
  assert.equal(newsLineFor(1, 'en'), 'Curious what happened this week? On the news board: 1 article.');
});

test('pairs: two to a row, an odd list ends on a single', () => {
  assert.deepEqual(pairs([]), []);
  assert.deepEqual(pairs([1]), [[1, null]]);
  assert.deepEqual(pairs([1, 2]), [[1, 2]]);
  assert.deepEqual(pairs([1, 2, 3]), [[1, 2], [3, null]]);
});

test('the button opens Mahalle, not „the forum"', () => {
  assert.equal(MAIL_COPY.de.cta, 'Mahalle öffnen');
  assert.equal(MAIL_COPY.en.cta, 'Open Mahalle');
});
