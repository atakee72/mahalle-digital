import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOG_SLUG_RE, pickBlogAuthor } from './blogCommentRules';
import { CommentCreateSchema } from '../../schemas/comment.schema';

test('slug regex', () => {
  assert.ok(BLOG_SLUG_RE.test('serie-01-schluessel'));
  assert.ok(BLOG_SLUG_RE.test('a--b'));
  assert.ok(!BLOG_SLUG_RE.test('../x'));
  assert.ok(!BLOG_SLUG_RE.test('A'));
  assert.ok(!BLOG_SLUG_RE.test(''));
  assert.ok(!BLOG_SLUG_RE.test('a'.repeat(121)));
  assert.ok(BLOG_SLUG_RE.test('a'.repeat(120)));
});

test('pickBlogAuthor order', () => {
  assert.equal(pickBlogAuthor({ postAuthorId: 'u1', adminId: 'a1' }), 'u1');
  assert.equal(pickBlogAuthor({ postAuthorId: null, adminId: 'a1' }), 'a1');
  assert.equal(pickBlogAuthor({ postAuthorId: null, adminId: null }), null);
});

test('CommentCreateSchema accepts the blog shape and rejects bad ones', () => {
  assert.ok(CommentCreateSchema.safeParse({ body: 'Schön', blogSlug: 'serie-01-schluessel' }).success);
  assert.ok(CommentCreateSchema.safeParse({ body: 'Hallo', topicId: '507f1f77bcf86cd799439011', collectionType: 'topics' }).success);
  assert.ok(!CommentCreateSchema.safeParse({ body: 'Nur Text' }).success);
  assert.ok(!CommentCreateSchema.safeParse({ body: 'x', blogSlug: 'Bad Slug' }).success);
});
