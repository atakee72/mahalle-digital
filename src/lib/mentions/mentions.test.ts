// Run: npx tsx --test src/lib/mentions/mentions.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeMentionQuery, applyMention, extractMentionHandles, splitMentions } from './mentions';

test('handles are found, lowercased, unique, in order', () => {
  assert.deepEqual(extractMentionHandles('Hallo @Petra2 und @emre_aydin, nochmal @petra2!'), ['petra2', 'emre_aydin']);
});

test('e-mail addresses, URLs and glued text are not mentions', () => {
  assert.deepEqual(extractMentionHandles('mail petra@example.com'), []);
  assert.deepEqual(extractMentionHandles('https://social.example/@petra2'), []);
  assert.deepEqual(extractMentionHandles('abc@petra2 und @@petra2'), []);
  assert.deepEqual(extractMentionHandles('@pe ist zu kurz'), []);
  assert.deepEqual(extractMentionHandles('(@petra2) „@emre_aydin“'), ['petra2', 'emre_aydin']);
});

test('a handle followed by more handle characters is a different handle', () => {
  assert.deepEqual(extractMentionHandles('@petra2x'), ['petra2x']);
  assert.deepEqual(extractMentionHandles('@' + 'a'.repeat(21)), []);
});

test('the cap keeps the first N', () => {
  const text = Array.from({ length: 14 }, (_, i) => `@user_${i}`).join(' ');
  assert.equal(extractMentionHandles(text).length, 10);
  assert.equal(extractMentionHandles(text, 3).length, 3);
});

test('splitMentions links only resolved handles', () => {
  const segs = splitMentions('Frag @petra2 oder @niemand.', [{ handle: 'petra2', userId: 'u1' }]);
  assert.deepEqual(segs, [
    { type: 'text', value: 'Frag ' },
    { type: 'mention', value: 'petra2', userId: 'u1' },
    { type: 'text', value: ' oder @niemand.' },
  ]);
});

test('activeMentionQuery sees the token left of the caret', () => {
  assert.deepEqual(activeMentionQuery('Hallo @pe', 9), { start: 6, query: 'pe' });
  assert.deepEqual(activeMentionQuery('@', 1), { start: 0, query: '' });
  assert.equal(activeMentionQuery('Hallo @pe tra', 13), null);
  assert.equal(activeMentionQuery('mail@pe', 7), null);
  assert.equal(activeMentionQuery('Hallo', 5), null);
});

test('applyMention replaces the token and leaves one space', () => {
  assert.deepEqual(applyMention('Hallo @pe und', 6, 9, 'petra2'), { value: 'Hallo @petra2 und', caret: 14 });
  assert.deepEqual(applyMention('@pe', 0, 3, 'petra2'), { value: '@petra2 ', caret: 8 });
});
