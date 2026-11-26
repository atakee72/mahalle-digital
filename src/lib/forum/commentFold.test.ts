import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldFold, foldedHeight, FOLD_LINES, FOLD_FROM_LINES } from './commentFold';
import { grownHeight } from '../autoGrow';

test('a comment folds only when it is clearly longer than the folded height', () => {
  const line = 22;
  assert.equal(shouldFold(line * 5, line), false);
  // a line or two more than the cut is not worth a „mehr anzeigen"
  assert.equal(shouldFold(line * (FOLD_LINES + 2), line), false);
  assert.equal(shouldFold(line * FOLD_FROM_LINES + 1, line), true);
  assert.equal(shouldFold(line * 40, line), true);
});

test('fold rules survive a missing measurement', () => {
  assert.equal(shouldFold(0, 22), false);
  assert.equal(shouldFold(900, 0), false);
  assert.equal(shouldFold(NaN, NaN), false);
});

test('folded height is the cut in whole lines', () => {
  assert.equal(foldedHeight(22), 22 * FOLD_LINES);
  assert.ok(FOLD_FROM_LINES > FOLD_LINES);
});

test('a text box grows with its content between its floor and its ceiling', () => {
  assert.deepEqual(grownHeight(40, 72, 300), { height: 72, scroll: false });
  assert.deepEqual(grownHeight(180, 72, 300), { height: 180, scroll: false });
  assert.deepEqual(grownHeight(900, 72, 300), { height: 300, scroll: true });
  // a ceiling below the floor never shrinks the box under its floor
  assert.deepEqual(grownHeight(900, 72, 50), { height: 72, scroll: true });
});
