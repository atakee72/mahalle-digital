// Run: npx tsx --test src/lib/profile/nameRules.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDisplayName, isValidDisplayName } from './nameRules';

test('cleaning trims, collapses whitespace and strips invisible characters', () => {
  assert.equal(cleanDisplayName('  Petra   M. '), 'Petra M.');
  assert.equal(cleanDisplayName('Pe​tra'), 'Petra');          // zero-width space
  assert.equal(cleanDisplayName('Petra‮nimda'), 'Petranimda'); // RTL override
  assert.equal(cleanDisplayName('Anna\nMaria'), 'Anna Maria');
  assert.equal(cleanDisplayName(42), '');
});

test('names real neighbours use are valid', () => {
  for (const n of ['Jo', 'Petra M.', "O'Neill", 'Jean-Luc', 'Emre Aydın', 'Müller_73', 'Ömer', 'Зоя', 'STK Schillerpromenade/Neukölln'])
    assert.equal(isValidDisplayName(n), true, n);
});

test('too short, too long, emoji, leading punctuation and markup are refused', () => {
  for (const n of ['J', 'x'.repeat(31), 'Petra 🌻', '.Petra', '-Petra', '/Petra', 'Petra/', '<b>Petra</b>', 'Petra@home', ''])
    assert.equal(isValidDisplayName(n), false, n);
});

import { foldForCompare, isProtectedName, sameNameFolded } from './nameRules';

test('folding removes case, accents, lookalikes and leetspeak', () => {
  assert.equal(foldForCompare('Ádmin'), foldForCompare('admin'));
  assert.equal(foldForCompare('аdmin'), foldForCompare('admin')); // Cyrillic а
  assert.equal(foldForCompare('adm1n'), foldForCompare('admin'));
  assert.equal(foldForCompare('MAHALLE'), foldForCompare('mahalle'));
});

test('team and official lookalikes are protected', () => {
  for (const n of ['Admin', 'аdmin', 'Adm1n', 'Administrator', 'Mahalle', 'Mahalle Team', 'M a h a l l e',
                   'mahalle.digital', 'Moderation', 'Moderator', 'Team', 'Kiez Team', 'Support', 'Offiziell', 'Official'])
    assert.equal(isProtectedName(n), true, n);
});

test('ordinary names that merely contain the letters are not protected', () => {
  for (const n of ['Petra', 'Badminton Berlin', 'Teamgeist', 'Steamer', 'Modesta', 'Supporta', 'Emre Aydın'])
    assert.equal(isProtectedName(n), false, n);
});

test('sameNameFolded ignores case, accents, separators and lookalikes', () => {
  assert.equal(sameNameFolded('Ercan Atak', 'ercan_atak'), true);
  assert.equal(sameNameFolded('Ercan Atak', 'Еrcan  Atаk'), true); // Cyrillic Е, а
  assert.equal(sameNameFolded('Ercan Atak', 'Ercan Atay'), false);
});
