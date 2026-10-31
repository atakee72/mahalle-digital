import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubUrl } from './scrubUrl';

test('query string and fragment are dropped (single-use tokens ride there)', () => {
  assert.equal(scrubUrl('https://mahalle.digital/reset-password?token=abc123#x'), 'https://mahalle.digital/reset-password');
  assert.equal(scrubUrl('https://mahalle.digital/login?redirect=%2Fforum'), 'https://mahalle.digital/login');
});
test('a bare url and odd inputs pass through unharmed', () => {
  assert.equal(scrubUrl('https://mahalle.digital/forum'), 'https://mahalle.digital/forum');
  assert.equal(scrubUrl(undefined), undefined);
  assert.equal(scrubUrl('not a url?x=1'), 'not a url');
});
