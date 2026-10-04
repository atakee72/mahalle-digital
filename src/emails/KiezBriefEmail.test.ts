import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from '@react-email/render';
import KiezBriefEmail from './KiezBriefEmail';
import { NAME_PLACEHOLDER, UNSUB_PLACEHOLDER, type BriefData } from '../lib/newsletter/kiezBriefRules';

const BASE = 'https://mahalle.example';
const data: BriefData = {
  week: '2026-W41',
  posts: [{ id: 'p1', kind: 'topic', title: 'Wer kennt einen <b>Schuster</b>?', author: 'Ayşe', comments: 2, dateMs: 1, excerpt: null, image: null }],
  events: [], listings: [], blog: [], air: null,
};
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
