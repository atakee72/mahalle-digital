// Run: npx tsx --test src/lib/calendar/allDayRepair.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairedAllDayBounds } from './allDayRepair';

test('legacy UTC bounds → Berlin day bounds of the SAME civil days (the days the author typed)', () => {
  const r = repairedAllDayBounds(new Date('2026-10-03T00:00:00.000Z'), new Date('2026-10-03T23:59:59.000Z'));
  assert.deepEqual([r!.start.toISOString(), r!.end.toISOString()], ['2026-10-02T22:00:00.000Z', '2026-10-03T21:59:59.999Z']);
});

test('a row that already grew keeps its (wrong) end day — the author fixes that once in the form', () => {
  const r = repairedAllDayBounds(new Date('2026-10-03T00:00:00.000Z'), new Date('2026-10-04T23:59:59.000Z'));
  assert.deepEqual([r!.start.toISOString(), r!.end.toISOString()], ['2026-10-02T22:00:00.000Z', '2026-10-04T21:59:59.999Z']);
});

test('winter row', () => {
  const r = repairedAllDayBounds(new Date('2026-01-15T00:00:00.000Z'), new Date('2026-01-15T23:59:59.000Z'));
  assert.deepEqual([r!.start.toISOString(), r!.end.toISOString()], ['2026-01-14T23:00:00.000Z', '2026-01-15T22:59:59.999Z']);
});

test('not legacy → null (already Berlin bounds, or a timed event)', () => {
  assert.equal(repairedAllDayBounds(new Date('2026-10-02T22:00:00.000Z'), new Date('2026-10-03T21:59:59.999Z')), null);
  assert.equal(repairedAllDayBounds(new Date('2026-10-03T07:00:00.000Z'), new Date('2026-10-03T16:00:00.000Z')), null);
});
