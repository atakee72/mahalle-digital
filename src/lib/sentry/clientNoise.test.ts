import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isClientNoise } from './clientNoise';

// Exact strings from the prod board (2026-09-02 … 2026-09-20).
test('view-transition cancellations are noise, in every wording seen', () => {
  assert.equal(isClientNoise('InvalidStateError', 'Skipped ViewTransition due to document being hidden'), true);
  assert.equal(isClientNoise('Error', 'InvalidStateError: Transition was aborted because of invalid state. Document hidden'), true);
  assert.equal(isClientNoise('InvalidStateError', 'Transition was aborted because of invalid state'), true);
  assert.equal(isClientNoise('AbortError', 'Transition was skipped'), true);
  assert.equal(isClientNoise('AbortError', 'The user aborted a request.'), true);
});

test('React falling back to client rendering after an early update is noise', () => {
  assert.equal(isClientNoise('Error', 'This root received an early update, before anything was able hydrate. Switched the entire root to client rendering.'), true);
});

test('the page-swap null read is noise ONLY when it comes from Astro\'s ClientRouter', () => {
  const msg = "Cannot read properties of null (reading 'body')";
  assert.equal(isClientNoise('TypeError', msg, ['/_astro/ClientRouter.astro_astro_type_script_index_0_lang.DQnP-Fov.js']), true);
  assert.equal(isClientNoise('TypeError', msg, ['/_astro/ForumIndexInner.B1x.js']), false, 'the same message from OUR code is a real bug');
  assert.equal(isClientNoise('TypeError', msg), false);
});

test('real errors pass', () => {
  assert.equal(isClientNoise('TypeError', "Cannot read properties of undefined (reading 'map')", ['/_astro/ForumIndexInner.B1x.js']), false);
  assert.equal(isClientNoise('Error', 'Failed to fetch'), false);
  assert.equal(isClientNoise('InvalidStateError', 'The object is in an invalid state.'), false, 'an InvalidStateError that is NOT about transitions stays visible');
  assert.equal(isClientNoise('ReferenceError', 'x is not defined'), false);
  assert.equal(isClientNoise(undefined, undefined), false);
});
