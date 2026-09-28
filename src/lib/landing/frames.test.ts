// src/lib/landing/frames.test.ts
// Run: npx tsx --test src/lib/landing/frames.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrames, SECTION_ORDER, type FrameInput } from './frames';

const FALLBACKS = {
  forum: '/assets/schaufenster/forum.webp',
  calendar: '/assets/schaufenster/calendar.webp',
  marketplace: '/assets/schaufenster/marketplace.webp',
  newsboard: '/assets/schaufenster/newsboard.webp',
  schillerkiez: '/assets/schaufenster/schillerkiez.webp',
  blog: '/assets/schaufenster/blog.webp',
};

const EMPTY: FrameInput = { rows: [], population: null, airGrade: null, airSpark: [], kurier: [], schaufenster: null, blog: null };

const FULL: FrameInput = {
  rows: [{ kind: 'forum', value: 18 }, { kind: 'events', value: 5 }],
  population: 28330,
  airGrade: 2,
  airSpark: [2, 2.4, null, 3, 2, 2, 2.1],
  kurier: [
    { title: 'Lead', sourceName: 'TAZ', sourceUrl: 'https://taz.de/x', imageUrl: 'https://img.example/a.jpg' },
    { title: 'Two', sourceName: 'BZ', sourceUrl: 'https://bz.de/y' },
    { title: 'Three', sourceName: 'RBB', sourceUrl: 'https://rbb.de/z' },
  ],
  schaufenster: {
    forum: { kind: 'announcement', title: 'Die Quartiersseite berichtet über uns.', tags: ['kiez', 'event'], createdAt: '2026-09-23T10:00:00.000Z' },
    event: { title: 'Tag der offenen Tür', startISO: '2026-09-28T13:00:00.000Z', allDay: false, category: 'kiez' },
    listing: { title: 'Bike Zipper', image: 'https://res.cloudinary.com/demo/image/upload/v1/x.jpg', kind: 'gift', price: null },
  },
  blog: { slug: 'kandidaten-check', title: 'So kam der Check zustande', description: 'Sieben Gastbeiträge.', pubDateISO: '2026-09-18T00:00:00.000Z', coverSrc: '/_astro/cover.webp' },
};

test('six frames in nav order, all live, with the count lines from the rows', () => {
  const frames = buildFrames(FULL, FALLBACKS);
  assert.deepEqual(frames.map((f) => f.key), [...SECTION_ORDER]);
  assert.deepEqual(frames.map((f) => f.href), ['/forum', '/calendar', '/marketplace', '/newsboard', '/schillerkiez', '/blog']);
  assert.ok(frames.every((f) => f.live !== null));
  const forum = frames[0].live!;
  assert.equal(forum.key, 'forum');
  if (forum.key === 'forum') assert.equal(forum.weekCount, 18);
  const cal = frames[1].live!;
  if (cal.key === 'calendar') assert.equal(cal.weekendCount, 5);
  const news = frames[3].live!;
  if (news.key === 'newsboard') { assert.equal(news.lead.title, 'Lead'); assert.deepEqual(news.more.map((m) => m.title), ['Two', 'Three']); }
});

test('an empty payload (or a pre-release cached payload without schaufenster) falls back on every frame', () => {
  const frames = buildFrames(EMPTY, FALLBACKS);
  assert.equal(frames.length, 6);
  assert.ok(frames.every((f) => f.live === null && f.fallback === FALLBACKS[f.key]));
  const legacy = { ...EMPTY } as FrameInput;
  delete (legacy as Partial<FrameInput>).schaufenster;
  assert.equal(buildFrames(legacy, FALLBACKS).length, 6);
});

test('a frame with neither live content nor a fallback file is omitted', () => {
  const frames = buildFrames(EMPTY, { forum: FALLBACKS.forum });
  assert.deepEqual(frames.map((f) => f.key), ['forum']);
});

test('kiez frame is live when any of grade, spark or population exists; blank titles do not count as live', () => {
  const sparkOnly = buildFrames({ ...EMPTY, airSpark: [null, 2, null] }, {});
  assert.deepEqual(sparkOnly.map((f) => f.key), ['schillerkiez']);
  const blankTitle = buildFrames({ ...EMPTY, schaufenster: { forum: { kind: 'discussion', title: '   ', tags: [], createdAt: '2026-01-01T00:00:00.000Z' } } }, {});
  assert.equal(blankTitle.length, 0);
});

test('tags are capped at three and the newsboard keeps at most two more titles', () => {
  const frames = buildFrames({ ...FULL, schaufenster: { ...FULL.schaufenster, forum: { ...FULL.schaufenster!.forum!, tags: ['a', 'b', 'c', 'd'] } }, kurier: [...FULL.kurier, { title: 'Four', sourceName: 'X', sourceUrl: 'https://x' }] }, FALLBACKS);
  const forum = frames[0].live!;
  if (forum.key === 'forum') assert.deepEqual(forum.tags, ['a', 'b', 'c']);
  const news = frames[3].live!;
  if (news.key === 'newsboard') assert.equal(news.more.length, 2);
});
