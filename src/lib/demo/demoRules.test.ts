import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dbNameFromUri, isDemoEnabled, decideDemoRequest } from './demoRules';

test('db name comes from the URI path', () => {
  assert.equal(dbNameFromUri('mongodb+srv://u:p@host/mahalle-dev-demo?retryWrites=true'), 'mahalle-dev-demo');
  assert.equal(dbNameFromUri(undefined), '');
  assert.equal(dbNameFromUri('not a uri'), '');
});
test('flag + dev-named database enables', () => {
  assert.equal(isDemoEnabled({ demoMode: '1', dbName: 'mahalle-dev-demo' }), true);
});
test('prod database name disables the flag', () => {
  assert.equal(isDemoEnabled({ demoMode: '1', dbName: 'mahalle' }), false);
});
test('no flag disables', () => {
  assert.equal(isDemoEnabled({ demoMode: undefined, dbName: 'mahalle-dev-demo' }), false);
  assert.equal(isDemoEnabled({ demoMode: 'true', dbName: 'mahalle-dev-demo' }), false);
});
test('safe methods pass everywhere', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(decideDemoRequest({ method, pathname: '/api/topics', demoSession: true }), 'allow');
    assert.equal(decideDemoRequest({ method, pathname: '/forum', demoSession: false }), 'allow');
  }
});
test('only the three auth writes pass', () => {
  for (const p of ['/api/auth/csrf', '/api/auth/callback/demo', '/api/auth/signout']) {
    assert.equal(decideDemoRequest({ method: 'POST', pathname: p, demoSession: false }), 'allow');
  }
  for (const p of ['/api/auth/callback/credentials', '/api/auth/register', '/api/topics/create', '/api/listings/abc/contact', '/api/translate', '/api/newsletter/unsubscribe', '/api/profile/tour', '/kontakt']) {
    assert.equal(decideDemoRequest({ method: 'POST', pathname: p, demoSession: true }), 'refuse', p);
    assert.equal(decideDemoRequest({ method: 'POST', pathname: p, demoSession: false }), 'refuse', p);
  }
  assert.equal(decideDemoRequest({ method: 'PATCH', pathname: '/api/admin/users/abc', demoSession: true }), 'refuse');
  assert.equal(decideDemoRequest({ method: 'DELETE', pathname: '/api/topics/abc', demoSession: true }), 'refuse');
});
test('allowed writes are exact paths, not prefixes', () => {
  assert.equal(decideDemoRequest({ method: 'POST', pathname: '/api/auth/signout/x', demoSession: false }), 'refuse');
  assert.equal(decideDemoRequest({ method: 'POST', pathname: '/api/auth/csrf?x=1', demoSession: false }), 'refuse');
});
test('blocked reads survive path spelling variants', () => {
  for (const p of ['/api/admin/errors/', '//api/admin/errors', '/api/admin//errors', '/api/admin/errors/anything']) {
    assert.equal(decideDemoRequest({ method: 'GET', pathname: p, demoSession: true }), 'refuse', p);
  }
  assert.equal(decideDemoRequest({ method: 'GET', pathname: '/api/admin/errorsx', demoSession: true }), 'allow');
});
test('blocked reads need a demo session', () => {
  assert.equal(decideDemoRequest({ method: 'GET', pathname: '/api/admin/errors', demoSession: true }), 'refuse');
  assert.equal(decideDemoRequest({ method: 'GET', pathname: '/api/admin/errors', demoSession: false }), 'allow');
});
