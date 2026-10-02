// Run: npx tsx --test src/lib/auth/passwordRule.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAcceptablePassword, PASSWORD_MIN, PASSWORD_MAX } from './passwordRule';
import { ResetPasswordSchema } from '../../schemas/auth.schema';

test('accepts 8+ characters with lower, upper and digit', () => {
  assert.equal(isAcceptablePassword('Abcdefg1'), true);
  assert.equal(isAcceptablePassword('Sch1llerkiez!'), true);
});

test('refuses short, one-class and non-string input', () => {
  assert.equal(isAcceptablePassword('Abcde1'), false);        // 6 — the old server minimum
  assert.equal(isAcceptablePassword('Abcdef1'), false);       // 7
  assert.equal(isAcceptablePassword('abcdefg1'), false);      // no uppercase
  assert.equal(isAcceptablePassword('ABCDEFG1'), false);      // no lowercase
  assert.equal(isAcceptablePassword('Abcdefgh'), false);      // no digit
  assert.equal(isAcceptablePassword(''), false);
  assert.equal(isAcceptablePassword(undefined), false);
  assert.equal(isAcceptablePassword(12345678), false);
  assert.equal(isAcceptablePassword({ length: 12 }), false);
});

test('length bounds are inclusive', () => {
  assert.equal(PASSWORD_MIN, 8);
  assert.equal(PASSWORD_MAX, 100);
  assert.equal(isAcceptablePassword('Aa1' + 'x'.repeat(97)), true);   // 100
  assert.equal(isAcceptablePassword('Aa1' + 'x'.repeat(98)), false);  // 101
});

test('agrees with the reset-password schema on every sample', () => {
  const samples = ['Abcdefg1', 'Abcde1', 'abcdefg1', 'ABCDEFG1', 'Abcdefgh', '', 'Aa1' + 'x'.repeat(97), 'Aa1' + 'x'.repeat(98), 'Äbcdefg1', 'ÄÖÜäöü12'];
  for (const pw of samples) {
    const schemaOk = ResetPasswordSchema.safeParse({ token: 't', password: pw, confirmPassword: pw }).success;
    assert.equal(isAcceptablePassword(pw), schemaOk, `sample ${JSON.stringify(pw)}`);
  }
});
