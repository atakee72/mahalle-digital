// Run: npx tsx --test src/lib/publicAuthor.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_AUTHOR_PROJECTION, toPublicAuthor } from './publicAuthor';

test('the allowlist names exactly the public fields', () => {
  assert.deepEqual(Object.keys(PUBLIC_AUTHOR_PROJECTION).sort(),
    ['createdAt', 'handle', 'image', 'memberType', 'name', 'role', 'userPicture', 'verified']);
});

test('toPublicAuthor drops everything that is not public', () => {
  const out = toPublicAuthor({
    _id: { toString: () => 'abc' }, name: 'Petra', email: 'p@example.com', password: 'x',
    moderationStrikes: 2, pendingEmail: 'q@example.com', handle: 'petra2',
    userPicture: 'https://res.cloudinary.com/x/pic.jpg', verified: true, role: 'user', createdAt: '2026-01-01',
  });
  assert.deepEqual(Object.keys(out).sort(),
    ['_id', 'createdAt', 'handle', 'image', 'memberType', 'name', 'role', 'verified']);
  assert.equal(out._id, 'abc');
  assert.equal(out.image, 'https://res.cloudinary.com/x/pic.jpg');
  assert.equal(out.handle, 'petra2');
  assert.equal(out.memberType, 'person');
});

test('image falls back image → userPicture → null; handle absent → null', () => {
  assert.equal(toPublicAuthor({ _id: '1', image: 'a', userPicture: 'b' }).image, 'a');
  assert.equal(toPublicAuthor({ _id: '1' }).image, null);
  assert.equal(toPublicAuthor({ _id: '1' }).handle, null);
});

test('memberType is always one of the three values; the limit never leaves', () => {
  assert.equal(toPublicAuthor({ _id: '1', memberType: 'business' }).memberType, 'business');
  assert.equal(toPublicAuthor({ _id: '1', memberType: 'organisation', dailyLimit: 20 }).memberType, 'organisation');
  assert.equal(toPublicAuthor({ _id: '1', memberType: 'admin' }).memberType, 'person');
  assert.equal('dailyLimit' in toPublicAuthor({ _id: '1', memberType: 'organisation', dailyLimit: 20 }), false);
  assert.equal('dailyLimit' in PUBLIC_AUTHOR_PROJECTION, false);
});
