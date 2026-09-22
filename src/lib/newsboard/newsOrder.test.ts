// Run: npx tsx --test src/lib/newsboard/newsOrder.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isKiezSource } from './newsTaxonomy';
import { orderBoard } from './newsFormat';

test('Kiez sources by name, case-insensitive, umlaut variants', () => {
  for (const s of ['Pro Schillerkiez', 'Facetten Neukölln', 'facettenneukoelln', 'Kiez und Kneipe', 'Schillerpromenade', 'Neuköllner Wochenkurier', 'neukoellner.net', 'Nachbarschaftstreff Schillerkiez'])
    assert.equal(isKiezSource(s), true, s);
  for (const s of ['Tagesspiegel', 'Berliner Zeitung', 'rbb24', 'taz', '', undefined, null])
    assert.equal(isKiezSource(s as any), false, String(s));
});

test('orderBoard: today by score desc (publishedAt tiebreak), yesterday/older by time, lead = today\'s top score', () => {
  const now = new Date('2026-09-22T09:00:00Z');
  const t1 = { id: 't1', score: 85, publishedAt: '2026-09-22T04:54:00Z' };
  const t2 = { id: 't2', score: 90, publishedAt: '2026-09-22T06:33:00Z' };
  const t3 = { id: 't3', score: 90, publishedAt: '2026-09-22T03:00:00Z' };
  const y1 = { id: 'y1', score: 0, publishedAt: '2026-09-21T20:00:00Z' };
  const y2 = { id: 'y2', score: 0, publishedAt: '2026-09-21T10:00:00Z' };
  const o1 = { id: 'o1', score: 0, publishedAt: '2026-09-18T07:15:00Z' };

  // shuffled input order
  const input = [y2, t1, o1, y1, t3, t2];

  const withLead = orderBoard(input, now);
  assert.equal(withLead.lead?.id, 't2'); // score 90, newer than t3 (also score 90)
  assert.deepEqual(withLead.today.map((x) => x.id), ['t3', 't1']);
  assert.deepEqual(withLead.yesterday.map((x) => x.id), ['y1', 'y2']);
  assert.deepEqual(withLead.older.map((x) => x.id), ['o1']);

  const noLead = orderBoard(input, now, false);
  assert.equal(noLead.lead, undefined);
  assert.deepEqual(noLead.today.map((x) => x.id), ['t2', 't3', 't1']);

  const empty = orderBoard([], now);
  assert.equal(empty.lead, undefined);
  assert.deepEqual(empty.today, []);
  assert.deepEqual(empty.yesterday, []);
  assert.deepEqual(empty.older, []);

  const onlyOlder = orderBoard([o1], now);
  assert.equal(onlyOlder.lead, undefined);
  assert.deepEqual(onlyOlder.older.map((x) => x.id), ['o1']);

  const onlyYesterday = orderBoard([y2, y1], now);
  assert.equal(onlyYesterday.lead?.id, 'y1');
  assert.deepEqual(onlyYesterday.yesterday.map((x) => x.id), ['y2']);
});
