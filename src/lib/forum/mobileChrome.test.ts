import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinStackMode, tagsChipLabel } from './mobileChrome';

test('no pin or one pin never folds — there is nothing to save', () => {
  assert.equal(pinStackMode(0, false), 'single');
  assert.equal(pinStackMode(1, false), 'single');
  assert.equal(pinStackMode(1, true), 'single');
});

test('two or three pins start folded and unfold on request', () => {
  assert.equal(pinStackMode(2, false), 'folded');
  assert.equal(pinStackMode(3, false), 'folded');
  assert.equal(pinStackMode(3, true), 'unfolded');
});

test('a pin expiring while the stack is unfolded falls back to single', () => {
  assert.equal(pinStackMode(1, true), 'single');
});

test('the chip shows its plain label while no tag is active', () => {
  assert.equal(tagsChipLabel(null, '# Tags'), '# Tags');
  assert.equal(tagsChipLabel(undefined, '# Tags'), '# Tags');
  assert.equal(tagsChipLabel('', '# Tags'), '# Tags');
  assert.equal(tagsChipLabel('   ', '# Tags'), '# Tags');
});

test('the chip names the active tag, so a folded row never hides an active filter', () => {
  assert.equal(tagsChipLabel('garten', '# Tags'), '#garten');
  assert.equal(tagsChipLabel(' kita ', '# Tags'), '#kita');
});
