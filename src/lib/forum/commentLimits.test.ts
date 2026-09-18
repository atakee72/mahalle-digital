import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMENT_MAX_LEN, commentCounterVisible } from './commentLimits';
import { CommentCreateSchema, CommentUpdateSchema } from '../../schemas/comment.schema';

test('counter stays hidden for ordinary comments and appears at 80 %', () => {
  assert.equal(commentCounterVisible(0), false);
  assert.equal(commentCounterVisible(2399), false);
  assert.equal(commentCounterVisible(2400), true);
  assert.equal(commentCounterVisible(COMMENT_MAX_LEN), true);
});

test('create and edit schemas enforce the same shared limit', () => {
  const id = '6a7f977a6ef9655fa05febe9';
  const create = (n: number) => CommentCreateSchema.safeParse({ body: 'x'.repeat(n), topicId: id, collectionType: 'topics' }).success;
  const edit = (n: number) => CommentUpdateSchema.safeParse({ body: 'x'.repeat(n) }).success;
  assert.equal(create(COMMENT_MAX_LEN), true);
  assert.equal(create(COMMENT_MAX_LEN + 1), false);
  assert.equal(edit(COMMENT_MAX_LEN), true);
  assert.equal(edit(COMMENT_MAX_LEN + 1), false);
});
