import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchOmniInputs, type OmniInput } from './omniModerationBatches';

const t: OmniInput = { type: 'text', text: 'hallo' };
const img = (n: number): OmniInput => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${n}` } });

test('text only → one request', () => {
  assert.deepEqual(batchOmniInputs([t]), [[t]]);
});
test('nothing → no request', () => {
  assert.deepEqual(batchOmniInputs([]), []);
});
test('text + one image → one request', () => {
  assert.deepEqual(batchOmniInputs([t, img(1)]), [[t, img(1)]]);
});
test('text + five images → five requests, never more than one image each', () => {
  const out = batchOmniInputs([t, img(1), img(2), img(3), img(4), img(5)]);
  assert.equal(out.length, 5);
  assert.deepEqual(out[0], [t, img(1)]);
  assert.deepEqual(out[4], [img(5)]);
  for (const batch of out) assert.equal(batch.filter((i) => i.type === 'image_url').length, 1);
});
test('images without text → one request per image', () => {
  assert.deepEqual(batchOmniInputs([img(1), img(2)]), [[img(1)], [img(2)]]);
});

import { mergeOmniResults } from './omniModerationBatches';

test('merge: per-category max and union of flags, nothing lost', () => {
  const m = mergeOmniResults([
    { flagged: true, categories: { violence: true }, category_scores: { violence: 0.9, sexual: 0.1 } },
    { flagged: true, categories: { sexual: true }, category_scores: { violence: 0.2, sexual: 0.95 } },
    { flagged: false, categories: {}, category_scores: { harassment: 0.3 } },
  ]);
  assert.deepEqual(m, { flagged: true, categories: { violence: true, sexual: true }, category_scores: { violence: 0.9, sexual: 0.95, harassment: 0.3 } });
});
test('merge: empty → null (fail-safe for the caller)', () => {
  assert.equal(mergeOmniResults([]), null);
});
