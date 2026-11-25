import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { decideCommentLike, shapeCommentForViewer } from './commentLike';

const me = '64b000000000000000000001';
const other = '64b000000000000000000002';

test('a missing comment is not_found', () => {
  assert.deepEqual(decideCommentLike(null, me), { kind: 'not_found' });
  assert.deepEqual(decideCommentLike(undefined, me), { kind: 'not_found' });
});

test('pending and rejected comments are not_found', () => {
  assert.equal(decideCommentLike({ author: other, moderationStatus: 'pending' }, me).kind, 'not_found');
  assert.equal(decideCommentLike({ author: other, moderationStatus: 'rejected' }, me).kind, 'not_found');
});

test('approved or missing status is allowed for another member', () => {
  assert.equal(decideCommentLike({ author: other, moderationStatus: 'approved' }, me).kind, 'allowed');
  assert.equal(decideCommentLike({ author: other }, me).kind, 'allowed');
});

test('own comment is refused, author as string or ObjectId', () => {
  assert.equal(decideCommentLike({ author: me }, me).kind, 'own');
  assert.equal(decideCommentLike({ author: new ObjectId(me) }, me).kind, 'own');
});

test('not_found wins over own for a non-approved own comment', () => {
  assert.equal(decideCommentLike({ author: me, moderationStatus: 'pending' }, me).kind, 'not_found');
});

test('shape: strips likedBy, derives likedByMe and likes', () => {
  const out = shapeCommentForViewer({ _id: 'c', body: 'x', likedBy: [me, other], likes: 7 }, me);
  assert.equal('likedBy' in out, false);
  assert.equal(out.likedByMe, true);
  assert.equal(out.likes, 2);
  assert.equal(out.body, 'x');
});

test('shape: not liked, anonymous viewer, no likedBy', () => {
  assert.equal(shapeCommentForViewer({ likedBy: [other] }, me).likedByMe, false);
  assert.equal(shapeCommentForViewer({ likedBy: [me] }, null).likedByMe, false);
  const legacy = shapeCommentForViewer({ likes: 3 }, me);
  assert.equal(legacy.likedByMe, false);
  assert.equal(legacy.likes, 3);
});
