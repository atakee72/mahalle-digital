import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromListingDraft, fromPostDraft, mergeDrafts } from './unifiedDrafts';

const post = { id: '64f000000000000000000001', kind: 'announcement' as const, title: ' Kiez-Daten ', body: 'x', tags: [], images: [{ url: 'https://res.cloudinary.com/x/mahalle/posts/a.jpg', publicId: 'mahalle/posts/a' }], createdAt: '2026-09-21T08:00:00.000Z', updatedAt: '2026-09-21T10:00:00.000Z' };

test('a forum draft becomes a row', () => {
  assert.deepEqual(fromPostDraft(post), {
    id: '64f000000000000000000001', source: 'forum', kindKey: 'chip.announcement', title: 'Kiez-Daten',
    updatedAt: '2026-09-21T10:00:00.000Z', thumb: 'https://res.cloudinary.com/x/mahalle/posts/a.jpg',
    resumeHref: '/topics/create?draft=64f000000000000000000001', deleteUrl: '/api/posts/drafts/64f000000000000000000001'
  });
});

test('a draft listing becomes a row — ObjectId-like id, Date, missing fields', () => {
  const row = fromListingDraft({ _id: { toString: () => '64f0000000000000000000aa' }, title: undefined, listingType: 'gift', images: [], updatedAt: new Date('2026-09-20T09:00:00.000Z'), createdAt: new Date('2026-09-19T09:00:00.000Z') });
  assert.deepEqual(row, {
    id: '64f0000000000000000000aa', source: 'markt', kindKey: 'market.filter.kind.verschenken', title: '',
    updatedAt: '2026-09-20T09:00:00.000Z', thumb: null,
    resumeHref: '/marketplace/create?draft=64f0000000000000000000aa', deleteUrl: '/api/listings/delete/64f0000000000000000000aa'
  });
  assert.equal(fromListingDraft({ _id: 'a'.repeat(24), listingType: 'exchange', images: ['https://res.cloudinary.com/x/l.jpg'], createdAt: '2026-09-01T00:00:00.000Z' }).kindKey, 'market.filter.kind.tausch');
  assert.equal(fromListingDraft({ _id: 'a'.repeat(24), createdAt: '2026-09-01T00:00:00.000Z' }).kindKey, 'market.filter.kind.verkaufen'); // default type = sell
  assert.equal(fromListingDraft({ _id: 'a'.repeat(24), createdAt: '2026-09-01T00:00:00.000Z' }).updatedAt, '2026-09-01T00:00:00.000Z'); // falls back to createdAt
});

test('merge: newest change first, across both kinds', () => {
  const a = fromPostDraft(post);
  const b = fromListingDraft({ _id: 'b'.repeat(24), title: 'Fahrrad', updatedAt: '2026-09-21T12:00:00.000Z' });
  const c = fromListingDraft({ _id: 'c'.repeat(24), title: 'Alt', updatedAt: '2026-08-01T12:00:00.000Z' });
  assert.deepEqual(mergeDrafts([a], [c, b]).map((d) => d.title), ['Fahrrad', 'Kiez-Daten', 'Alt']);
  assert.deepEqual(mergeDrafts(), []);
});
