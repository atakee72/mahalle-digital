// src/utils/cloudinary.test.ts
// Run: npx tsx --test src/utils/cloudinary.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudinaryFit, optimizeCloudinary } from './cloudinary';

const RAW = 'https://res.cloudinary.com/demo/image/upload/v123/mahalle/listings/abc.jpg';

test('cloudinaryFit injects auto format, auto quality and a width fill after /upload/', () => {
  assert.equal(cloudinaryFit(RAW, 480), 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_480,c_fill/v123/mahalle/listings/abc.jpg');
});

test('cloudinaryFit is a no-op for non-Cloudinary URLs and empty input', () => {
  assert.equal(cloudinaryFit('https://example.org/a.jpg', 480), 'https://example.org/a.jpg');
  assert.equal(cloudinaryFit('', 480), '');
  assert.equal(cloudinaryFit(null, 480), '');
  assert.equal(cloudinaryFit(undefined, 480), '');
});

test('cloudinaryFit does not double up on an already optimized URL', () => {
  const once = optimizeCloudinary(RAW);
  assert.equal(cloudinaryFit(once, 480), 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_480,c_fill/v123/mahalle/listings/abc.jpg');
  assert.equal(cloudinaryFit(cloudinaryFit(RAW, 480), 480), cloudinaryFit(RAW, 480));
});
