import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { decideCommentLike, shapeCommentForViewer, shapePostForViewer, isParentVisible, buildCommentLikePipeline, fieldsNeedLikeShape, stripLikedBy } from './commentLike';

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

test('isParentVisible: approved, missing, pending+reported are visible', () => {
  assert.equal(isParentVisible({ moderationStatus: 'approved' }), true);
  assert.equal(isParentVisible({}), true);
  assert.equal(isParentVisible({ moderationStatus: 'pending', isUserReported: true }), true);
});

test('isParentVisible: pending, rejected, null are not visible', () => {
  assert.equal(isParentVisible({ moderationStatus: 'pending' }), false);
  assert.equal(isParentVisible({ moderationStatus: 'pending', isUserReported: false }), false);
  assert.equal(isParentVisible({ moderationStatus: 'rejected' }), false);
  assert.equal(isParentVisible({ moderationStatus: 'rejected', isUserReported: true }), false);
  assert.equal(isParentVisible(null), false);
  assert.equal(isParentVisible(undefined), false);
});

test('shape: legacy number is kept next to the list', () => {
  const out: any = shapeCommentForViewer({ likedBy: [me, other], legacyLikes: 4, likes: 6 }, me);
  assert.equal(out.likes, 6);
  assert.equal('legacyLikes' in out, false);
  assert.equal('likedBy' in out, false);
});

test('shape: no list keeps the stored number, legacyLikes is stripped', () => {
  const out: any = shapeCommentForViewer({ likes: 4, legacyLikes: 9 }, me);
  assert.equal(out.likes, 4);
  assert.equal('legacyLikes' in out, false);
});

test('post shape: strips likedBy, adds likes and likedByMe', () => {
  const out: any = shapePostForViewer({ _id: 'p', title: 't', likedBy: [me, other], likes: 9 }, me);
  assert.equal('likedBy' in out, false);
  assert.equal(out.likes, 2);
  assert.equal(out.likedByMe, true);
  assert.equal(out.title, 't');
  const none: any = shapePostForViewer({ likedBy: [other] }, null);
  assert.equal(none.likedByMe, false);
  assert.equal(shapePostForViewer({ likes: 5 }, me).likes, 5);
});

test('comment pipeline: legacyLikes first (list present keeps it, else takes likes), then list, then sum', () => {
  for (const action of ['like', 'unlike'] as const) {
    const p: any[] = buildCommentLikePipeline(action, me);
    assert.equal(p.length, 3);
    assert.deepEqual(p[0].$set.legacyLikes.$cond, [
      { $isArray: '$likedBy' },
      { $ifNull: ['$legacyLikes', 0] },
      { $ifNull: ['$likes', 0] },
    ]);
    assert.ok(p[1].$set.likedBy);
    assert.deepEqual(p[2].$set.likes, { $add: ['$legacyLikes', { $size: { $ifNull: ['$likedBy', []] } }] });
  }
  assert.match(JSON.stringify(buildCommentLikePipeline('like', me)[1]), /\$setUnion/);
  assert.match(JSON.stringify(buildCommentLikePipeline('unlike', me)[1]), /\$filter/);
});

test('fieldsNeedLikeShape: no projection or a projection with likes/likedBy needs shaping', () => {
  assert.equal(fieldsNeedLikeShape(undefined), true);
  assert.equal(fieldsNeedLikeShape([]), true);
  assert.equal(fieldsNeedLikeShape(['title', 'likes']), true);
  assert.equal(fieldsNeedLikeShape(['title', 'likedBy']), true);
  assert.equal(fieldsNeedLikeShape(['title', 'body']), false);
  // a field list from the browser: exclusions and dotted paths still pull the like fields in
  assert.equal(fieldsNeedLikeShape(['-_id', '-body']), true);
  assert.equal(fieldsNeedLikeShape(['title', 'likedBy.0']), true);
});

test('stripLikedBy: an unshaped item never keeps the id list', () => {
  assert.deepEqual(stripLikedBy({ title: 'a', likedBy: ['u1'] }), { title: 'a' });
  assert.deepEqual(stripLikedBy({ title: 'a' }), { title: 'a' });
});
