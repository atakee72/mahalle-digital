// src/lib/landing/frames.test.ts
// Run: npx tsx --test src/lib/landing/frames.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrames, SECTION_ORDER, monthCells, berlinYearMonth, type FrameInput } from './frames';

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
    calendar: { monthCount: 3, days: [{ day: 4, category: 'kiez' }] },
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
  if (forum.key === 'forum') assert.equal(forum.stats, null);
  const cal = frames[1].live!;
  if (cal.key === 'calendar') assert.equal(cal.monthCount, 3);
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

test('new stats ride on the live view models and are null on an old payload', () => {
  const frames = buildFrames({ ...FULL, schaufenster: { ...FULL.schaufenster, forumStats: { total: 17, newSinceYesterday: 2, discussedToday: 1 }, calendar: { monthCount: 26, days: [{ day: 4, category: 'kiez' }] }, marketStats: { available: 1, newSinceYesterday: 0, fresh: 0 }, kurierStats: { issue: 269, articles: 6, sources: 9, today: true }, kiez: { stand: '30.06.2026', areas: 4, kw: 40, lqiWeekMean: 2.4, components: { pm10: 2, no2: 1, o3: 3, co: 1 }, readingAt: '2026-09-28T17:00:00.000Z' } }, blogMeta: { total: 11, latestISO: '2026-09-23T00:00:00.000Z', tags: [{ tag: 'wahl2026', n: 9 }] } }, FALLBACKS);
  const f = frames[0].live!; if (f.key === 'forum') assert.equal(f.stats?.total, 17);
  const c = frames[1].live!; if (c.key === 'calendar') { assert.equal(c.monthCount, 26); assert.equal(c.days[0].day, 4); }
  const m = frames[2].live!; if (m.key === 'marketplace') assert.equal(m.stats?.available, 1);
  const n = frames[3].live!; if (n.key === 'newsboard') assert.equal(n.stats?.issue, 269);
  const k = frames[4].live!; if (k.key === 'schillerkiez') assert.equal(k.kiez?.components?.o3, 3);
  const b = frames[5].live!; if (b.key === 'blog') assert.equal(b.meta?.total, 11);
  const old = buildFrames({ ...FULL, schaufenster: { ...FULL.schaufenster, calendar: undefined } }, FALLBACKS); // no new fields
  const of = old[0].live!; if (of.key === 'forum') assert.equal(of.stats, null);
  assert.equal(old[1].live, null); // calendar without month data is not live (falls back)
});

test('a Kurier sektion rides through to lead.sektion', () => {
  const frames = buildFrames({ ...EMPTY, kurier: [{ title: 'T', sourceName: 'S', sourceUrl: 'https://s', sektion: 'politik' }] }, {});
  const n = frames[0].live!; if (n.key === 'newsboard') assert.equal(n.lead.sektion, 'politik'); else assert.fail('not newsboard');
});

test('calendar frame is live from the month data alone, even with zero events', () => {
  const frames = buildFrames({ ...EMPTY, schaufenster: { forum: null, listing: null, calendar: { monthCount: 0, days: [] } } }, {});
  assert.deepEqual(frames.map((f) => f.key), ['calendar']);
});

test('monthCells is Monday-first with 42 cells', () => {
  // February 2026 starts on a Sunday → 6 leading blanks; 28 days; padding to 42
  const feb = monthCells(2026, 2, [{ day: 3, category: 'kiez' }]);
  assert.equal(feb.length, 42);
  assert.deepEqual(feb.slice(0, 7).map((c) => c.day), [null, null, null, null, null, null, 1]);
  assert.equal(feb[8].category, 'kiez'); // index 6 = day 1, index 8 = day 3
  // August 2026 starts on a Saturday, 31 days → 5 leading blanks, still 42 cells, last day at index 35
  const aug = monthCells(2026, 8, []);
  assert.equal(aug[5].day, 1); assert.equal(aug[35].day, 31); assert.equal(aug[36].day, null);
});

test('berlinYearMonth reads Europe/Berlin parts', () => {
  assert.deepEqual(berlinYearMonth('2026-09-30T22:30:00.000Z'), { year: 2026, month: 10, day: 1 }); // 00:30 Berlin on 1 Oct
});

test('kiez components all null stay null (muted strip), never zeroed', () => {
  const frames = buildFrames({ ...EMPTY, airSpark: [2], schaufenster: { forum: null, listing: null, kiez: { stand: null, areas: null, kw: 40, lqiWeekMean: null, components: { pm10: null, no2: null, o3: null, co: null }, readingAt: null } } }, {});
  const k = frames[0].live!; if (k.key === 'schillerkiez') assert.equal(k.kiez?.components?.pm10, null);
});
