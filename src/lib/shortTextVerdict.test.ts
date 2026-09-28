import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFailSafeResult, isToleratedResult, shortTextVerdict } from './shortTextVerdict';

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

const advert = { decision: 'pending_review', flaggedCategories: ['spam_check:ad_promotional'] };
const spam = { decision: 'pending_review', flaggedCategories: ['spam_check:spam'] };
const advertAndHate = { decision: 'pending_review', flaggedCategories: ['spam_check:ad_promotional', 'hate'] };

test('an advert label alone is tolerated for a short text (a shop name is not spam)', () => {
  assert.equal(shortTextVerdict([approved, advert]), 'clean');
  assert.equal(isToleratedResult(advert), true);
});
test('spam / scam / hate / harassment labels still refuse', () => {
  assert.equal(shortTextVerdict([approved, spam]), 'refused');
  assert.equal(shortTextVerdict([approved, { decision: 'pending_review', flaggedCategories: ['spam_check:scam'] }]), 'refused');
  assert.equal(shortTextVerdict([approved, { decision: 'pending_review', flaggedCategories: ['spam_check:hate_speech'] }]), 'refused');
  assert.equal(shortTextVerdict([approved, { decision: 'pending_review', flaggedCategories: ['spam_check:harassment'] }]), 'refused');
});
test('an advert label next to a real category is NOT tolerated', () => {
  assert.equal(isToleratedResult(advertAndHate), false);
  assert.equal(shortTextVerdict([approved, advertAndHate]), 'refused');
});
