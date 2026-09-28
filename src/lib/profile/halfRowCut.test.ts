// Run: npx tsx --test src/lib/profile/halfRowCut.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { halfRowCutHeight } from './halfRowCut';

const rows = (heights: number[]) => {
  let top = 0;
  return heights.map((height) => { const r = { top, height }; top += height; return r; });
};

test('no overflow → null (the CSS cap stays)', () => {
  assert.equal(halfRowCutHeight(rows([60, 60, 60]), 520), null);
  assert.equal(halfRowCutHeight([], 520), null);
});

test('overflow → height ends in the middle of the row crossing the cap', () => {
  // rows 0..7 at 70px: row 7 spans 490–560, crosses 520 → cut at 525
  assert.equal(halfRowCutHeight(rows(Array(10).fill(70)), 520), 525);
});

test('a row starting exactly at the cap is the one cut in half', () => {
  // 65px rows: row 8 starts at 520 → 520 + 32.5 → 553
  assert.equal(halfRowCutHeight(rows(Array(10).fill(65)), 520), 553);
});

test('the first row alone overflowing → null', () => {
  assert.equal(halfRowCutHeight(rows([600, 80]), 520), null);
});
