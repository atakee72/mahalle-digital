// Run: npx tsx --test src/lib/newsboard/newsOrder.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isKiezSource } from './newsTaxonomy';
import { pickLead } from './newsFormat';

test('Kiez sources by name, case-insensitive, umlaut variants', () => {
  for (const s of ['Pro Schillerkiez', 'Facetten Neukölln', 'facettenneukoelln', 'Kiez und Kneipe', 'Schillerpromenade', 'Neuköllner Wochenkurier', 'neukoellner.net', 'Nachbarschaftstreff Schillerkiez'])
    assert.equal(isKiezSource(s), true, s);
  for (const s of ['Tagesspiegel', 'Berliner Zeitung', 'rbb24', 'taz', '', undefined, null])
    assert.equal(isKiezSource(s as any), false, String(s));
});

test('lead: first of today, else first of yesterday, else none — input order kept', () => {
  const now = new Date('2026-09-22T09:00:00Z');
  const a = { id: 'old', publishedAt: '2026-09-18T07:15:00Z' };
  const b = { id: 'y1', publishedAt: '2026-09-21T20:00:00Z' };
  const c = { id: 't1', publishedAt: '2026-09-22T04:54:00Z' };
  const d = { id: 't2', publishedAt: '2026-09-22T06:33:00Z' };
  assert.equal(pickLead([a, b, c, d], now)?.id, 't1');
  assert.equal(pickLead([a, b], now)?.id, 'y1');
  assert.equal(pickLead([a], now), undefined);
  assert.equal(pickLead([], now), undefined);
});
