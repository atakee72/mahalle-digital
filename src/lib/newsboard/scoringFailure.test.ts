import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoringFailureReason } from './scoringFailure';

test('a truncated or non-JSON answer is "json parse"', () => {
  let err: unknown;
  try { JSON.parse('[{"id": 0, "score": 8'); } catch (e) { err = e; }
  assert.equal(scoringFailureReason(err), 'json parse');
});

test('the 30 s AbortSignal timeout is "timeout"', () => {
  assert.equal(scoringFailureReason(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'timeout');
  assert.equal(scoringFailureReason(Object.assign(new Error('x'), { name: 'AbortError' })), 'timeout');
});

test('any other error reports its class name; a non-error is "unknown"', () => {
  assert.equal(scoringFailureReason(new TypeError('fetch failed')), 'TypeError');
  assert.equal(scoringFailureReason('boom'), 'unknown');
  assert.equal(scoringFailureReason(null), 'unknown');
});
