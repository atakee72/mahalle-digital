import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideTranslateAccess,
  MEMBER_MAX_PER_HOUR,
  VISITOR_IP_MAX_PER_HOUR,
  VISITOR_FRESH_MAX_PER_DAY,
  VISITOR_FRESH_KEY,
} from './translateAccess';

test('a member translates anything under their own hourly key', () => {
  const a = decideTranslateAccess({ userId: 'u1', contentType: 'topic', ipHash: 'abc' });
  assert.deepEqual(a, { kind: 'member', key: 'tr:u1' });
  assert.deepEqual(decideTranslateAccess({ userId: 'u1', contentType: 'blog', ipHash: 'abc' }), { kind: 'member', key: 'tr:u1' });
});

test('a visitor may translate a blog post, limited per IP hash', () => {
  const a = decideTranslateAccess({ userId: undefined, contentType: 'blog', ipHash: 'abc' });
  assert.deepEqual(a, { kind: 'visitor', ipKey: 'tr:anon:ip:abc', freshKey: VISITOR_FRESH_KEY });
});

test('a visitor is refused for every members-only content type', () => {
  for (const t of ['topic', 'announcement', 'recommendation', 'event', 'listing', 'news', 'comment', 'nonsense']) {
    assert.deepEqual(decideTranslateAccess({ userId: null, contentType: t, ipHash: 'abc' }), { kind: 'refused' }, t);
  }
});

test('an empty user id counts as a visitor', () => {
  assert.equal(decideTranslateAccess({ userId: '', contentType: 'blog', ipHash: 'abc' }).kind, 'visitor');
  assert.equal(decideTranslateAccess({ userId: '', contentType: 'topic', ipHash: 'abc' }).kind, 'refused');
});

test('limits: members keep 30/h, visitors 10/h per IP and a shared daily DeepL budget', () => {
  assert.equal(MEMBER_MAX_PER_HOUR, 30);
  assert.equal(VISITOR_IP_MAX_PER_HOUR, 10);
  assert.equal(VISITOR_FRESH_MAX_PER_DAY, 10);
  assert.equal(VISITOR_FRESH_KEY, 'tr:anon:fresh');
});
