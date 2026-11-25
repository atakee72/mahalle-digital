import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  likeNoticeTitle,
  shouldNotifyLike,
  likeRowVariant,
  shouldDeleteLikeRow,
  buildLikeUpsertPipeline,
  buildUnlikePipeline,
} from './likeNotifyRules';

test('title: first 80 chars of the text, whitespace collapsed', () => {
  assert.equal(likeNoticeTitle('a'.repeat(100)).length, 80);
  assert.equal(likeNoticeTitle('  hello \n  world '), 'hello world');
  assert.equal(likeNoticeTitle(undefined), '');
});

test('skip when liker is the author, author missing, or author gone', () => {
  assert.equal(shouldNotifyLike({ likerId: 'a', authorId: 'a', authorLive: true }), false);
  assert.equal(shouldNotifyLike({ likerId: 'a', authorId: null, authorLive: true }), false);
  assert.equal(shouldNotifyLike({ likerId: 'a', authorId: 'b', authorLive: false }), false);
  assert.equal(shouldNotifyLike({ likerId: 'a', authorId: 'b', authorLive: true }), true);
});

test('row variant: comment vs post, one vs many', () => {
  assert.deepEqual(likeRowVariant('comment', 1), { subject: 'comment', many: false });
  assert.deepEqual(likeRowVariant('comment', 3), { subject: 'comment', many: true });
  assert.deepEqual(likeRowVariant('topic', 2), { subject: 'post', many: true });
  assert.deepEqual(likeRowVariant('recommendation', undefined), { subject: 'post', many: false });
});

test('unlike to zero deletes the row, otherwise keeps it', () => {
  assert.equal(shouldDeleteLikeRow([]), true);
  assert.equal(shouldDeleteLikeRow(['x']), false);
  assert.equal(shouldDeleteLikeRow(undefined), true);
});

const now = new Date('2026-11-25T10:00:00Z');
const base = {
  userId: 'author', sourceId: 'c1', contentKind: 'comment' as const,
  target: { contentType: 'topic' as const, contentId: 'p1', title: '$weird', href: '/topics/p1' },
};

test('like pipeline: new liker resets createdAt and readAt, repeated one does not', () => {
  const p: any[] = buildLikeUpsertPipeline({ ...base, likerId: 'u1', now });
  const text = JSON.stringify(p);
  // membership is judged on the ORIGINAL list, in the first stage
  assert.ok(p[0].$set._isNew, 'first stage computes _isNew from the original likers');
  assert.match(JSON.stringify(p[0]), /"\$in":\["u1"/);
  // createdAt / readAt only move when _isNew
  const last = p.find((s) => s.$set?.readAt);
  assert.deepEqual(last.$set.readAt.$cond, ['$_isNew', null, '$readAt']);
  assert.equal(last.$set.createdAt.$cond[0], '$_isNew');
  assert.equal(last.$set.createdAt.$cond[2], '$createdAt');
  assert.ok(p.some((s) => s.$unset === '_isNew'));
  // a title starting with $ must be literal
  assert.match(text, /"\$literal":\{[^}]*"title":"\$weird"/);
  // no actorId and no names on a like row
  assert.doesNotMatch(text, /actorId/);
});

test('unlike pipeline pulls the liker and re-derives count, never touches readAt/createdAt', () => {
  const p: any[] = buildUnlikePipeline('u1');
  const text = JSON.stringify(p);
  assert.match(text, /"\$ne":\["\$\$this","u1"\]/);
  assert.match(text, /meta\.count/);
  assert.doesNotMatch(text, /readAt|createdAt/);
});
