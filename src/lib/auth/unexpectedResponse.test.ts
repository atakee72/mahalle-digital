import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnexpectedAuthResponse } from './unexpectedResponse';

const json = 'application/json; charset=utf-8';
test('expected form vocabulary is not reported', () => {
  for (const status of [200, 400, 401, 403, 409, 429]) assert.equal(isUnexpectedAuthResponse({ status, contentType: json, online: true }), false, String(status));
});
test('404, 5xx, HTML instead of JSON, odd statuses are reported', () => {
  assert.equal(isUnexpectedAuthResponse({ status: 404, contentType: 'text/html', online: true }), true);
  assert.equal(isUnexpectedAuthResponse({ status: 500, contentType: json, online: true }), true);
  assert.equal(isUnexpectedAuthResponse({ status: 400, contentType: 'text/html', online: true }), true);
  assert.equal(isUnexpectedAuthResponse({ status: 200, contentType: null, online: true }), true);
  assert.equal(isUnexpectedAuthResponse({ status: 405, contentType: json, online: true }), true);
});
test('a failed request is reported only while online', () => {
  assert.equal(isUnexpectedAuthResponse({ status: 0, contentType: null, online: true }), true);
  assert.equal(isUnexpectedAuthResponse({ status: 0, contentType: null, online: false }), false);
});
