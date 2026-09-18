import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareNewest, isSimultaneous, rankOf, relatedFor, relatedSlots, type BeilagePost } from './beilage';

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

test('related rail never drops a member of a simultaneous group — candidates AND the intro', () => {
  const all = [...posts, post('wahl2026-einladung', '2026-09-18T12:00:00.000Z', ['wahl2026'])];
  const rail = (id: string) => relatedFor(id, all, relatedSlots(id, all)).map((r) => r.post.id);
  assert.deepEqual(rail('wahl2026-dehne'), ['wahl2026-einladung', 'wahl2026-haghanipour', 'wahl2026-lueders', 'wahl2026-mende']);
  assert.deepEqual(rail('wahl2026-mende'), ['wahl2026-einladung', 'wahl2026-dehne', 'wahl2026-haghanipour', 'wahl2026-lueders']);
  assert.deepEqual(rail('wahl2026-einladung'), ['wahl2026-dehne', 'wahl2026-haghanipour', 'wahl2026-lueders', 'wahl2026-mende']);
});

test('ordinary posts keep three related slots', () => {
  assert.equal(relatedSlots('gruendungsnachbarn-guide', posts), 3);
  assert.equal(relatedSlots('does-not-exist', posts), 3);
});

// A guest post that arrives LATER keeps its true publication date but joins its
// group for ordering (2026-09-19: a successor candidate's post, a day after the others).
const LATE = '2026-09-18T23:00:00.000Z';
const withLate = [
  ...posts,
  post('wahl2026-einladung', '2026-09-18T12:00:00.000Z', ['wahl2026']),
  { ...post('wahl2026-hempel', LATE, ['wahl2026']), sortISO: T },
];

test('a late post with a sort date lines up inside its group, by surname — not on top as the newest', () => {
  assert.deepEqual([...withLate].sort(compareNewest).map((p) => p.id).slice(0, 6), [
    'wahl2026-einladung', 'wahl2026-dehne', 'wahl2026-haghanipour', 'wahl2026-hempel', 'wahl2026-lueders', 'wahl2026-mende',
  ]);
});

test('the late post counts as simultaneous with its group (no lead card, equal strip) and keeps its own date', () => {
  assert.equal(isSimultaneous('wahl2026-hempel', withLate), true);
  assert.equal(isSimultaneous('wahl2026-dehne', withLate), true);
  assert.equal(withLate.find((p) => p.id === 'wahl2026-hempel')!.pubDateISO, LATE);
});

test('№ n/N and the related rail follow the same order', () => {
  assert.equal(relatedSlots('wahl2026-hempel', withLate), 5);
  assert.deepEqual(relatedFor('wahl2026-dehne', withLate, relatedSlots('wahl2026-dehne', withLate)).map((r) => r.post.id).slice(0, 5), [
    'wahl2026-einladung', 'wahl2026-haghanipour', 'wahl2026-hempel', 'wahl2026-lueders', 'wahl2026-mende',
  ]);
});
