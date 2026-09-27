// Run: npx tsx --test src/lib/calendar/berlinDay.test.ts   (also under TZ=UTC and TZ=America/New_York — results must not change)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berlinDayOf, berlinTodayISO, berlinDayStart, berlinDayEnd, isLegacyUtcAllDay } from './berlinDay';

test('berlinDayOf: civil day in Europe/Berlin, not UTC', () => {
  assert.equal(berlinDayOf('2026-10-03T22:30:00.000Z'), '2026-10-04'); // 00:30 CEST next day
  assert.equal(berlinDayOf('2026-01-15T23:30:00.000Z'), '2026-01-16'); // 00:30 CET
  assert.equal(berlinDayOf(new Date('2026-10-03T12:00:00.000Z')), '2026-10-03');
  assert.equal(berlinTodayISO(new Date('2026-10-03T22:30:00.000Z')), '2026-10-04');
});

test('berlinDayStart/End: summer (CEST, +02:00) and winter (CET, +01:00)', () => {
  assert.equal(berlinDayStart('2026-10-03').toISOString(), '2026-10-02T22:00:00.000Z');
  assert.equal(berlinDayEnd('2026-10-03').toISOString(), '2026-10-03T21:59:59.999Z');
  assert.equal(berlinDayStart('2026-01-15').toISOString(), '2026-01-14T23:00:00.000Z');
  assert.equal(berlinDayEnd('2026-01-15').toISOString(), '2026-01-15T22:59:59.999Z');
});

test('DST edges: the 23-hour day (2026-03-29) and the 25-hour day (2026-10-25)', () => {
  assert.equal(berlinDayStart('2026-03-29').toISOString(), '2026-03-28T23:00:00.000Z'); // still CET at midnight
  assert.equal(berlinDayEnd('2026-03-29').toISOString(), '2026-03-29T21:59:59.999Z');   // CEST by the evening
  assert.equal(berlinDayStart('2026-10-25').toISOString(), '2026-10-24T22:00:00.000Z'); // still CEST at midnight
  assert.equal(berlinDayEnd('2026-10-25').toISOString(), '2026-10-25T22:59:59.999Z');   // CET by the evening
});

test('round trip: the bounds land on the same civil day', () => {
  for (const d of ['2026-10-03', '2026-01-15', '2026-03-29', '2026-10-25', '2026-12-31']) {
    assert.equal(berlinDayOf(berlinDayStart(d)), d, `start ${d}`);
    assert.equal(berlinDayOf(berlinDayEnd(d)), d, `end ${d}`);
    assert.equal(berlinDayOf(new Date(berlinDayEnd(d).getTime() + 1)), nextDay(d), `end+1ms ${d}`);
  }
});

test('isLegacyUtcAllDay recognises the pre-fix storage shape only', () => {
  assert.equal(isLegacyUtcAllDay(new Date('2026-10-03T00:00:00.000Z'), new Date('2026-10-04T23:59:59.000Z')), true);
  assert.equal(isLegacyUtcAllDay(berlinDayStart('2026-10-03'), berlinDayEnd('2026-10-03')), false);
  assert.equal(isLegacyUtcAllDay(new Date('2026-10-03T07:00:00.000Z'), new Date('2026-10-03T16:00:00.000Z')), false);
});

function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
