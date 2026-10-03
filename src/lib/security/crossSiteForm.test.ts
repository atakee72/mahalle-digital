import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCrossSiteForm, CROSS_SITE_FORM_EXEMPT } from './crossSiteForm';

const site = 'https://mahalle.digital';
const base = { method: 'POST', pathname: '/api/profile/newsletter', siteOrigin: site };

test('safe methods and same-origin requests pass', () => {
  assert.equal(isCrossSiteForm({ ...base, method: 'GET', origin: null, contentType: null }), false);
  assert.equal(isCrossSiteForm({ ...base, origin: site, contentType: 'application/x-www-form-urlencoded' }), false);
  assert.equal(isCrossSiteForm({ ...base, origin: site, contentType: null }), false);
});

test('a foreign form POST is refused, like Astro did', () => {
  assert.equal(isCrossSiteForm({ ...base, origin: 'https://evil.example', contentType: 'application/x-www-form-urlencoded' }), true);
  assert.equal(isCrossSiteForm({ ...base, origin: null, contentType: 'multipart/form-data; boundary=x' }), true);
  assert.equal(isCrossSiteForm({ ...base, origin: null, contentType: 'Text/Plain' }), true);
  assert.equal(isCrossSiteForm({ ...base, origin: null, contentType: null }), true);
});

test('a JSON POST without Origin passes (the cron routes with a Bearer header)', () => {
  assert.equal(isCrossSiteForm({ ...base, pathname: '/api/cron/kiez-brief', origin: null, contentType: 'application/json' }), false);
});

test('the one-click unsubscribe endpoint is exempt — and only it', () => {
  assert.deepEqual([...CROSS_SITE_FORM_EXEMPT], ['/api/newsletter/unsubscribe']);
  assert.equal(isCrossSiteForm({ ...base, pathname: '/api/newsletter/unsubscribe', origin: null, contentType: 'application/x-www-form-urlencoded' }), false);
  assert.equal(isCrossSiteForm({ ...base, pathname: '/api/newsletter/unsubscribe/', origin: null, contentType: 'application/x-www-form-urlencoded' }), true);
});
