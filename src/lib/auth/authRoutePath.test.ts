import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnknownAuthPath } from './authRoutePath';

test('known Auth.js actions are not flagged', () => {
  for (const p of [
    '/api/auth/session',
    '/api/auth/csrf',
    '/api/auth/providers',
    '/api/auth/signin/credentials',
    '/api/auth/callback/demo',
    '/api/auth/callback/credentials',
    '/api/auth/signout',
    '/api/auth/verify-request',
    '/api/auth/error?error=CredentialsSignin'.split('?')[0],
  ]) assert.equal(isUnknownAuthPath(p), false, p);
});

test('paths auth-astro would answer with undefined are flagged', () => {
  for (const p of ['/api/auth', '/api/auth/', '/api/auth//session', '/api/auth/demo', '/api/auth/.env', '/api/auth/sessions']) {
    assert.equal(isUnknownAuthPath(p), true, p);
  }
});

test('paths outside the prefix are never flagged', () => {
  for (const p of ['/', '/api/authors', '/api/auth-x', '/login', '/api/news/fetch-daily']) {
    assert.equal(isUnknownAuthPath(p), false, p);
  }
});
