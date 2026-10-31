// Run: npx tsx --test src/lib/listingModerationText.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listingModerationText } from './listingModerationText';

test('rendered description and differing plain text are both included', () => {
  assert.equal(listingModerationText('T', 'rendered', 'plain'), 'T\n\nrendered\n\nplain');
});
test('equal texts are sent once; a non-string description falls back to the plain text', () => {
  assert.equal(listingModerationText('T', 'same', 'same'), 'T\n\nsame');
  assert.equal(listingModerationText('T', { type: 'doc' }, 'plain'), 'T\n\nplain');
});
