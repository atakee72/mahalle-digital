// Unit tests for the forum post-kind helper. Run directly:
//   npx tsx src/lib/forum/postKind.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POST_COLLECTIONS, isPostCollection, collectionForKind, kindForCollection,
  contentTypeForCollection, hrefForPost, buildMovedDoc,
  createEndpointForKind, createdDocKeyForKind,
} from './postKind';

test('kind ↔ collection round-trips for all three kinds', () => {
  for (const c of POST_COLLECTIONS) {
    assert.equal(collectionForKind(kindForCollection(c)), c);
  }
  assert.equal(collectionForKind('discussion'), 'topics');
  assert.equal(collectionForKind('announcement'), 'announcements');
  assert.equal(collectionForKind('recommendation'), 'recommendations');
});

test('contentType and href per collection', () => {
  assert.equal(contentTypeForCollection('topics'), 'topic');
  assert.equal(contentTypeForCollection('announcements'), 'announcement');
  assert.equal(contentTypeForCollection('recommendations'), 'recommendation');
  assert.equal(hrefForPost('announcements', 'abc'), '/announcements/abc');
});

test('isPostCollection rejects events, empty and non-strings', () => {
  assert.equal(isPostCollection('topics'), true);
  assert.equal(isPostCollection('events'), false);
  assert.equal(isPostCollection(''), false);
  assert.equal(isPostCollection(42), false);
});

test('buildMovedDoc keeps identity + engagement, stamps provenance', () => {
  const now = new Date('2026-09-13T10:00:00Z');
  const src = {
    _id: 'id1', title: 'T', body: 'B', author: 'u1', comments: ['c1'], views: 3,
    likes: 2, likedBy: ['u2', 'u3'], tags: ['x'], images: [], date: 1, editHistory: [{ a: 1 }],
    moderationStatus: 'approved', createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-01'),
  };
  const out = buildMovedDoc(src, 'topics', 'announcements', now);
  assert.equal(out._id, 'id1');
  assert.deepEqual(out.likedBy, ['u2', 'u3']);
  assert.equal(out.likes, 2);
  assert.equal(out.views, 3);
  assert.deepEqual(out.comments, ['c1']);
  assert.deepEqual(out.editHistory, [{ a: 1 }]);
  assert.equal(out.createdAt, src.createdAt);
  assert.equal(out.updatedAt, now);
  assert.equal(out.movedFrom, 'topics');
  assert.equal(out.movedAt, now);
  assert.equal('category' in out, false);
});

test('buildMovedDoc strips announcement-only and recommendation-only fields', () => {
  const now = new Date();
  const fromAnn = buildMovedDoc(
    { _id: 'a', isOfficial: false, pinnedUntil: null, editCount: 2, title: 'T' },
    'announcements', 'topics', now,
  );
  assert.equal('isOfficial' in fromAnn, false);
  assert.equal('pinnedUntil' in fromAnn, false);
  assert.equal('editCount' in fromAnn, false);

  const fromRec = buildMovedDoc({ _id: 'r', category: 'shop', title: 'T' }, 'recommendations', 'topics', now);
  assert.equal('category' in fromRec, false);
});

test('buildMovedDoc gives a recommendation the default category', () => {
  const out = buildMovedDoc({ _id: 'x', title: 'T' }, 'topics', 'recommendations', new Date());
  assert.equal(out.category, 'other');
});

test('each kind has its own create endpoint and response key', () => {
  assert.equal(createEndpointForKind('discussion'), '/api/topics/create');
  assert.equal(createEndpointForKind('announcement'), '/api/announcements/create');
  assert.equal(createEndpointForKind('recommendation'), '/api/recommendations/create');
  assert.equal(createdDocKeyForKind('discussion'), 'topic');
  assert.equal(createdDocKeyForKind('announcement'), 'announcement');
  assert.equal(createdDocKeyForKind('recommendation'), 'recommendation');
});
