import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialMastState, nextMastState, mastBottomAfterScroll,
  TOP_ZONE, HIDE_AFTER, SHOW_AFTER, type MastState,
} from './hideOnScroll';

const MAX = 5000;
// Feed a list of scroll positions, return the final state.
const run = (ys: number[], start: MastState, locked = false): MastState =>
  ys.reduce((s, y) => nextMastState(s, y, MAX, locked), start);
// Most cases start mid-page, just outside the top zone, with no travel yet.
const at100 = () => initialMastState(100);

test('inside the top zone the bar is always visible', () => {
  assert.equal(run([10, 40, TOP_ZONE], initialMastState(0)).hidden, false);
});

test('hides after HIDE_AFTER px of continuous downward travel', () => {
  const s = run([110, 100 + HIDE_AFTER - 1], at100());
  assert.equal(s.hidden, false, 'one px short of the threshold');
  assert.equal(nextMastState(s, 100 + HIDE_AFTER + 10, MAX, false).hidden, true);
});

test('shows again after SHOW_AFTER px of upward travel — the first scroll up', () => {
  const down = run([140, 180, 220], at100());
  assert.equal(down.hidden, true);
  assert.equal(nextMastState(down, 220 - (SHOW_AFTER - 1), MAX, false).hidden, true, 'finger jitter does not show it');
  assert.equal(run([220 - 4, 220 - SHOW_AFTER - 2], down).hidden, false);
});

test('a direction change restarts the travel count', () => {
  // 20 down, 4 up, 20 down: never 24 in one direction → still visible
  assert.equal(run([120, 116, 136], at100()).hidden, false);
});

test('returning to the top zone shows the bar whatever happened before', () => {
  const down = run([200, 300], at100());
  assert.equal(down.hidden, true);
  assert.equal(nextMastState(down, 60, MAX, false).hidden, false);
});

test('locked (menu open, tour, desktop …) forces visible and forgets the travel', () => {
  const down = run([200, 300], at100());
  const locked = nextMastState(down, 340, MAX, true);
  assert.equal(locked.hidden, false);
  assert.equal(nextMastState(locked, 350, MAX, false).hidden, false, 'needs a fresh 24 px after the lock');
});

test('iOS rubber band: negative y and y beyond the end are clamped', () => {
  assert.equal(nextMastState(initialMastState(0), -80, MAX, false).hidden, false);
  const atEnd = run([4960, MAX], initialMastState(4900));
  assert.equal(atEnd.hidden, true);
  assert.equal(nextMastState(atEnd, MAX + 90, MAX, false).hidden, true, 'overscroll past the end is not an upward scroll');
  assert.equal(nextMastState(atEnd, MAX + 90, MAX, false).lastY, MAX);
});

test('a programmatic jump (scroll restore) never changes the state', () => {
  assert.equal(nextMastState(initialMastState(0), 1500, MAX, false).hidden, false);
  const down = run([200, 300], at100());
  assert.equal(nextMastState(down, 2000, MAX, false).hidden, true);
});

test('a page that cannot scroll never hides the bar', () => {
  assert.equal(run([0, 0, 0], initialMastState(0)).hidden, false);
  assert.equal(nextMastState(initialMastState(0), 50, 0, false).hidden, false);
});

test('mastBottomAfterScroll predicts where the bar will be after a programmatic scroll', () => {
  assert.equal(mastBottomAfterScroll(200, 56, 56, true, 300), 0, 'far enough down → the bar will be gone');
  assert.equal(mastBottomAfterScroll(-120, 56, -2, true, 900), 56, 'up → the bar will be back');
  assert.equal(mastBottomAfterScroll(10, 56, 56, true, 300), 56, 'a small move keeps the current state');
  assert.equal(mastBottomAfterScroll(10, 56, -2, true, 300), 0, 'hidden bar: never a negative bottom');
  assert.equal(mastBottomAfterScroll(200, 67, 67, false, 300), 67, 'desktop: the bar never hides');
  assert.equal(mastBottomAfterScroll(60, 56, 56, true, 0), 56, 'landing inside the top zone: the bar stays, however far the scroll was');
  assert.equal(mastBottomAfterScroll(-400, 56, -2, true, 430), 56, 'scrolling up INTO the top zone: the bar is back');
});
