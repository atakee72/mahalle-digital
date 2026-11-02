import test from 'node:test';
import assert from 'node:assert/strict';
import { reusableTranslation } from './client';

test('a cached translation in the same language is reused', () => {
  const cache = { title: 'Hello', body: 'World', lang: 'en' };
  assert.equal(reusableTranslation(cache, 'en'), cache);
});

test('a cached translation in another language is not reused', () => {
  assert.equal(reusableTranslation({ title: 'Hallo', body: 'Welt', lang: 'de' }, 'en'), null);
});

test('no cache, nothing to reuse', () => {
  assert.equal(reusableTranslation(null, 'en'), null);
});
