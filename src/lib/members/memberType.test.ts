// Run: npx tsx --test src/lib/members/memberType.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMBER_TYPES, parseMemberType, storedMemberType, memberTypeTagKey,
  effectiveDailyLimit, DEFAULT_DAILY_LIMIT, MAX_DAILY_LIMIT,
} from './memberType';

test('the three types, person first', () => {
  assert.deepEqual([...MEMBER_TYPES], ['person', 'organisation', 'business']);
});

test('parseMemberType accepts exact values only', () => {
  assert.equal(parseMemberType('person'), 'person');
  assert.equal(parseMemberType('organisation'), 'organisation');
  assert.equal(parseMemberType('business'), 'business');
  for (const bad of ['Organisation', ' business', 'organization', '', null, undefined, 1, {}, ['person']]) {
    assert.equal(parseMemberType(bad), null);
  }
});

test('unknown stored value reads as person', () => {
  assert.equal(storedMemberType(null), 'person');
  assert.equal(storedMemberType(undefined), 'person');
  assert.equal(storedMemberType({}), 'person');
  assert.equal(storedMemberType({ memberType: 'admin' }), 'person');
  assert.equal(storedMemberType({ memberType: 42 }), 'person');
  assert.equal(storedMemberType({ memberType: 'business' }), 'business');
  assert.equal(storedMemberType({ memberType: 'organisation' }), 'organisation');
});

test('tag key: none for a person or junk', () => {
  assert.equal(memberTypeTagKey('person'), null);
  assert.equal(memberTypeTagKey(undefined), null);
  assert.equal(memberTypeTagKey('admin'), null);
  assert.equal(memberTypeTagKey('organisation'), 'member.tag.organisation');
  assert.equal(memberTypeTagKey('business'), 'member.tag.business');
});

test('effective limit: only an organisation with a valid number is raised', () => {
  assert.equal(DEFAULT_DAILY_LIMIT, 5);
  assert.equal(MAX_DAILY_LIMIT, 50);
  assert.equal(effectiveDailyLimit(null), 5);
  assert.equal(effectiveDailyLimit({}), 5);
  assert.equal(effectiveDailyLimit({ memberType: 'organisation' }), 5);
  assert.equal(effectiveDailyLimit({ memberType: 'organisation', dailyLimit: 15 }), 15);
  assert.equal(effectiveDailyLimit({ memberType: 'organisation', dailyLimit: 1 }), 1);
  assert.equal(effectiveDailyLimit({ memberType: 'organisation', dailyLimit: 50 }), 50);
});

test('business with a stray number stays at 5; out-of-range numbers are ignored', () => {
  assert.equal(effectiveDailyLimit({ memberType: 'business', dailyLimit: 30 }), 5);
  assert.equal(effectiveDailyLimit({ dailyLimit: 30 }), 5);
  for (const bad of [0, -3, 51, 500, 7.5, '15', null, NaN]) {
    assert.equal(effectiveDailyLimit({ memberType: 'organisation', dailyLimit: bad }), 5);
  }
});
