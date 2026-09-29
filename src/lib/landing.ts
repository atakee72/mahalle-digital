/**
 * Landing-page data: heartbeat rows (zero rule SERVER-SIDE), population,
 * air grade + 7-day sparkline, today's Kurier top 3. SERVER-ONLY.
 *
 * Cached 1 HOUR in a Mongo singleton doc (`landingCache`, in-code TTL —
 * chronikCache pattern): the landing promises "STÜNDLICH AKTUALISIERT",
 * so the cache window and the promise match. SSR consumes this directly;
 * /api/kiez-heartbeat is a thin public wrapper. Never self-fetch over HTTP.
 *
 * Every aggregate is fail-soft (own try/catch): a failing source drops its
 * row/field and the page renders without it — no throw reaches the route.
 */
import { connectDB } from './mongodb';
import { getAirHistory, readingFromBlume } from './kiez/airLog';
import { fetchMc042 } from './kiez/blume';
import * as Sentry from '@sentry/astro';
import { getISOWeek } from 'date-fns';
import { berlinYearMonth } from './landing/frames';
import type { SchaufensterData, ForumPeek, ListingPeek, KurierPeek, ForumStats, CalendarPeek, CalendarUpcoming, MarketStats, KurierStats, KiezPeek, KiezPop } from './landing/frames';
import type { AirHistoryResponse } from '../types/kiezStats';
import { resolveSektion } from './newsboard/newsTaxonomy';
import { computeIssueNumber } from './newsboard/newsFormat';
import { formatStand, KZ_PLR_SHORT } from './kiez/kiezViewModel';
export type { SchaufensterData, ForumPeek, ListingPeek, KurierPeek } from './landing/frames';

export interface HeartbeatRow {
  kind: 'air' | 'forum' | 'events' | 'kurier';
  value?: number;
  mute?: boolean;
  spark?: (number | null)[];
}

export interface LandingData {
  rows: HeartbeatRow[];
  population: number | null;
  airGrade: number | null;
  airSpark: (number | null)[];
  kurier: KurierPeek[];
  /** Landing Schaufenster peeks (2026-09-28). Absent on payloads cached before the field existed — readers treat that as empty. */
  schaufenster?: SchaufensterData | null;
  computedAt: string;
}

const CACHE_MS = 60 * 60 * 1000; // 1h — matches "STÜNDLICH AKTUALISIERT"
const AIR_FRESH_MS = 90 * 60 * 1000; // LANDING_CC_ANSWERS Q1: ≤90 min else mute

// Berlin-local Y-M-D parts for "now" (avoids UTC drift around midnight).
function berlinParts(now: Date): { y: number; m: number; d: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    weekday: weekdayMap[get('weekday')] ?? 1,
  };
}

// Midnight Europe/Berlin for a Berlin-local Y-M-D, as a UTC Date.
// Berlin is UTC+1 or +2; compute via the offset the zone had at that moment.
function berlinMidnightUTC(y: number, m: number, d: number): Date {
  // Start from the naive UTC midnight, then correct by the zone offset.
  const naive = new Date(Date.UTC(y, m - 1, d));
  const tzName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    timeZoneName: 'longOffset',
  })
    .formatToParts(naive)
    .find((p) => p.type === 'timeZoneName')?.value; // e.g. "GMT+02:00"
  const match = tzName?.match(/([+-])(\d{2}):(\d{2})/);
  const offsetMin = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 60;
  return new Date(naive.getTime() - offsetMin * 60_000);
}

/** Monday 00:00 Europe/Berlin of the current ISO week. */
export function isoWeekStart(now: Date): Date {
  const { y, m, d, weekday } = berlinParts(now);
  const monday = new Date(Date.UTC(y, m - 1, d - (weekday - 1)));
  return berlinMidnightUTC(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
}

/** [Fri 00:00, Mon 00:00) Europe/Berlin of the COMING weekend (Fri–Sun; during Fri–Sun = the current one). */
export function weekendRange(now: Date): { from: Date; to: Date } {
  const { y, m, d, weekday } = berlinParts(now);
  // 5 - weekday: Mon–Thu → days AHEAD to Friday; Fri/Sat/Sun → 0/-1/-2,
  // i.e. the CURRENT weekend's Friday (spec: during the weekend, count it).
  const friOffset = 5 - weekday;
  const fri = new Date(Date.UTC(y, m - 1, d + friOffset));
  const mon = new Date(Date.UTC(fri.getUTCFullYear(), fri.getUTCMonth(), fri.getUTCDate() + 3));
  return {
    from: berlinMidnightUTC(fri.getUTCFullYear(), fri.getUTCMonth() + 1, fri.getUTCDate()),
    to: berlinMidnightUTC(mon.getUTCFullYear(), mon.getUTCMonth() + 1, mon.getUTCDate()),
  };
}

// Visible-to-the-public moderation filter (matches buildModerationFilter's
// public branch: approved or legacy-absent status).
const PUBLIC_MOD = { moderationStatus: { $nin: ['pending', 'rejected'] } };

/** Per-area residents of the latest period, named and ordered like the Kiez-Daten page (code order, `KZ_PLR_SHORT`). */
function buildPop(g: { _id?: unknown; pop?: { code?: unknown; total?: unknown }[] } | undefined): KiezPop | null {
  if (!g || !Array.isArray(g.pop)) return null;
  const rows = g.pop
    .filter((r): r is { code: string; total: number } => typeof r.code === 'string' && typeof r.total === 'number' && r.total > 0)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((r) => ({ code: r.code, name: KZ_PLR_SHORT[r.code] ?? r.code, residents: r.total }));
  if (!rows.length) return null;
  return { period: typeof g._id === 'string' ? g._id : null, rows, total: rows.reduce((a, r) => a + r.residents, 0) };
}

async function compute(now: Date): Promise<LandingData> {
  const db = await connectDB();
  const failures: [string, unknown][] = [];

  // ── air (row + grade + spark) ──
  let airGrade: number | null = null;
  let airSpark: (number | null)[] = [];
  let airRow: HeartbeatRow | null = null;
  let freshReading: AirHistoryResponse['lastReading'] = null;
  let lastTs: string | null = null;
  try {
    const hist = await getAirHistory(db, now);
    airSpark = hist.days.map((d) => d.lqiMean);
    // Live BLUME first (mc042 only, never the substitute station), the log as
    // fallback: the logger's ~5 rows a day left the log "stale" for most of
    // the day (2026-09-29). A silent station yields no valid LQI → null → log.
    let reading = hist.lastReading;
    try {
      const live = readingFromBlume(await fetchMc042());
      if (live && (!reading || Date.parse(live.ts) >= Date.parse(reading.ts))) reading = live;
    } catch (err) {
      failures.push(['air.live', err]);
    }
    lastTs = reading?.ts ?? null;
    const fresh = reading && now.getTime() - Date.parse(reading.ts) <= AIR_FRESH_MS;
    if (fresh && reading) {
      airGrade = reading.lqi;
      freshReading = reading;
      airRow = { kind: 'air', value: airGrade, spark: airSpark };
    } else {
      // §03 Luft-Absent-State: row STAYS, mute dash — never a stale value.
      airRow = { kind: 'air', mute: true };
    }
  } catch (err) {
    airRow = null; // air source completely down → row falls away entirely
    failures.push(['air', err]);
  }

  // ── forum posts this ISO week ──
  let forumCount = 0;
  try {
    const since = isoWeekStart(now);
    const [t, a, r] = await Promise.all([
      db.collection('topics').countDocuments({ ...PUBLIC_MOD, createdAt: { $gte: since } }),
      db.collection('announcements').countDocuments({ ...PUBLIC_MOD, createdAt: { $gte: since } }),
      db.collection('recommendations').countDocuments({ ...PUBLIC_MOD, createdAt: { $gte: since } }),
    ]);
    forumCount = t + a + r;
  } catch (err) {
    forumCount = 0;
    failures.push(['forum', err]);
  }

  // ── events on the coming weekend ──
  let weekendEvents = 0;
  try {
    const { from, to } = weekendRange(now);
    weekendEvents = await db.collection('events').countDocuments({
      ...PUBLIC_MOD,
      visibility: { $ne: 'private' },
      startDate: { $gte: from, $lt: to },
    });
  } catch (err) {
    weekendEvents = 0;
    failures.push(['events', err]);
  }

  // ── kurier: the STRIP row is today-only (honest "HEUTIGE AUSGABE"), but
  //    the TEASER falls back to the latest issue ≤3 days old — the daily
  //    cron runs 06:00 UTC (08:00 Berlin), so a today-only teaser would sit
  //    empty every morning. fetchDate is written via toISOString().split('T')[0]
  //    (UTC-keyed) — match that, not Berlin. ──
  let kurier: LandingData['kurier'] = [];
  let kurierToday = false;
  let kurierStats: KurierStats | null = null;
  try {
    const todayKey = now.toISOString().split('T')[0];
    const latest = await db
      .collection('news')
      .find(
        { moderationStatus: 'approved', fetchDate: { $exists: true } },
        { projection: { fetchDate: 1 } },
      )
      .sort({ fetchDate: -1 })
      .limit(1)
      .toArray();
    const issueDay: string | undefined = latest[0]?.fetchDate;
    kurierToday = issueDay === todayKey;
    if (issueDay && Date.parse(todayKey) - Date.parse(issueDay) <= 3 * 86_400_000) {
      const docs = await db
        .collection('news')
        .find(
          { fetchDate: issueDay, moderationStatus: 'approved', ...NO_WARN }, // review 2026-09-29: labelled news never on the public page
          { projection: { title: 1, sourceName: 1, sourceUrl: 1, aiRelevanceScore: 1, imageUrl: 1, aiCategory: 1 } },
        )
        .sort({ aiRelevanceScore: -1 })
        .limit(3)
        .toArray();
      kurier = docs.map((d) => ({
        title: String(d.title ?? ''),
        sourceName: String(d.sourceName ?? ''),
        sourceUrl: String(d.sourceUrl ?? ''),
        ...(typeof d.imageUrl === 'string' && d.imageUrl.startsWith('https://') ? { imageUrl: d.imageUrl } : {}),
        sektion: resolveSektion(typeof d.aiCategory === 'string' ? d.aiCategory : null),
      }));
      try {
        const q = { fetchDate: issueDay, moderationStatus: 'approved' };
        kurierStats = {
          issue: computeIssueNumber(new Date(`${issueDay}T12:00:00Z`)),
          today: kurierToday,
          articles: await db.collection('news').countDocuments(q),
          sources: (await db.collection('news').distinct('sourceName', q)).length,
        };
      } catch (err) {
        kurierStats = null;
        failures.push(['schaufenster.kurierStats', err]);
      }
    }
  } catch (err) {
    kurier = [];
    kurierToday = false;
    failures.push(['kurier', err]);
  }

  // ── population: latest demographics period, all PLR areas summed ──
  let population: number | null = null;
  try {
    const agg = await db
      .collection('schillerkiez_demographics')
      .aggregate([
        { $sort: { period: -1 } },
        { $group: { _id: '$period', total: { $sum: '$population.total' } } },
        { $sort: { _id: -1 } },
        { $limit: 1 },
      ])
      .toArray();
    population = agg[0]?.total ?? null;
    if (typeof population !== 'number' || population <= 0) population = null;
  } catch (err) {
    population = null;
    failures.push(['population', err]);
  }

  // ── Schaufenster peeks (2026-09-28): newest public forum post, next public
  //    event, newest fresh listing. Titles only — never an author. Each
  //    source is fail-soft like the rows above. ──
  let sfForum: ForumPeek | null = null;
  let sfForumPeeks: ForumPeek[] = [];
  try {
    // Newest 3 per collection, merged, first 3 overall enriched with counts.
    const pick = async (col: string, kind: ForumPeek['kind']) => {
      const docs = await db
        .collection(col)
        .find({ ...PUBLIC_MOD, hasWarningLabel: { $ne: true } }, { projection: { title: 1, tags: 1, createdAt: 1, images: 1, likes: 1 } })
        .sort({ createdAt: -1 })
        .limit(3)
        .toArray();
      return docs.filter((d) => typeof d.title === 'string' && d.title.trim()).map((doc) => ({ kind, doc }));
    };
    const merged = (await Promise.all([pick('topics', 'discussion'), pick('announcements', 'announcement'), pick('recommendations', 'recommendation')])).flat();
    merged.sort((a, b) => +new Date(b.doc.createdAt ?? now) - +new Date(a.doc.createdAt ?? now));
    sfForumPeeks = await Promise.all(
      merged.slice(0, 3).map(async ({ kind, doc }): Promise<ForumPeek> => {
        const firstImg = Array.isArray(doc.images) ? doc.images[0] : null;
        const imgUrl = firstImg && typeof firstImg.url === 'string' && firstImg.url.startsWith('https://') ? firstImg.url : null;
        const [comments, saves] = await Promise.all([
          db.collection('comments').countDocuments({ relevantPostId: doc._id, moderationStatus: { $nin: ['pending', 'rejected'] } }),
          db.collection('savedPosts').countDocuments({ postId: String(doc._id) }),
        ]);
        return {
          kind,
          title: doc.title,
          tags: Array.isArray(doc.tags) ? doc.tags.filter((t: unknown) => typeof t === 'string').slice(0, 3) : [],
          createdAt: new Date(doc.createdAt ?? now).toISOString(),
          ...(imgUrl ? { image: imgUrl } : {}),
          likes: typeof doc.likes === 'number' ? doc.likes : 0,
          comments,
          saves,
        };
      }),
    );
    sfForum = sfForumPeeks[0] ?? null;
  } catch (err) {
    failures.push(['schaufenster.forum', err]);
  }

  let sfListing: ListingPeek | null = null;
  let sfListings: ListingPeek[] = [];
  try {
    const freshSince = new Date(now.getTime() - 21 * 86_400_000); // same 21-day clock as the browse page
    const docs = await db
      .collection('listings')
      .find(
        {
          ...PUBLIC_MOD,
          hasWarningLabel: { $ne: true },
          status: 'available',
          $expr: { $gte: [{ $ifNull: ['$lastBumpedAt', '$createdAt'] }, freshSince] },
        },
        { projection: { title: 1, images: 1, listingType: 1, listingKind: 1, price: 1, createdAt: 1 } },
      )
      .sort({ createdAt: -1 })
      .limit(3)
      .toArray();
    for (const doc of docs) {
      if (typeof doc.title !== 'string' || !doc.title.trim()) continue;
      // The create route writes `listingType`; older/seeded docs carry `listingKind`.
      const raw = doc.listingType ?? doc.listingKind;
      const kind: ListingPeek['kind'] = raw === 'exchange' || raw === 'gift' ? raw : 'sell';
      const first = Array.isArray(doc.images) ? doc.images[0] : null;
      sfListings.push({
        title: doc.title,
        image: typeof first === 'string' && first.startsWith('http') ? first : null,
        kind,
        price: kind === 'sell' && typeof doc.price === 'number' ? doc.price : null,
        photos: Array.isArray(doc.images) ? doc.images.length : 0,
        createdAt: new Date(doc.createdAt ?? now).toISOString(),
      });
    }
    sfListing = sfListings[0] ?? null;
  } catch (err) {
    failures.push(['schaufenster.listing', err]);
  }

  const dayMs = 86_400_000;
  const sinceYesterday = new Date(now.getTime() - dayMs); // the pages use rolling 24 h
  const since3h = new Date(now.getTime() - 3 * 3_600_000);
  const NO_WARN = { hasWarningLabel: { $ne: true } };

  // forum stats — „Themen" = the full public feed; „diskutiert heute" = posts whose newest visible comment is < 24 h old
  let forumStats: ForumStats | null = null;
  try {
    const cols = ['topics', 'announcements', 'recommendations'];
    const [totals, news] = await Promise.all([
      Promise.all(cols.map((c) => db.collection(c).countDocuments({ ...PUBLIC_MOD }))),
      Promise.all(cols.map((c) => db.collection(c).countDocuments({ ...PUBLIC_MOD, createdAt: { $gte: sinceYesterday } }))),
    ]);
    const recent = await db.collection('comments').aggregate([
      { $match: { createdAt: { $gte: sinceYesterday }, moderationStatus: { $nin: ['pending', 'rejected'] } } },
      { $group: { _id: '$relevantPostId' } },
    ]).toArray();
    const ids = recent.map((r) => r._id);
    const discussed = ids.length
      ? (await Promise.all(cols.map((c) => db.collection(c).countDocuments({ _id: { $in: ids }, ...PUBLIC_MOD })))).reduce((a, b) => a + b, 0)
      : 0;
    forumStats = { total: totals.reduce((a, b) => a + b, 0), newSinceYesterday: news.reduce((a, b) => a + b, 0), discussedToday: discussed };
  } catch (err) { failures.push(['schaufenster.forumStats', err]); }

  // calendar — current Berlin month: count + one entry per day with a public event (first category)
  let calendar: CalendarPeek | null = null;
  try {
    const { year, month } = berlinYearMonth(now.toISOString());
    const from = berlinMidnightUTC(year, month, 1);
    const to = berlinMidnightUTC(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1);
    const docs = await db.collection('events').find(
      { ...PUBLIC_MOD, ...NO_WARN, visibility: { $ne: 'private' }, startDate: { $gte: from, $lt: to } },
      { projection: { startDate: 1, category: 1 } }).sort({ startDate: 1 }).toArray();
    const seen = new Map<number, string>();
    for (const d of docs) { const day = berlinYearMonth(new Date(d.startDate).toISOString()).day; if (!seen.has(day)) seen.set(day, typeof d.category === 'string' ? d.category : 'kiez'); }
    // next four events from today (Berlin day): title/category/time only — no author, place or attendees
    let upcoming: CalendarUpcoming[] = [];
    try {
      const bp = berlinParts(now);
      const todayStart = berlinMidnightUTC(bp.y, bp.m, bp.d);
      const up = await db.collection('events').find(
        { ...PUBLIC_MOD, ...NO_WARN, visibility: { $ne: 'private' }, $or: [{ startDate: { $gte: todayStart } }, { endDate: { $gte: todayStart } }] },
        { projection: { title: 1, category: 1, allDay: 1, startDate: 1 } }).sort({ startDate: 1 }).limit(4).toArray();
      upcoming = up.filter((e) => typeof e.title === 'string' && e.title.trim()).map((e) => {
        const startISO = new Date(e.startDate).toISOString();
        const b = berlinYearMonth(startISO);
        return { dateISO: `${b.year}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`, title: e.title, category: typeof e.category === 'string' ? e.category : 'kiez', allDay: e.allDay === true, startISO };
      });
    } catch (err) { failures.push(['schaufenster.calendar.upcoming', err]); }
    calendar = { monthCount: docs.length, days: [...seen].map(([day, category]) => ({ day, category })), upcoming };
  } catch (err) { failures.push(['schaufenster.calendar', err]); }

  // market stats — the browse page's list (available, fresh ≤ 21 d) and its two windows
  let marketStats: MarketStats | null = null;
  try {
    const base = { ...PUBLIC_MOD, status: { $in: ['available', 'reserved'] }, $expr: { $gte: [{ $ifNull: ['$lastBumpedAt', '$createdAt'] }, new Date(now.getTime() - 21 * dayMs)] } };
    const [available, newSince, fresh] = await Promise.all([
      db.collection('listings').countDocuments(base),
      db.collection('listings').countDocuments({ ...base, createdAt: { $gte: sinceYesterday } }),
      db.collection('listings').countDocuments({ ...base, createdAt: { $gte: since3h } }),
    ]);
    marketStats = { available, newSinceYesterday: newSince, fresh };
  } catch (err) { failures.push(['schaufenster.marketStats', err]); }

  let kiez: KiezPeek | null = null;
  try {
    const latest = await db.collection('schillerkiez_demographics').aggregate([
      { $sort: { period: -1 } }, { $group: { _id: '$period', areas: { $addToSet: '$plr_code' }, date: { $first: '$date' }, pop: { $push: { code: '$plr_code', total: '$population.total' } } } }, { $sort: { _id: -1 } }, { $limit: 1 },
    ]).toArray();
    const valid = airSpark.filter((v): v is number => typeof v === 'number');
    const lr = freshReading;
    kiez = {
      stand: latest[0]?.date ? formatStand(String(latest[0].date)) : null,
      areas: Array.isArray(latest[0]?.areas) ? latest[0].areas.length : null,
      kw: getISOWeek(now),
      lqiWeekMean: valid.length ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10 : null,
      components: lr ? { pm10: lr.pm10 ?? null, no2: lr.no2 ?? null, o3: lr.o3 ?? null, co: lr.co ?? null } : null,
      readingAt: lastTs,
      pop: buildPop(latest[0]),
    };
  } catch (err) { failures.push(['schaufenster.kiez', err]); }

  const schaufenster: SchaufensterData = { forum: sfForum, forumPeeks: sfForumPeeks, forumStats, calendar, listing: sfListing, listings: sfListings, marketStats, kurierStats, kiez };

  // ── zero rule, SERVER-SIDE (§03): a row without life is omitted; the
  //    mute air row is life ("measurement paused" is information). ──
  const rows: HeartbeatRow[] = [];
  if (airRow) rows.push(airRow);
  if (forumCount > 0) rows.push({ kind: 'forum', value: forumCount });
  if (weekendEvents > 0) rows.push({ kind: 'events', value: weekendEvents });
  if (kurierToday) rows.push({ kind: 'kurier' });

  if (failures.length) {
    // Silent-degradation alert (root CLAUDE.md rule): the zero rule makes a
    // failing source look identical to a quiet week — without this capture,
    // a schema drift could blank the landing strip forever with no signal.
    // STATIC message; variable detail in extra so all occurrences group.
    try {
      Sentry.captureMessage('landing heartbeat source(s) failed', {
        level: 'warning',
        extra: { sources: failures.map(([k]) => k), errors: failures.map(([, e]) => String(e)) },
      });
      await Sentry.flush(2000);
    } catch { /* best-effort */ }
  }

  return { rows, population, airGrade, airSpark, kurier, schaufenster, computedAt: now.toISOString() };
}

export async function getLandingData(now: Date = new Date()): Promise<LandingData> {
  try {
    const db = await connectDB();
    const cacheCol = db.collection('landingCache');
    const cached = await cacheCol.findOne({ _id: 'landing' as any });
    if (cached && now.getTime() - new Date(cached.computedAt).getTime() < CACHE_MS) {
      return cached.payload as LandingData;
    }
    const payload = await compute(now);
    await cacheCol.updateOne(
      { _id: 'landing' as any },
      { $set: { payload, computedAt: now } },
      { upsert: true },
    );
    return payload;
  } catch (err) {
    console.error('[landing] getLandingData failed:', err);
    // Silent-degradation alert (root CLAUDE.md rule): total failure returns
    // an empty payload below with no thrown error — without this capture,
    // that's indistinguishable from a genuinely quiet week.
    try {
      Sentry.captureException(err);
      await Sentry.flush(2000);
    } catch { /* best-effort */ }
    // Total failure → empty data; the strip collapses, the manifest carries
    // the page (§03 Totalausfall). Never throw into the route.
    return { rows: [], population: null, airGrade: null, airSpark: [], kurier: [], schaufenster: null, computedAt: now.toISOString() };
  }
}
