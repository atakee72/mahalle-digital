import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideBounceEvent } from './bounceRules';

const bounced = (type: string, to: unknown = ['A@b.de'], subType = 'General') => ({
  type: 'email.bounced', created_at: '2026-11-02T10:00:00.000Z',
  data: { to, bounce: { type, subType, message: 'x' } },
});

test('permanent bounce', () => {
  const a = decideBounceEvent(bounced('Permanent'));
  assert.deepEqual(a, { kind: 'bounce', addresses: ['a@b.de'], type: 'Permanent', subType: 'General', at: new Date('2026-11-02T10:00:00.000Z') });
});
test('docs sample (Suppressed)', () => {
  const a = decideBounceEvent({ type: 'email.bounced', created_at: '2024-11-22T23:41:12.126Z',
    data: { created_at: '2024-11-22T23:41:11.894719+00:00', email_id: 'x', from: 'Acme <a@acme.com>', to: ['delivered@resend.dev'], subject: 's',
      bounce: { message: 'm', subType: 'Suppressed', type: 'Permanent' } } });
  assert.equal(a.kind, 'bounce');
  if (a.kind === 'bounce') { assert.equal(a.subType, 'Suppressed'); assert.deepEqual(a.addresses, ['delivered@resend.dev']); }
});
test('transient and undetermined are ignored', () => {
  assert.equal(decideBounceEvent(bounced('Transient')).kind, 'ignore');
  assert.equal(decideBounceEvent(bounced('Undetermined')).kind, 'ignore');
});
test('complaint', () => {
  const a = decideBounceEvent({ type: 'email.complained', data: { to: ['X@y.de', 'x@y.de', ' '] } });
  assert.deepEqual(a, { kind: 'complaint', addresses: ['x@y.de'] });
});
test('other types ignored', () => {
  assert.equal(decideBounceEvent({ type: 'email.delivered', data: { to: ['a@b.de'] } }).kind, 'ignore');
});
test('malformed input ignored', () => {
  for (const b of [null, undefined, 'x', 3, {}, { type: 'email.bounced' }, { type: 'email.bounced', data: {} },
    bounced('Permanent', 'a@b.de'), bounced('Permanent', [1, null]), bounced('Permanent', []), { type: 'email.complained', data: { to: [] } }])
    assert.equal(decideBounceEvent(b).kind, 'ignore');
});
test('mixed entries keep strings only', () => {
  const a = decideBounceEvent(bounced('Permanent', ['a@b.de', 5]));
  assert.equal(a.kind, 'bounce');
  if (a.kind === 'bounce') assert.deepEqual(a.addresses, ['a@b.de']);
});
test('missing created_at falls back to now', () => {
  const a = decideBounceEvent({ type: 'email.bounced', data: { to: ['a@b.de'], bounce: { type: 'Permanent' } } });
  assert.equal(a.kind, 'bounce');
  if (a.kind === 'bounce') { assert.ok(a.at instanceof Date && !isNaN(+a.at)); assert.equal(a.subType, ''); }
});
