// Run: npx tsx --test src/lib/moderationLinkMerge.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeModeration, type ModerationResult } from './moderation';
import { unsafeLinkResult } from './linkReputation';
import { shortTextVerdict } from './shortTextVerdict';

const approved: ModerationResult = { decision: 'approved', canPublish: true, needsReview: false, isUrgent: false, flaggedCategories: [], scores: { hate: 0.01 }, highestCategory: 'hate', maxScore: 0.01, userMessage: '', adminReason: '' };
const cleanLink: ModerationResult = { ...approved, scores: {}, highestCategory: '', maxScore: 0 };
const badLink = unsafeLinkResult([{ url: 'https://p.example/', threatType: 'MALWARE' }]);

test('an unsafe link alone makes the record urgent with the unsafe_link chip', () => {
  const m = composeModeration(approved, badLink);
  assert.equal(m.decision, 'urgent_review'); assert.equal(m.canPublish, false); assert.deepEqual(m.flaggedCategories, ['unsafe_link']); assert.equal(m.highestCategory, 'unsafe_link');
  assert.equal(m.adminReason, 'Safe Browsing: MALWARE — https://p.example/');
});
test('profanity short-circuit wins, link check result discarded or merged — never two records', () => {
  const profane: ModerationResult = { ...approved, decision: 'pending_review', canPublish: false, needsReview: true, flaggedCategories: ['turkish_profanity'], highestCategory: 'turkish_profanity', maxScore: 0.8, adminReason: 'Profanity' };
  const m = composeModeration(profane, badLink);
  assert.deepEqual(m.flaggedCategories, ['turkish_profanity', 'unsafe_link']); assert.equal(m.isUrgent, true); assert.equal(m.adminReason, 'Profanity | Safe Browsing: MALWARE — https://p.example/');
});
test('a flagged link in a short text (motto) is refused, not tolerated', () => {
  assert.equal(shortTextVerdict([badLink]), 'refused');
});
test('clean link → the OpenAI result itself, scores intact', () => {
  assert.equal(composeModeration(approved, cleanLink), approved);
  const flagged: ModerationResult = { ...approved, decision: 'pending_review', canPublish: false, needsReview: true, flaggedCategories: ['hate'], maxScore: 0.9 };
  assert.equal(composeModeration(flagged, cleanLink), flagged);
});
