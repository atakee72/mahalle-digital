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
