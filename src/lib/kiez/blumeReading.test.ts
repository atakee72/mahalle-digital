import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingFromBlume } from './airLog';
import { normalizeBlumeComponents } from './blume';

const live = [
  { datetime: '2026-09-29T02:00:00+02:00', component: 'lqi', value: 2, grade: 2 },
  { datetime: '2026-09-29T02:00:00+02:00', component: 'pm10', value: 12, grade: 1 },
  { datetime: '2026-09-29T02:00:00+02:00', component: 'no2', value: 30, grade: 2 },
  { datetime: '2026-09-29T02:00:00+02:00', component: 'o3', value: -1, grade: -1 },
  { datetime: '2026-09-29T02:00:00+02:00', component: 'co', value: 0.3, grade: 1 },
];

test('readingFromBlume: live components become one lastReading-shaped row (UTC ts, missing grade → null)', () => {
  const r = readingFromBlume(normalizeBlumeComponents(live));
  assert.deepEqual(r, { ts: '2026-09-29T00:00:00.000Z', lqi: 2, pm10: 1, no2: 2, o3: null, co: 1 });
});

test('readingFromBlume: silent station (-1 everywhere) → null, so the caller falls back to the log', () => {
  const silent = live.map((c) => ({ ...c, value: -1, grade: -1 }));
  assert.equal(readingFromBlume(normalizeBlumeComponents(silent)), null);
});

test('readingFromBlume: no lqi component or a bad datetime → null', () => {
  assert.equal(readingFromBlume(live.filter((c) => c.component !== 'lqi')), null);
  assert.equal(readingFromBlume([{ ...live[0], datetime: 'gestern' }]), null);
});
