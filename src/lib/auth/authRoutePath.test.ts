import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AUTH_CATCHALL_PATTERN, isUnknownAuthPath, shouldAnswerAuth404 } from './authRoutePath';

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

// Regression (2026-10-27 … 10-31): the path test alone matched the project's own `/api/auth/*`
// routes and the middleware answered registration, password reset and verification with 404.
test("the project's own /api/auth/* routes are never answered with 404", () => {
  const dir = fileURLToPath(new URL('../../pages/api/auth/', import.meta.url));
  const own = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => f.replace(/\.ts$/, ''));
  assert.ok(own.includes('register'), 'register.ts must exist');
  for (const name of own) {
    const pattern = `/api/auth/${name}`;
    assert.equal(shouldAnswerAuth404(pattern, pattern), false, name);
  }
});

test('only the auth-astro catch-all with an unknown action gets the 404', () => {
  assert.equal(shouldAnswerAuth404(AUTH_CATCHALL_PATTERN, '/api/auth/foo'), true);
  assert.equal(shouldAnswerAuth404(AUTH_CATCHALL_PATTERN, '/api/auth'), true);
  assert.equal(shouldAnswerAuth404(AUTH_CATCHALL_PATTERN, '/api/auth/session'), false);
  assert.equal(shouldAnswerAuth404(AUTH_CATCHALL_PATTERN, '/api/auth/callback/demo'), false);
  assert.equal(shouldAnswerAuth404('/api/auth/register', '/api/auth/register'), false);
  assert.equal(shouldAnswerAuth404(undefined, '/api/auth/foo'), false);
  assert.equal(shouldAnswerAuth404('/404', '/api/auth/foo'), false);
});
