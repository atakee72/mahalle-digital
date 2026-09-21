// Run: npx tsx --test src/lib/profile/handleChoice.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chosenHandleProblem, normalizeChosenHandle, RESERVED_HANDLES, HANDLE_FALLBACK } from './handle';

test('normalising strips one leading @, trims and lowercases', () => {
  assert.equal(normalizeChosenHandle('  @Petra_M '), 'petra_m');
  assert.equal(normalizeChosenHandle('@@petra'), '@petra');
  assert.equal(normalizeChosenHandle(undefined), '');
});

test('format: a-z 0-9 _ and 3–20 characters', () => {
  assert.equal(chosenHandleProblem('petra_m'), null);
  for (const h of ['pe', 'x'.repeat(21), 'petra-m', 'pétra', 'petra m', '@petra'])
    assert.equal(chosenHandleProblem(h), 'format', h);
});

test('reserved: team words, mention keywords, lookalikes', () => {
  for (const h of ['admin', 'adm1n', 'mahalle', 'mahalle_team', 'moderation', 'team', 'alle', 'everyone', 'here', 'kiez'])
    assert.equal(chosenHandleProblem(h), 'reserved', h);
  assert.equal(chosenHandleProblem('teamgeist'), null);
});

test('the automatic fallback is never reserved', () => {
  assert.equal(RESERVED_HANDLES.has(HANDLE_FALLBACK), false);
  assert.equal(chosenHandleProblem(HANDLE_FALLBACK), null);
});
