import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmailQuery, lookupEmail } from './emailLookup';

test('an address is recognised by an @ that is not the first character', () => {
  for (const q of ['a@b', 'name@example.org', '  x@y.de ']) assert.equal(isEmailQuery(q), true, q);
  for (const q of ['', 'petra', '@petra', ' @handle', '@']) assert.equal(isEmailQuery(q), false, q);
});

test('only a whole address is looked up; it is trimmed, never altered otherwise', () => {
  assert.equal(lookupEmail('  Name.Surname-5b@iCloud.com '), 'Name.Surname-5b@iCloud.com');
  assert.equal(lookupEmail('a@b.de'), 'a@b.de');
  for (const bad of ['a@b', 'a@b.', 'a@b.c', 'a b@c.de', 'a@@b.de', '@b.de', 'a@', '', `${'x'.repeat(250)}@b.de`, null, undefined, 5, { $ne: '' }, ['a@b.de']]) {
    assert.equal(lookupEmail(bad), null, String(bad));
  }
});
