import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldStart, velocityFrom, decideRelease, closeDurationMs } from './sheetDragRules';

test('handle starts regardless of scrollTop', () => {
  assert.equal(shouldStart({ dx: 0, dy: 10, fromHandle: true, scrollTop: 300 }), 'drag');
});
test('body starts only at scrollTop 0', () => {
  assert.equal(shouldStart({ dx: 0, dy: 10, fromHandle: false, scrollTop: 0 }), 'drag');
  assert.equal(shouldStart({ dx: 0, dy: 10, fromHandle: false, scrollTop: 5 }), 'reject');
});
test('horizontal first and upward reject', () => {
  assert.equal(shouldStart({ dx: 12, dy: 3, fromHandle: true, scrollTop: 0 }), 'reject');
  assert.equal(shouldStart({ dx: 0, dy: -9, fromHandle: true, scrollTop: 0 }), 'reject');
  assert.equal(shouldStart({ dx: 20, dy: 10, fromHandle: true, scrollTop: 0 }), 'reject');
});
test('below 8 px waits', () => {
  assert.equal(shouldStart({ dx: 2, dy: 7, fromHandle: true, scrollTop: 0 }), 'wait');
});
test('close by distance', () => {
  assert.equal(decideRelease({ dy: 80, velocity: 0, height: 200 }), 'close');
  assert.equal(decideRelease({ dy: 79, velocity: 0, height: 200 }), 'snap');
  assert.equal(decideRelease({ dy: 150, velocity: 0, height: 600 }), 'close');
  assert.equal(decideRelease({ dy: 149, velocity: 0, height: 600 }), 'snap');
});
test('close by flick', () => {
  assert.equal(decideRelease({ dy: 30, velocity: 0.6, height: 600 }), 'close');
  assert.equal(decideRelease({ dy: 20, velocity: 0.9, height: 600 }), 'snap');
});
test('snap on slow 50 px drag', () => {
  assert.equal(decideRelease({ dy: 50, velocity: 0.1, height: 600 }), 'snap');
});
test('velocity uses only the last 100 ms', () => {
  const s = [{ y: 0, t: 0 }, { y: 10, t: 500 }, { y: 70, t: 560 }, { y: 130, t: 600 }];
  assert.equal(velocityFrom(s, 600), (130 - 10) / (600 - 500));
  assert.equal(velocityFrom([{ y: 0, t: 0 }], 10), 0);
  assert.equal(velocityFrom([], 10), 0);
});
test('velocity falls back to whole gesture', () => {
  const s = [{ y: 0, t: 0 }, { y: 100, t: 200 }];
  assert.equal(velocityFrom(s, 1000), 0.5);
});
test('closeDurationMs', () => {
  assert.equal(closeDurationMs(0, 400), 150);
  assert.equal(closeDurationMs(200, 400), 75);
  assert.equal(closeDurationMs(400, 400), 0);
  assert.equal(closeDurationMs(500, 400), 0);
});
