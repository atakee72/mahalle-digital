import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodTime, trendXs } from './trendAxis';

test('a period is its reference date', () => {
  assert.equal(periodTime('2026h1'), 2026.5); // 30 June 2026
  assert.equal(periodTime('2025h2'), 2026); // 31 Dec 2025
  assert.equal(periodTime('2023'), 2024); // MSS report year = end of that year
  assert.ok(Number.isNaN(periodTime('Q3 2026')));
});

test('the live editions: a missing half-year leaves a double gap', () => {
  const periods = ['2021h2', '2022h2', '2023h1', '2023h2', '2024h1', '2025h1', '2025h2', '2026h1'];
  const xs = trendXs(periods.map(periodTime), 70, 830);
  assert.equal(xs[0], 70);
  assert.equal(xs[xs.length - 1], 830);
  const step = (830 - 70) / 9; // 4.5 years = nine half-years
  const gaps = xs.slice(1).map((x, i) => Math.round((x - xs[i]) / step));
  assert.deepEqual(gaps, [2, 1, 1, 1, 2, 1, 1]); // H2'21→H2'22 and H1'24→H1'25 are full years
});

test('evenly spaced editions look exactly as before', () => {
  const xs = trendXs(['2013', '2015', '2017', '2019'].map(periodTime), 0, 300);
  assert.deepEqual(xs, [0, 100, 200, 300]);
});

test('edge cases never produce NaN', () => {
  assert.deepEqual(trendXs([], 0, 100), []);
  assert.deepEqual(trendXs([2026.5], 0, 100), [50]);
  assert.deepEqual(trendXs([2026, 2026], 0, 100), [0, 100]); // no time span → index positions
  assert.deepEqual(trendXs([NaN, NaN, NaN], 0, 100), [0, 50, 100]);
  const mixed = trendXs([2024, NaN, 2026], 0, 100);
  assert.ok(mixed.every((x) => Number.isFinite(x)));
  assert.deepEqual([mixed[0], mixed[2]], [0, 100]);
});
