// Run: npx tsx --test src/lib/newsboard/newsTaxonomy.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSektion } from './newsTaxonomy';

// GPT's category list in fetch-daily.ts: local, city, regional, culture,
// environment, politics, health, education, housing, transport, community —
// plus the off-list values it returns in practice (sport, crime, technology,
// entertainment). Each must land where a reader expects it.
test('GPT "transport" is Verkehr, not Sport (2026-10-01: 11 of 100 prod items showed as SPORT)', () => {
  assert.equal(resolveSektion('transport'), 'verkehr');
  assert.equal(resolveSektion('Transport'), 'verkehr');
});

test('genuine sport stays sport', () => {
  assert.equal(resolveSektion('sport'), 'sport');
  assert.equal(resolveSektion('sports'), 'sport');
  assert.equal(resolveSektion('Fußball'), 'sport');
});

test('the rest of the GPT list', () => {
  assert.equal(resolveSektion('politics'), 'politik');
  assert.equal(resolveSektion('culture'), 'kultur');
  assert.equal(resolveSektion('environment'), 'klima');
  for (const c of ['local', 'city', 'regional', 'health', 'education', 'housing', 'community', 'crime', null, undefined, '']) {
    assert.equal(resolveSektion(c), 'lokales', String(c));
  }
});
