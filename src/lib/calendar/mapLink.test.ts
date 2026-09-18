import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapSearchUrl } from './mapLink';

const queryOf = (url: string) => new URL(url).searchParams.get('query');

test('free-text Ort becomes a Berlin-scoped place search', () => {
  const url = mapSearchUrl('Schillermarkt am Herrfurthplatz!');
  assert.ok(url.startsWith('https://www.google.com/maps/search/?api=1&query='));
  assert.equal(queryOf(url), 'Schillermarkt am Herrfurthplatz, Berlin');
});

test('trailing punctuation and spaces are dropped, inner ones kept', () => {
  assert.equal(queryOf(mapSearchUrl('  Café Engels, Herrfurthstr. 21 !!  ')), 'Café Engels, Herrfurthstr. 21, Berlin');
});

test('an Ort that already names Berlin is not doubled', () => {
  assert.equal(queryOf(mapSearchUrl('Herrfurthplatz, 12049 Berlin')), 'Herrfurthplatz, 12049 Berlin');
});

test('special characters survive encoding', () => {
  assert.equal(queryOf(mapSearchUrl('Hof & Garten #3')), 'Hof & Garten #3, Berlin');
});
