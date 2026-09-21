// Run: npx tsx --test src/lib/mentions/broadcast.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBroadcast, restoreBroadcastText } from './broadcast';

test('finds @alle, strips it, keeps the rest intact', () => {
  const r = parseBroadcast('Hallo zusammen, @alle bitte lesen.');
  assert.deepEqual(r, { body: 'Hallo zusammen, bitte lesen.', token: '@alle', excludedHandles: [] });
});

test('exclusions: „-handle" tokens directly after @alle, one space each', () => {
  const r = parseBroadcast('@alle -atakee -anna_m das gilt für euch nicht.');
  assert.deepEqual(r, { body: 'das gilt für euch nicht.', token: '@alle -atakee -anna_m', excludedHandles: ['atakee', 'anna_m'] });
});

test('the group ends at the first token that is not -handle', () => {
  const r = parseBroadcast('@alle -petra - nicht -x -1234 Ende');
  assert.equal(r?.token, '@alle -petra');
  assert.deepEqual(r?.excludedHandles, ['petra']);
  assert.equal(r?.body, '- nicht -x -1234 Ende');
});

test('handles are lowercased and deduplicated, self-mention @alle inside a word or e-mail is not a token', () => {
  assert.deepEqual(parseBroadcast('@alle -Petra -petra x')?.excludedHandles, ['petra']);
  assert.equal(parseBroadcast('mail an x@alle.de'), null);
  assert.equal(parseBroadcast('@aller Anfang'), null);
  assert.equal(parseBroadcast('kein token hier'), null);
});

test('only the FIRST @alle counts; a second one stays text', () => {
  const r = parseBroadcast('@alle eins @alle zwei');
  assert.equal(r?.body, 'eins @alle zwei');
});

test('restoreBroadcastText puts the token at the start', () => {
  assert.equal(restoreBroadcastText('bitte lesen.', { token: '@alle -anna' }), '@alle -anna bitte lesen.');
  assert.equal(restoreBroadcastText('bitte lesen.', null), 'bitte lesen.');
  assert.equal(restoreBroadcastText('', { token: '@alle' }), '@alle');
});
