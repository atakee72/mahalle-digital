// Run: npx tsx --test src/lib/limits/limitRules.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideLimit } from './limitRules';

test('plain member below and at the limit', () => {
  assert.deepEqual(decideLimit({ count: 4, role: 'user', user: {} }),
    { count: 4, limit: 5, remaining: 1, allowed: true });
  assert.deepEqual(decideLimit({ count: 5, role: 'user', user: {} }),
    { count: 5, limit: 5, remaining: 0, allowed: false });
  assert.deepEqual(decideLimit({ count: 9, role: 'user', user: null }),
    { count: 9, limit: 5, remaining: 0, allowed: false });
});

test('raised organisation', () => {
  assert.deepEqual(decideLimit({ count: 5, role: 'user', user: { memberType: 'organisation', dailyLimit: 15 } }),
    { count: 5, limit: 15, remaining: 10, allowed: true });
  assert.deepEqual(decideLimit({ count: 15, role: 'user', user: { memberType: 'organisation', dailyLimit: 15 } }),
    { count: 15, limit: 15, remaining: 0, allowed: false });
});

test('business with a stray number stays at 5', () => {
  assert.deepEqual(decideLimit({ count: 5, role: 'user', user: { memberType: 'business', dailyLimit: 30 } }),
    { count: 5, limit: 5, remaining: 0, allowed: false });
});

test('admin is always allowed and sees the full limit as remaining', () => {
  assert.deepEqual(decideLimit({ count: 40, role: 'admin', user: {} }),
    { count: 40, limit: 5, remaining: 5, allowed: true });
});
