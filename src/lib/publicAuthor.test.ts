// Run: npx tsx --test src/lib/publicAuthor.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_AUTHOR_PROJECTION, toPublicAuthor } from './publicAuthor';

test('the allowlist names exactly the public fields', () => {
  assert.deepEqual(Object.keys(PUBLIC_AUTHOR_PROJECTION).sort(),
    ['createdAt', 'handle', 'image', 'name', 'role', 'userPicture', 'verified']);
});

test('toPublicAuthor drops everything that is not public', () => {
  const out = toPublicAuthor({
    _id: { toString: () => 'abc' }, name: 'Petra', email: 'p@example.com', password: 'x',
    moderationStrikes: 2, pendingEmail: 'q@example.com', handle: 'petra2',
    userPicture: 'https://res.cloudinary.com/x/pic.jpg', verified: true, role: 'user', createdAt: '2026-01-01',
  });
  assert.deepEqual(Object.keys(out).sort(),
    ['_id', 'createdAt', 'handle', 'image', 'name', 'role', 'verified']);
  assert.equal(out._id, 'abc');
  assert.equal(out.image, 'https://res.cloudinary.com/x/pic.jpg');
  assert.equal(out.handle, 'petra2');
});

test('image falls back image → userPicture → null; handle absent → null', () => {
  assert.equal(toPublicAuthor({ _id: '1', image: 'a', userPicture: 'b' }).image, 'a');
  assert.equal(toPublicAuthor({ _id: '1' }).image, null);
  assert.equal(toPublicAuthor({ _id: '1' }).handle, null);
});
