// Run: npx tsx --test src/lib/mentions/mentionsResolve.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickMentionRecipients, resolveMentions } from './mentionsResolve';

const fakeDb = (users: Array<Record<string, any>>) => ({
  collection: () => ({
    find: (filter: any) => ({
      toArray: async () => users.filter((u) => filter.handle.$in.includes(u.handle) && u.anonymized !== true),
    }),
    findOne: async (filter: any, opts: any) => {
      assert.deepEqual(filter, { role: 'admin', anonymized: { $ne: true } });
      assert.deepEqual(opts?.sort, { _id: 1 });
      const admins = users.filter((u) => u.role === 'admin' && u.anonymized !== true).sort((a, b) => (a._id < b._id ? -1 : 1));
      return admins[0] ?? null;
    },
  }),
}) as any;

test('resolveMentions keeps text order, drops unknown and tombstoned handles', async () => {
  const db = fakeDb([
    { _id: 'u2', handle: 'emre_aydin' }, { _id: 'u1', handle: 'petra2' }, { _id: 'u9', handle: 'weg', anonymized: true },
  ]);
  assert.deepEqual(await resolveMentions(db, 'Hi @petra2, @niemand, @weg und @emre_aydin'), [
    { handle: 'petra2', userId: 'u1' }, { handle: 'emre_aydin', userId: 'u2' },
  ]);
});

test('no „@" in the text → no query at all', async () => {
  const db = { collection: () => { throw new Error('must not query'); } } as any;
  assert.deepEqual(await resolveMentions(db, 'ganz normaler Text'), []);
});

test('recipients: not the author, not skipped ids, not already notified, each once', () => {
  const mentions = [
    { handle: 'a', userId: 'author' }, { handle: 'b', userId: 'u1' }, { handle: 'c', userId: 'u2' },
    { handle: 'd', userId: 'u3' }, { handle: 'b', userId: 'u1' },
  ];
  assert.deepEqual(
    pickMentionRecipients({ mentions, actorId: 'author', skipUserIds: ['u2'], alreadyNotified: ['u3'] }),
    ['u1'],
  );
});

test('@admin resolves to the oldest admin account, in text order', async () => {
  const db = fakeDb([
    { _id: 'u5', handle: 'zweiter_admin', role: 'admin' }, { _id: 'u1', handle: 'atakee', role: 'admin' }, { _id: 'u2', handle: 'petra2' },
  ]);
  assert.deepEqual(await resolveMentions(db, 'Hi @petra2, @admin bitte schauen'), [
    { handle: 'petra2', userId: 'u2' }, { handle: 'admin', userId: 'u1' },
  ]);
});

test('a real member owning the handle „admin" wins over the alias', async () => {
  const db = fakeDb([{ _id: 'u7', handle: 'admin' }, { _id: 'u1', handle: 'atakee', role: 'admin' }]);
  assert.deepEqual(await resolveMentions(db, '@admin hallo'), [{ handle: 'admin', userId: 'u7' }]);
});

test('no admin account → @admin stays plain text', async () => {
  const db = fakeDb([{ _id: 'u2', handle: 'petra2' }]);
  assert.deepEqual(await resolveMentions(db, '@admin und @petra2'), [{ handle: 'petra2', userId: 'u2' }]);
});

test('@admin and the admin\'s own handle in one text → two refs, one recipient', async () => {
  const db = fakeDb([{ _id: 'u1', handle: 'atakee', role: 'admin' }]);
  const mentions = await resolveMentions(db, '@atakee oder @admin, egal');
  assert.deepEqual(mentions, [{ handle: 'atakee', userId: 'u1' }, { handle: 'admin', userId: 'u1' }]);
  assert.deepEqual(pickMentionRecipients({ mentions, actorId: 'x', alreadyNotified: [] }), ['u1']);
});
