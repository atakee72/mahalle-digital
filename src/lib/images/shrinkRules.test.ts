import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planShrink, nextAttempt, uploadFileName } from './shrinkRules';

test('pass: small jpeg that fits', () => {
  assert.deepEqual(planShrink({ width: 1200, height: 900, bytes: 800_000, type: 'image/jpeg' }), { action: 'pass' });
});
test('encode: too many bytes', () => {
  assert.deepEqual(planShrink({ width: 4000, height: 3000, bytes: 6 * 1024 * 1024, type: 'image/jpeg' }), { action: 'encode', width: 1600, height: 1200, quality: 0.85 });
});
test('encode: edge too big although bytes small', () => {
  assert.deepEqual(planShrink({ width: 2400, height: 1800, bytes: 900_000, type: 'image/jpeg' }), { action: 'encode', width: 1600, height: 1200, quality: 0.85 });
});
test('encode: foreign type', () => {
  assert.deepEqual(planShrink({ width: 800, height: 600, bytes: 500_000, type: 'image/gif' }), { action: 'encode', width: 800, height: 600, quality: 0.85 });
});
test('portrait rounding', () => {
  assert.deepEqual(planShrink({ width: 3000, height: 4000, bytes: 5_000_000, type: 'image/jpeg' }), { action: 'encode', width: 1200, height: 1600, quality: 0.85 });
});
test('ladder', () => {
  const a = nextAttempt({ width: 1600, height: 1200, quality: 0.85 });
  assert.deepEqual(a, { width: 1600, height: 1200, quality: 0.7 });
  const b = nextAttempt(a!);
  assert.deepEqual(b, { width: 1280, height: 960, quality: 0.7 });
  const c = nextAttempt(b!);
  assert.deepEqual(c, { width: 1024, height: 768, quality: 0.7 });
  assert.equal(nextAttempt(c!), null);
});
test('tiny image: q0.7 then null', () => {
  const a = nextAttempt({ width: 400, height: 300, quality: 0.85 });
  assert.deepEqual(a, { width: 400, height: 300, quality: 0.7 });
  assert.equal(nextAttempt(a!), null);
});
test('uploadFileName', () => {
  assert.equal(uploadFileName('IMG_0001.HEIC'), 'IMG_0001.jpg');
  assert.equal(uploadFileName('photo'), 'photo.jpg');
  assert.equal(uploadFileName('a.b.png'), 'a.b.jpg');
});
