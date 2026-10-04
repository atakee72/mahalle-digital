import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from '@react-email/render';
import KiezBriefEmail from './KiezBriefEmail';
import { NAME_PLACEHOLDER, UNSUB_PLACEHOLDER, VERIFY_PLACEHOLDER, type BriefData } from '../lib/newsletter/kiezBriefRules';

const BASE = 'https://mahalle.example';
const data: BriefData = {
  week: '2026-W41',
  posts: [{ id: 'p1', kind: 'topic', title: 'Wer kennt einen <b>Schuster</b>?', author: 'Ayşe', comments: 2, dateMs: 1, excerpt: null, image: null }],
  events: [], listings: [], blog: [], official: [], newsCount: 0, air: null,
};
const ev = (id: string, day: number) => ({ id, title: `Termin ${id}`, startMs: Date.parse(`2026-10-${day}T17:00:00.000Z`), allDay: false, location: null });
const full: BriefData = {
  ...data,
  events: [ev('e1', 13), ev('e2', 14), ev('e3', 15)],
  listings: [{ id: 'l1', title: 'Lampe', kind: 'sell', price: 12, createdMs: 1, image: null }],
  blog: [{ slug: 'neu', title: 'Beilagen-Titel', description: 'd', pubMs: 1, cover: null }],
  official: [{ id: 'o1', title: 'Neu: die Suche', excerpt: 'Oben rechts.', dateMs: 1 }],
  newsCount: 23,
};
const fullHtml = (props: { locale?: 'de' | 'en' } = {}) => render(React.createElement(KiezBriefEmail, { data: full, baseUrl: BASE, ...props }));
const html = (props: { locale?: 'de' | 'en'; web?: boolean; baseUrl?: string } = {}) => render(React.createElement(KiezBriefEmail, { data, baseUrl: BASE, ...props }));

test('the mail links to its own browser view, in the reader\'s language', async () => {
  const de = await html();
  assert.match(de, /href="https:\/\/mahalle\.example\/kiez-brief\/2026-W41\?utm_source=kiez-brief"[^>]*>Im Browser ansehen</);
  assert.doesNotMatch(de, /Alle Ausgaben/);
  const en = await html({ locale: 'en' });
  assert.match(en, />View in browser</);
  assert.doesNotMatch(en, /translate=1"[^>]*>View in browser/); // our own page, nothing to translate
});

test('the browser view links to the list, not to itself', async () => {
  const web = await html({ web: true });
  assert.match(web, /href="https:\/\/mahalle\.example\/kiez-brief"[^>]*target="_self"[^>]*>← Alle Ausgaben</); // same tab: it is a way back
  assert.doesNotMatch(web, /Im Browser ansehen/);
  assert.doesNotMatch(web, /kiez-brief\/2026-W41/);
  assert.match(await html({ web: true, locale: 'en' }), />← All issues</);
});

test('both variants: phone viewport, a tab title, placeholders intact, member text escaped', async () => {
  for (const out of [await html(), await html({ web: true })]) {
    assert.match(out, /<meta name="viewport" content="width=device-width, initial-scale=1"/);
    assert.match(out, /<title>Kiez-Brief · KW 41<\/title>/);
    assert.ok(out.includes(UNSUB_PLACEHOLDER));
    assert.ok(out.includes(NAME_PLACEHOLDER));
    assert.ok(out.includes('Wer kennt einen &lt;b&gt;Schuster&lt;/b&gt;?'));
    assert.doesNotMatch(out, /<script/i);
  }
});

test('the browser view with an empty base prints relative links only', async () => {
  const out = await html({ web: true, baseUrl: '' });
  assert.match(out, /href="\/kiez-brief"[^>]*>← Alle Ausgaben</);
  assert.match(out, /href="\/topics\/p1\?utm_source=kiez-brief"/);
  assert.match(out, /src="\/icons\/icon-192\.png"/);
  assert.doesNotMatch(out, /(href|src)="https?:/);
});

test('section order: Forum, Beilage, Markt, Kurier, Neu bei Mahalle — and the coming week last', async () => {
  const out = await fullHtml();
  const at = ['>Im Forum<', '>In der Beilage<', '>Neu auf dem Markt<', '>Im Kurier<', '>Neu bei Mahalle<', '>Nächste Woche im Kiez<', '>Mahalle öffnen<'].map((h) => out.indexOf(h));
  assert.equal(at.includes(-1), false, at.join(','));
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
  const en = await fullHtml({ locale: 'en' });
  for (const h of ['>In the Kurier<', '>New at Mahalle<', '>Open Mahalle<']) assert.ok(en.includes(h), h);
});

test('the Kurier teaser: the real count and a link to the news board; absent at 0', async () => {
  const out = await fullHtml();
  assert.ok(out.includes('Im Kurier: 23 Artikel.'));
  assert.match(out, /href="https:\/\/mahalle\.example\/newsboard\?utm_source=kiez-brief"[^>]*>Zum Kurier →</);
  const none = await html();
  assert.doesNotMatch(none, /Im Kurier|newsboard/);
});

test('Neu bei Mahalle links to the announcement; the English mail asks for its translation', async () => {
  assert.match(await fullHtml(), /href="https:\/\/mahalle\.example\/announcements\/o1\?utm_source=kiez-brief"[^>]*>Neu: die Suche</);
  assert.match(await fullHtml({ locale: 'en' }), /href="https:\/\/mahalle\.example\/announcements\/o1\?utm_source=kiez-brief&amp;translate=1"/);
  assert.doesNotMatch(await html(), /Neu bei Mahalle/);
});

test('events are a two-column grid: three events make two rows, the odd one beside an empty cell', async () => {
  const out = await fullHtml();
  const cards = out.split('data-id="__react-email-column"').filter((c) => /^[^>]*border:1px solid #1b1a17[^>]*border-radius:8px/.test(c));
  assert.equal(cards.length, 3);
  assert.ok(out.indexOf('Termin e1') < out.indexOf('Termin e2') && out.indexOf('Termin e2') < out.indexOf('Termin e3'));
  assert.equal((out.match(/width:4%/g) ?? []).length, 2); // one gutter per row
  assert.equal((out.match(/calendar\?utm_source=kiez-brief/g) ?? []).length, 3);
});

test('the masthead icon and the wordmark open Mahalle', async () => {
  const out = await html();
  assert.match(out, /<a href="https:\/\/mahalle\.example\/forum\?utm_source=kiez-brief"[^>]*><img alt="Mahalle"/);
  assert.match(out, /<a href="https:\/\/mahalle\.example\/forum\?utm_source=kiez-brief"[^>]*>mahalle<\/a>/);
});

test('the footer\'s settings link leads to the profile, where the switch lives', async () => {
  assert.match(await html(), /href="https:\/\/mahalle\.example\/profile\?utm_source=kiez-brief"[^>]*>Im Profil einstellen</);
  assert.match(await html({ locale: 'en' }), />Settings in your profile</);
});

test('the confirm-your-address placeholder sits once, under the top link and outside the letter', async () => {
  for (const [out, top] of [[await html(), 'Im Browser ansehen'], [await html({ web: true }), 'Alle Ausgaben']] as const) {
    assert.equal(out.split(VERIFY_PLACEHOLDER).length - 1, 1);
    assert.ok(out.includes(`<div>${VERIFY_PLACEHOLDER}</div>`));
    const at = out.indexOf(VERIFY_PLACEHOLDER);
    assert.ok(out.indexOf(top) < at, 'after the top link');
    assert.ok(at < out.indexOf('icon-192.png'), 'before the masthead — not inside the letter');
  }
});
