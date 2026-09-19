import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBlumeComponents, isValidGrade } from './blume';
import { buildDailyRollup } from './airLog';

// BLUME sends the NUMBER -1 for „no measurement" (seen live 2026-09-19 22:00, every component of mc042).
const silent = [
  { datetime: '2026-09-19T22:00:00+02:00', component: 'lqi', value: -1, grade: -1 },
  { datetime: '2026-09-19T22:00:00+02:00', component: 'pm10', value: -1, grade: -1 },
];

test('a grade is valid only from 1 to 5', () => {
  for (const g of [1, 2, 3, 4, 5]) assert.equal(isValidGrade(g), true);
  for (const g of [-1, 0, 6, 2.5, NaN, null, undefined]) assert.equal(isValidGrade(g as number | null), false);
});

test('the -1 „no measurement" code becomes null — grade AND value', () => {
  const out = normalizeBlumeComponents(silent);
  assert.deepEqual(out.map((c) => [c.component, c.grade, c.value]), [['lqi', null, null], ['pm10', null, null]]);
});

test('real readings pass through untouched', () => {
  const real = [{ datetime: '2026-09-19T21:00:00+02:00', component: 'lqi', value: 2, grade: 2 }, { datetime: '2026-09-19T21:00:00+02:00', component: 'no2', value: 17.4, grade: 1 }];
  assert.deepEqual(normalizeBlumeComponents(real), real);
});

test('a real grade with a -1 value keeps the grade and drops only the value', () => {
  const out = normalizeBlumeComponents([{ datetime: 'x', component: 'o3', value: -1, grade: 3 }]);
  assert.deepEqual([out[0].grade, out[0].value], [3, null]);
});

test('the daily rollup ignores „no measurement" rows that are already stored', () => {
  assert.deepEqual(buildDailyRollup('2026-09-19', [2, 2, 2, 2, 2, 2, -1]), { day: '2026-09-19', lqiMax: 2, lqiMean: 2, readings: 6 });
});

test('a day with nothing but „no measurement" rows has no rollup (the gap is the honest record)', () => {
  assert.equal(buildDailyRollup('2026-09-19', [-1, -1]), null);
  assert.equal(buildDailyRollup('2026-09-19', []), null);
});
