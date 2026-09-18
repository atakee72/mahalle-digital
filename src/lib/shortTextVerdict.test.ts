import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFailSafeResult, shortTextVerdict } from './shortTextVerdict';

const approved = { decision: 'approved', flaggedCategories: [] as string[] };
const failSafe = { decision: 'pending_review', flaggedCategories: ['moderation_error'] };
const flagged = { decision: 'pending_review', flaggedCategories: ['harassment'] };
const rejected = { decision: 'rejected', flaggedCategories: ['hate'] };

test('a fail-safe result is recognised by its moderation_error category', () => {
  assert.equal(isFailSafeResult(failSafe), true);
  assert.equal(isFailSafeResult(approved), false);
  assert.equal(isFailSafeResult(flagged), false);
});

test('both checks approved → clean', () => {
  assert.equal(shortTextVerdict([approved, approved]), 'clean');
});

test('OpenAI down on both checks → clean (the blocklists already ran)', () => {
  assert.equal(shortTextVerdict([failSafe, failSafe]), 'clean');
});

test('one check down, the other approved → clean', () => {
  assert.equal(shortTextVerdict([failSafe, approved]), 'clean');
  assert.equal(shortTextVerdict([approved, failSafe]), 'clean');
});

test('a real flag still refuses, also when the other check is down', () => {
  assert.equal(shortTextVerdict([flagged, approved]), 'refused');
  assert.equal(shortTextVerdict([failSafe, flagged]), 'refused');
  assert.equal(shortTextVerdict([rejected, failSafe]), 'refused');
});

test('a result that mixes moderation_error with a real category is NOT a fail-safe', () => {
  const mixed = { decision: 'pending_review', flaggedCategories: ['moderation_error', 'hate'] };
  assert.equal(isFailSafeResult(mixed), false);
  assert.equal(shortTextVerdict([mixed]), 'refused');
});
