// Run: npx tsx --test src/lib/members/memberTypeChange.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSelfTypeChange, planAdminPatch } from './memberTypeChange';

test('self: same type is a no-op (limit survives, no ping)', () => {
  for (const t of ['person', 'organisation', 'business'] as const) {
    assert.deepEqual(planSelfTypeChange(t, t), { changed: false, set: {}, unset: [], ping: false });
  }
});

test('self: to organisation or business sets the field and pings', () => {
  assert.deepEqual(planSelfTypeChange('person', 'organisation'),
    { changed: true, set: { memberType: 'organisation' }, unset: ['dailyLimit'], ping: true });
  assert.deepEqual(planSelfTypeChange('person', 'business'),
    { changed: true, set: { memberType: 'business' }, unset: ['dailyLimit'], ping: true });
});

test('self: leaving organisation clears the limit', () => {
  assert.deepEqual(planSelfTypeChange('organisation', 'business'),
    { changed: true, set: { memberType: 'business' }, unset: ['dailyLimit'], ping: true });
  assert.deepEqual(planSelfTypeChange('organisation', 'person'),
    { changed: true, set: {}, unset: ['memberType', 'dailyLimit'], ping: false });
});

test('self: to person stores nothing and does not ping', () => {
  assert.deepEqual(planSelfTypeChange('business', 'person'),
    { changed: true, set: {}, unset: ['memberType', 'dailyLimit'], ping: false });
});

test('admin: empty body is refused', () => {
  assert.deepEqual(planAdminPatch({}, {}), { ok: false, error: 'invalid_body' });
});

test('admin: verified alone passes through', () => {
  assert.deepEqual(planAdminPatch({ memberType: 'business' }, { verified: true }), {
    ok: true, set: { verified: true }, unset: [],
    result: { memberType: 'business', dailyLimit: null },
  });
});

test('admin: a limit needs an organisation', () => {
  assert.deepEqual(planAdminPatch({}, { dailyLimit: 10 }), { ok: false, error: 'limit_needs_organisation' });
  assert.deepEqual(planAdminPatch({ memberType: 'business' }, { dailyLimit: 10 }),
    { ok: false, error: 'limit_needs_organisation' });
});

test('admin: limit together with leaving organisation is refused', () => {
  assert.deepEqual(planAdminPatch({ memberType: 'organisation', dailyLimit: 20 }, { memberType: 'person', dailyLimit: 10 }),
    { ok: false, error: 'limit_needs_organisation' });
});

test('admin: type and limit in one call', () => {
  assert.deepEqual(planAdminPatch({}, { memberType: 'organisation', dailyLimit: 15 }), {
    ok: true, set: { memberType: 'organisation', dailyLimit: 15 }, unset: [],
    result: { memberType: 'organisation', dailyLimit: 15 },
  });
});

test('admin: limit for a stored organisation; null removes it', () => {
  assert.deepEqual(planAdminPatch({ memberType: 'organisation' }, { dailyLimit: 30 }), {
    ok: true, set: { dailyLimit: 30 }, unset: [],
    result: { memberType: 'organisation', dailyLimit: 30 },
  });
  assert.deepEqual(planAdminPatch({ memberType: 'organisation', dailyLimit: 30 }, { dailyLimit: null }), {
    ok: true, set: {}, unset: ['dailyLimit'],
    result: { memberType: 'organisation', dailyLimit: null },
  });
  // null for a non-organisation is a harmless unset, not an error
  assert.deepEqual(planAdminPatch({}, { dailyLimit: null }), {
    ok: true, set: {}, unset: ['dailyLimit'],
    result: { memberType: 'person', dailyLimit: null },
  });
});

test('admin: correcting away from organisation clears the limit', () => {
  assert.deepEqual(planAdminPatch({ memberType: 'organisation', dailyLimit: 20 }, { memberType: 'business' }), {
    ok: true, set: { memberType: 'business' }, unset: ['dailyLimit'],
    result: { memberType: 'business', dailyLimit: null },
  });
  assert.deepEqual(planAdminPatch({ memberType: 'organisation', dailyLimit: 20 }, { memberType: 'person' }), {
    ok: true, set: {}, unset: ['memberType', 'dailyLimit'],
    result: { memberType: 'person', dailyLimit: null },
  });
});

test('admin: keeping organisation keeps a stored limit in the result', () => {
  assert.deepEqual(planAdminPatch({ memberType: 'organisation', dailyLimit: 20 }, { memberType: 'organisation' }), {
    ok: true, set: { memberType: 'organisation' }, unset: [],
    result: { memberType: 'organisation', dailyLimit: 20 },
  });
});

test('a stray stored limit never comes back with the type', () => {
  // member chooses organisation while a stray number sits on the document
  assert.deepEqual(planSelfTypeChange('business', 'organisation'),
    { changed: true, set: { memberType: 'organisation' }, unset: ['dailyLimit'], ping: true });
  // admin makes a business with a stray 20 an organisation, without a number
  assert.deepEqual(planAdminPatch({ memberType: 'business', dailyLimit: 20 }, { memberType: 'organisation' }), {
    ok: true, set: { memberType: 'organisation' }, unset: ['dailyLimit'],
    result: { memberType: 'organisation', dailyLimit: null },
  });
  // admin sets a person to organisation: nothing stored, unset is harmless
  assert.deepEqual(planAdminPatch({}, { memberType: 'organisation' }), {
    ok: true, set: { memberType: 'organisation' }, unset: ['dailyLimit'],
    result: { memberType: 'organisation', dailyLimit: null },
  });
});
