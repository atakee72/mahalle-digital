import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectWithRetry, isColdStartConnectError } from './mongoRetry';

const err = (name: string, message = 'x') => Object.assign(new Error(message), { name });

test('a healthy connect is returned as is, one attempt', async () => {
  let calls = 0;
  assert.equal(await connectWithRetry(async () => { calls++; return 'client'; }), 'client');
  assert.equal(calls, 1);
});

test('a cold-start server-selection timeout is retried ONCE with a fresh attempt, and succeeds', async () => {
  let calls = 0;
  const got = await connectWithRetry(async () => { calls++; if (calls === 1) throw err('MongoServerSelectionError', 'Server selection timed out after 10000 ms'); return 'fresh client'; });
  assert.equal(got, 'fresh client');
  assert.equal(calls, 2);
});

test('a real outage still fails — after exactly two attempts, with the LAST error', async () => {
  let calls = 0;
  await assert.rejects(
    connectWithRetry(async () => { calls++; throw err('MongoServerSelectionError', `attempt ${calls}`); }),
    (e: Error) => e.name === 'MongoServerSelectionError' && e.message === 'attempt 2'
  );
  assert.equal(calls, 2);
});

test('anything that is not a connection problem is never retried', async () => {
  let calls = 0;
  await assert.rejects(connectWithRetry(async () => { calls++; throw err('MongoServerError', 'bad auth'); }), /bad auth/);
  assert.equal(calls, 1);
});

test('which errors count as a cold-start connect problem', () => {
  for (const n of ['MongoServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError']) assert.equal(isColdStartConnectError(err(n)), true);
  for (const n of ['MongoServerError', 'MongoParseError', 'TypeError', 'Error']) assert.equal(isColdStartConnectError(err(n)), false);
  assert.equal(isColdStartConnectError('a string'), false);
  assert.equal(isColdStartConnectError(null), false);
});
