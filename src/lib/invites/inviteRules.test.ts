import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INVITE_USES, INVITE_CODE_LEN, INVITE_CODE_ALPHABET,
  normalizeInviteCode, codeFromBytes, inviterBlock, inviteUnlockAt, inviteBudget, inviteUrl, inviteMailto,
} from './inviteRules';

const NOW = new Date('2026-10-07T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const fresh = { emailVerified: true, createdAt: days(30).toISOString() };

test('normalizeInviteCode: trims, lowercases, fixed length, lower alnum only', () => {
  assert.equal(normalizeInviteCode(' ABCDEFGH23 '), 'abcdefgh23');
  assert.equal(normalizeInviteCode('abcdefgh2'), null);
  assert.equal(normalizeInviteCode('abcdefgh234'), null);
  assert.equal(normalizeInviteCode('abcdefgh-3'), null);
  assert.equal(normalizeInviteCode(''), null);
  assert.equal(normalizeInviteCode(42), null);
  assert.equal(normalizeInviteCode(null), null);
});

test('codeFromBytes: length, alphabet, no look-alikes, deterministic', () => {
  const code = codeFromBytes(Array.from({ length: INVITE_CODE_LEN }, (_, i) => i * 37));
  assert.equal(code.length, INVITE_CODE_LEN);
  for (const ch of code) assert.ok(INVITE_CODE_ALPHABET.includes(ch), ch);
  assert.ok(!/[ilo01]/.test(INVITE_CODE_ALPHABET));
  assert.equal(normalizeInviteCode(code), code);
  assert.equal(codeFromBytes([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'aaaaaaaaaa');
});

test('inviterBlock: eligible member', () => {
  assert.equal(inviterBlock(fresh, NOW), null);
  assert.equal(inviterBlock({ ...fresh, createdAt: days(30) }, NOW), null);
});

test('inviterBlock: reasons and their order', () => {
  assert.equal(inviterBlock({ ...fresh, anonymized: true, isBanned: true }, NOW), 'anonymized');
  assert.equal(inviterBlock({ ...fresh, isBanned: true, invitesPaused: true }, NOW, true), 'banned');
  assert.equal(inviterBlock({ ...fresh, invitesPaused: true }, NOW, true), 'paused_all');
  assert.equal(inviterBlock({ ...fresh, invitesPaused: true, emailVerified: false }, NOW), 'paused');
  assert.equal(inviterBlock({ ...fresh, emailVerified: false, createdAt: days(1) }, NOW), 'unverified');
  assert.equal(inviterBlock({ emailVerified: true, createdAt: days(6.9) }, NOW), 'too_new');
  assert.equal(inviterBlock({ emailVerified: true, createdAt: days(7) }, NOW), null);
  assert.equal(inviterBlock({ emailVerified: true }, NOW), 'too_new');
  assert.equal(inviterBlock({ emailVerified: true, createdAt: 'garbage' }, NOW), 'too_new');
});

test('inviteUnlockAt: seven days after joining, null for unreadable dates', () => {
  assert.equal(inviteUnlockAt(days(3))?.toISOString(), days(-4).toISOString());
  assert.equal(inviteUnlockAt('no date'), null);
  assert.equal(inviteUnlockAt(undefined), null);
});

test('inviteBudget: counts only the rolling window', () => {
  assert.deepEqual(inviteBudget([], NOW), { used: 0, left: INVITE_USES, nextFreeAt: null });
  const b = inviteBudget([days(31), days(29), days(1), 'garbage', undefined], NOW);
  assert.equal(b.used, 2);
  assert.equal(b.left, 3);
  assert.equal(b.nextFreeAt, null);
});

test('inviteBudget: exhausted → next free when the oldest in-window redemption falls out', () => {
  const b = inviteBudget([days(2), days(20), days(5), days(10), days(29.5)], NOW);
  assert.equal(b.used, 5);
  assert.equal(b.left, 0);
  assert.equal(b.nextFreeAt?.toISOString(), days(-0.5).toISOString());
});

test('inviteBudget: more than the cap never reports a negative rest', () => {
  const b = inviteBudget([1, 2, 3, 4, 5, 6].map(days), NOW);
  assert.equal(b.left, 0);
  assert.equal(b.used, INVITE_USES);
  assert.equal(b.nextFreeAt?.toISOString(), days(-25).toISOString());
});

test('inviteBudget: a redemption dated in the future is not counted', () => {
  assert.equal(inviteBudget([days(-1)], NOW).used, 0);
});

test('inviteUrl: base with or without trailing slash', () => {
  assert.equal(inviteUrl('https://mahalle.digital', 'abcdefgh23'), 'https://mahalle.digital/register?invite=abcdefgh23');
  assert.equal(inviteUrl('http://127.0.0.1:4655/', 'abcdefgh23'), 'http://127.0.0.1:4655/register?invite=abcdefgh23');
});

test('inviteMailto: percent-encoded, CRLF line ends, no recipient', () => {
  const href = inviteMailto('Einladung zu Mahalle', 'Hallo,\n\nhier: https://x.y/register?invite=a&b\nGrüße');
  assert.ok(href.startsWith('mailto:?subject=Einladung%20zu%20Mahalle&body='));
  assert.ok(href.includes('%0D%0A%0D%0A'));
  assert.ok(href.includes('invite%3Da%26b'));
  assert.ok(!href.includes('\n'));
  assert.ok(href.includes('Gr%C3%BC%C3%9Fe'));
});
