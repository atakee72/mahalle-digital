import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailFragment, escapeRegex } from './emailLookup';

test('a lookup starts at three characters, while the admin is still typing', () => {
  assert.equal(emailFragment('zit'), 'zit');
  assert.equal(emailFragment('  zitadelle.lieber '), 'zitadelle.lieber');
  assert.equal(emailFragment('Name-5b@iCloud.com'), 'Name-5b@iCloud.com');
  assert.equal(emailFragment('lieber@'), 'lieber@');
  for (const bad of ['', 'a', 'ab', '@petra', ' @handle', 'two words', `${'x'.repeat(255)}`, null, undefined, 5, { $ne: '' }, ['abc']]) {
    assert.equal(emailFragment(bad), null, String(bad));
  }
});

test('the fragment is matched literally: every regex character is escaped', () => {
  assert.equal(escapeRegex('a.b+c'), 'a\\.b\\+c');
  assert.equal(escapeRegex('.*'), '\\.\\*');
  assert.equal(escapeRegex('(x)|[y]{2}^$\\'), '\\(x\\)\\|\\[y\\]\\{2\\}\\^\\$\\\\');
  assert.equal(new RegExp(escapeRegex('.*'), 'i').test('anyone@example.org'), false);
  assert.equal(new RegExp(escapeRegex('Ne.so'), 'i').test('anne.sommer@example.org'), true);
});
