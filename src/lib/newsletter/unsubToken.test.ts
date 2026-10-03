import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUnsubToken, verifyUnsubToken } from './unsubToken';

const ID = '6abfe378539f08486ac89c2a';
const SECRET = 'test-secret-not-a-real-one';

test('a token round-trips to its user id', () => {
  const t = makeUnsubToken(ID, SECRET);
  assert.match(t, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(verifyUnsubToken(t, SECRET), ID);
});

test('a token is bound to the secret and to the user id', () => {
  const t = makeUnsubToken(ID, SECRET);
  assert.equal(verifyUnsubToken(t, 'other-secret'), null);
  const other = makeUnsubToken('6abfe378539f08486ac89c2b', SECRET);
  const swapped = t.split('.')[0] + '.' + other.split('.')[1];
  assert.equal(verifyUnsubToken(swapped, SECRET), null);
});

test('garbage is refused without throwing', () => {
  for (const bad of [null, undefined, 42, '', '.', 'abc', 'abc.', '.abc', 'not-hex.sig', Buffer.from('zz').toString('base64url') + '.x']) {
    assert.equal(verifyUnsubToken(bad, SECRET), null);
  }
  assert.equal(verifyUnsubToken(makeUnsubToken(ID, SECRET), ''), null);
  assert.throws(() => makeUnsubToken('', SECRET));
});
