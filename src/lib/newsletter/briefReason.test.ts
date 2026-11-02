import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefReasonFor, briefReasonAfterAdminToggle, reenableAfterAddressChange } from './briefReason';

const off = (via: unknown) => ({ newsletter: 'off', newsletterOff: { via, at: new Date() } });

test('banned wins over everything', () => {
  assert.equal(briefReasonFor({ isBanned: true, deletionScheduledAt: new Date(), ...off('bounce') }), 'banned');
  assert.equal(briefReasonFor({ isBanned: true }), 'banned');
});
test('deleting beats the stored via', () => {
  assert.equal(briefReasonFor({ deletionScheduledAt: new Date(), ...off('link') }), 'deleting');
});
test('every known via is returned', () => {
  for (const v of ['profile', 'link', 'one-click', 'admin', 'bounce', 'complaint'])
    assert.equal(briefReasonFor(off(v)), v);
});
test('off without a (known) via is null', () => {
  assert.equal(briefReasonFor({ newsletter: 'off' }), null);
  assert.equal(briefReasonFor(off('weird')), null);
  assert.equal(briefReasonFor({ newsletter: 'off', newsletterOff: 'x' }), null);
});
test('weekly is null, even with a leftover via', () => {
  assert.equal(briefReasonFor({}), null);
  assert.equal(briefReasonFor({ newsletterOff: { via: 'bounce' } }), null);
  assert.equal(briefReasonFor({ isBanned: false, deletionScheduledAt: null }), null);
});
test('admin toggle', () => {
  assert.equal(briefReasonAfterAdminToggle(null, 'off'), 'admin');
  assert.equal(briefReasonAfterAdminToggle('bounce', 'off'), 'admin');
  assert.equal(briefReasonAfterAdminToggle('bounce', 'weekly'), null);
  assert.equal(briefReasonAfterAdminToggle('banned', 'off'), 'banned');
  assert.equal(briefReasonAfterAdminToggle('banned', 'weekly'), 'banned');
  assert.equal(briefReasonAfterAdminToggle('deleting', 'off'), 'deleting');
  assert.equal(briefReasonAfterAdminToggle('deleting', 'weekly'), 'deleting');
});
test('address change re-enables only after a bounce', () => {
  assert.equal(reenableAfterAddressChange({ newsletterOff: { via: 'bounce' } }), true);
  for (const b of [{ newsletterOff: { via: 'complaint' } }, { newsletterOff: { via: 'link' } }, {}, null, undefined, { newsletterOff: 'bounce' }])
    assert.equal(reenableAfterAddressChange(b), false);
});

import { nextOffStamp, reenableAfterAddressChange as reenable } from './briefReason';

const T0 = new Date('2026-11-01T00:00:00Z');
const T1 = new Date('2026-11-02T00:00:00Z');
const prevOff = (via?: string) => ({ newsletter: 'off', ...(via ? { newsletterOff: { via, at: T0 } } : {}) });

test('nextOffStamp: weekly before -> new stamp', () => {
  assert.deepEqual(nextOffStamp({}, 'bounce', T1), { via: 'bounce', at: T1 });
  assert.deepEqual(nextOffStamp(null, 'link', T1), { via: 'link', at: T1 });
  assert.deepEqual(nextOffStamp({ newsletterOff: { via: 'link', at: T0 } }, 'bounce', T1), { via: 'bounce', at: T1 });
});
test('nextOffStamp: same via keeps the stamp (idempotent)', () => {
  assert.deepEqual(nextOffStamp(prevOff('bounce'), 'bounce', T1), { via: 'bounce', at: T0 });
  assert.deepEqual(nextOffStamp(prevOff('link'), 'link', T1), { via: 'link', at: T0 });
});
test('nextOffStamp: deliberate opt-out overrides a bounce', () => {
  for (const v of ['profile', 'link', 'one-click', 'complaint', 'admin'] as const)
    assert.deepEqual(nextOffStamp(prevOff('bounce'), v, T1), { via: v, at: T1 });
});
test('nextOffStamp: bounce never overrides a deliberate stamp', () => {
  for (const v of ['profile', 'link', 'one-click', 'complaint', 'admin'])
    assert.deepEqual(nextOffStamp(prevOff(v), 'bounce', T1), { via: v, at: T0 });
});
test('nextOffStamp: old off without stamp stays reason-less on a bounce', () => {
  assert.equal(nextOffStamp(prevOff(), 'bounce', T1), null);
  assert.deepEqual(nextOffStamp(prevOff(), 'complaint', T1), { via: 'complaint', at: T1 });
  assert.deepEqual(nextOffStamp(prevOff(), 'profile', T1), { via: 'profile', at: T1 });
});
test('bounce -> complaint -> address change leaves newsletter off', () => {
  const s1 = nextOffStamp({}, 'bounce', T0)!;
  const s2 = nextOffStamp({ newsletter: 'off', newsletterOff: s1 }, 'complaint', T1)!;
  assert.equal(s2.via, 'complaint');
  assert.equal(reenable({ newsletter: 'off', newsletterOff: s2 }), false);
});
