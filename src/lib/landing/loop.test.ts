// src/lib/landing/loop.test.ts
// Run: npx tsx --test src/lib/landing/loop.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, activeIndex } from './loop';

test('advance adds dx and wraps by the half width once it reaches it', () => {
  assert.equal(advance(0, 1500, 0.64), 0.64);
  assert.ok(Math.abs(advance(1499.5, 1500, 0.64) - 0.14) < 1e-9);
  assert.equal(advance(1500, 1500, 0), 0);
});

test('advance without a half width is plain addition', () => {
  assert.equal(advance(10, 0, 5), 15);
});

test('activeIndex rounds to the nearest frame and wraps over the duplicate copy', () => {
  assert.equal(activeIndex(0, 250, 6), 0);
  assert.equal(activeIndex(130, 250, 6), 1);
  assert.equal(activeIndex(1250, 250, 6), 5);
  assert.equal(activeIndex(1500, 250, 6), 0);
  assert.equal(activeIndex(1760, 250, 6), 1);
});

test('activeIndex is 0 for a degenerate step or count', () => {
  assert.equal(activeIndex(400, 0, 6), 0);
  assert.equal(activeIndex(400, 250, 0), 0);
});
