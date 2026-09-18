import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareNewest, isSimultaneous, rankOf, relatedFor, type BeilagePost } from './beilage';

const post = (id: string, pubDateISO: string, tags: string[] = []): BeilagePost => ({
  id, title: id, description: '', pubDateISO, tags, layout: 'standard', minutes: 1,
});
const T = '2026-09-18T11:30:00.000Z';
// Deliberately shuffled input: the rule, not the input order, must decide.
const posts = [
  post('wahl2026-mende', T, ['wahl2026']),
  post('das-mahalle-manifest', '2026-08-01T00:00:00.000Z', ['manifest']),
  post('wahl2026-dehne', T, ['wahl2026']),
  post('gruendungsnachbarn-guide', '2026-08-25T00:00:00.000Z', ['guide']),
  post('wahl2026-lueders', T, ['wahl2026']),
  post('wahl2026-haghanipour', T, ['wahl2026']),
];

test('newest first; equal timestamps fall back to the file id A→Z (= surname order)', () => {
  assert.deepEqual([...posts].sort(compareNewest).map((p) => p.id), [
    'wahl2026-dehne', 'wahl2026-haghanipour', 'wahl2026-lueders', 'wahl2026-mende',
    'gruendungsnachbarn-guide', 'das-mahalle-manifest',
  ]);
});

test('the order does not depend on the input order', () => {
  const a = [...posts].sort(compareNewest).map((p) => p.id);
  const b = [...posts].reverse().sort(compareNewest).map((p) => p.id);
  assert.deepEqual(a, b);
});

test('№ n/N counts down the newest-first list without gaps or swaps', () => {
  const listed = [...posts].sort(compareNewest);
  assert.deepEqual(listed.map((p) => rankOf(p.id, posts).no), [6, 5, 4, 3, 2, 1]);
});

test('each simultaneous guest post relates to exactly the other three, in surname order', () => {
  assert.deepEqual(relatedFor('wahl2026-lueders', posts).map((r) => r.post.id),
    ['wahl2026-dehne', 'wahl2026-haghanipour', 'wahl2026-mende']);
});

test('posts published in the same second are "simultaneous"; ordinary posts are not', () => {
  assert.equal(isSimultaneous('wahl2026-dehne', posts), true);
  assert.equal(isSimultaneous('wahl2026-lueders', posts), true);
  assert.equal(isSimultaneous('gruendungsnachbarn-guide', posts), false);
  assert.equal(isSimultaneous('does-not-exist', posts), false);
});

test('a later editorial intro is NOT simultaneous, so it may take the lead card', () => {
  const withIntro = [...posts, post('wahl2026-einleitung', '2026-09-18T12:00:00.000Z', ['wahl2026'])];
  assert.equal(isSimultaneous('wahl2026-einleitung', withIntro), false);
  assert.equal([...withIntro].sort(compareNewest)[0].id, 'wahl2026-einleitung');
});
