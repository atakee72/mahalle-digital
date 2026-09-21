// Run: npx tsx --test src/lib/mentions/mentionsResolve.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickMentionRecipients, resolveMentions } from './mentionsResolve';

const fakeDb = (users: Array<Record<string, any>>) => ({
  collection: () => ({
    find: (filter: any) => ({
      toArray: async () => users.filter((u) => filter.handle.$in.includes(u.handle) && u.anonymized !== true),
    }),
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
