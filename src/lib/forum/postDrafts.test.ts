import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_POST_DRAFTS, draftIsEmpty, draftResumeHref } from './postDrafts';
import { PostDraftSaveSchema } from '../../schemas/forum.schema';

const base = { kind: 'discussion' as const, title: '', body: '', tags: [], images: [] };

test('a draft may be incomplete but not empty', () => {
  assert.equal(draftIsEmpty(base), true);
  assert.equal(draftIsEmpty({ ...base, title: '   ' }), true);
  assert.equal(draftIsEmpty({ ...base, title: 'Hi' }), false);
  assert.equal(draftIsEmpty({ ...base, body: 'x' }), false);
  assert.equal(draftIsEmpty({ ...base, tags: ['garten'] }), false);
  assert.equal(draftIsEmpty({ ...base, images: [{ url: 'https://res.cloudinary.com/x/mahalle/posts/a.jpg', publicId: 'mahalle/posts/a' }] }), false);
});

test('limits and links', () => {
  assert.equal(MAX_POST_DRAFTS, 20);
  assert.equal(draftResumeHref('64f000000000000000000001'), '/topics/create?draft=64f000000000000000000001');
});

test('schema: short text is fine, publish limits are not exceeded', () => {
  assert.equal(PostDraftSaveSchema.safeParse({ ...base, title: 'Hi' }).success, true);
  assert.equal(PostDraftSaveSchema.safeParse({ ...base, title: 'x'.repeat(201) }).success, false);
  assert.equal(PostDraftSaveSchema.safeParse({ ...base, body: 'x'.repeat(5001) }).success, false);
  assert.equal(PostDraftSaveSchema.safeParse({ ...base, tags: ['a', 'b', 'c', 'd', 'e', 'f'] }).success, false);
  assert.equal(PostDraftSaveSchema.safeParse({ ...base, kind: 'official' }).success, false);
  assert.equal(PostDraftSaveSchema.safeParse({ ...base, id: 'not-an-id', title: 'Hi' }).success, false);
  const ok = PostDraftSaveSchema.safeParse({ ...base, id: '64f000000000000000000001', title: '  Hi  ' });
  assert.equal(ok.success && ok.data.title, 'Hi');
});

test('schema: a draft image must be one of our own uploads', () => {
  const img = (url: string, publicId: string) => PostDraftSaveSchema.safeParse({ ...base, images: [{ url, publicId }] }).success;
  assert.equal(img('https://res.cloudinary.com/demo/image/upload/v1/mahalle/posts/abc.jpg', 'mahalle/posts/abc'), true);
  assert.equal(img('https://evil.example/mahalle/posts/abc.jpg', 'mahalle/posts/abc'), false); // foreign host
  assert.equal(img('https://res.cloudinary.com/demo/image/upload/v1/mahalle/profile/abc.jpg', 'mahalle/profile/abc'), false); // other folder
  assert.equal(img('https://res.cloudinary.com/demo/image/upload/v1/mahalle/posts/abc.jpg', 'mahalle/posts/other'), false); // url ≠ publicId
});
