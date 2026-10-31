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

import { scrubBreadcrumb, scrubRequest } from './scrubUrl';

test('breadcrumb urls (navigation from/to, fetch url) lose their query', () => {
  const b = scrubBreadcrumb({ category: 'navigation', data: { from: '/login?redirect=%2Fcalendar', to: '/reset-password?token=abc' } });
  assert.deepEqual(b.data, { from: '/login', to: '/reset-password' });
  const f = scrubBreadcrumb({ category: 'fetch', data: { url: 'https://x.test/api/auth/verify-email?token=abc', method: 'POST', status_code: 404 } });
  assert.deepEqual(f.data, { url: 'https://x.test/api/auth/verify-email', method: 'POST', status_code: 404 });
  const plain = { category: 'console', message: 'x' } as { category: string; message: string; data?: Record<string, any> };
  assert.deepEqual(scrubBreadcrumb(plain), { category: 'console', message: 'x' });
});

test('request: url scrubbed, query_string and referer dropped, other headers kept', () => {
  const r = scrubRequest({ url: 'https://x.test/reset-password?token=abc', query_string: 'token=abc', headers: { Referer: 'https://x.test/login?redirect=%2Fforum', 'User-Agent': 'ua' } });
  assert.deepEqual(r, { url: 'https://x.test/reset-password', headers: { 'User-Agent': 'ua' } });
  assert.equal(scrubRequest(undefined), undefined);
});

test('Node SDK breadcrumb shape: http.query and http.fragment are dropped', () => {
  const b = scrubBreadcrumb({ category: 'http', data: { url: 'https://x.test/reset-password', 'http.method': 'GET', 'http.query': '?token=abc', 'http.fragment': '#x', status_code: 200 } });
  assert.deepEqual(b.data, { url: 'https://x.test/reset-password', 'http.method': 'GET', status_code: 200 });
});
