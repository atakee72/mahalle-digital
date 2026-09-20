// Air-quality logger core (Kiez-Daten novel §00 — Messwert-Logger).
// This module is server-only once Task 2 adds the Mongo/BLUME functions;
// never import it from client islands (they fetch the APIs instead).
import type { Db } from 'mongodb';
import type { AirDailyDoc, AirLogDoc, AirHistoryDay, AirHistoryResponse } from '../../types/kiezStats';
import { fetchMc042, isValidGrade } from './blume';

export const AIR_LOG_COLLECTION = 'schillerkiez_air_log';
export const AIR_DAILY_COLLECTION = 'schillerkiez_air_daily';
export const HOURLY_RETENTION_DAYS = 90;

const berlinDayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "YYYY-MM-DD" of the Europe/Berlin calendar day containing `d`. */
export function berlinDayKey(d: Date): string {
  return berlinDayFmt.format(d);
}

/**
 * Last `n` Berlin day keys, oldest first, ending with the day containing `now`.
 * Steps in 24h increments from NOON UTC of the current Berlin day — noon UTC
 * is always well inside a Berlin day, so DST 23h/25h days can't skip or
 * duplicate a key.
 */
export function lastBerlinDays(n: number, now: Date): string[] {
  const [y, m, d] = berlinDayKey(now).split('-').map(Number);
  const anchor = Date.UTC(y, m - 1, d, 12);
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    days.push(berlinDayKey(new Date(anchor - i * 86400000)));
  }
  return days;
}

/** Daily rollup from a day's LQI readings. Returns null when there are none — a gap day never gets a rollup doc (never interpolate). */
export function buildDailyRollup(
  day: string,
  lqis: number[]
): Omit<AirDailyDoc, 'updatedAt'> | null {
  // Only real grades count. Rows logged before 2026-09-19 can carry BLUME's
  // -1 „no measurement" code (see blume.ts) — one of them turned a day of 2s
  // into lqiMean -0.1.
  const valid = lqis.filter(isValidGrade);
  if (valid.length === 0) return null;
  const lqiMax = Math.max(...valid);
  const lqiMean = Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10;
  return { day, lqiMax, lqiMean, readings: valid.length };
}

export async function ensureAirIndexes(db: Db): Promise<void> {
  await db
    .collection(AIR_LOG_COLLECTION)
    .createIndex({ ts: 1 }, { unique: true, name: 'air_log_ts_unique' });
  await db
    .collection(AIR_DAILY_COLLECTION)
    .createIndex({ day: 1 }, { unique: true, name: 'air_daily_day_unique' });
}

/**
 * Why the morning freshness alarm found no readings (pure; used by airFreshness.ts).
 * Since 2026-09-19 a silent STATION logs nothing (its -1 is not a reading), so „no
 * readings in 24h" no longer means the logger is dead. `stationHasLqiNow` is the
 * live feed's answer for mc042, or null when BLUME could not be asked — then assume
 * the case that needs a human.
 */
export function silenceKind(recentReadings: number, stationHasLqiNow: boolean | null): 'ok' | 'station_silent' | 'logger_dead' {
  if (recentReadings > 0) return 'ok';
  return stationHasLqiNow === false ? 'station_silent' : 'logger_dead';
}

/** Recompute one Berlin day's rollup from its logged readings. No readings ⇒ no doc (gaps stay absent). */
export async function recomputeDailyRollup(db: Db, day: string): Promise<void> {
  const lqis = await db
    .collection(AIR_LOG_COLLECTION)
    .find({ day }, { projection: { lqi: 1 } })
    .map((d) => d.lqi as number)
    .toArray();
  const rollup = buildDailyRollup(day, lqis);
  if (!rollup) {
    // No valid reading (any more) ⇒ no doc: a rollup left over from „no
    // measurement" rows must not survive as a fake day.
    await db.collection(AIR_DAILY_COLLECTION).deleteOne({ day });
    return;
  }
  await db
    .collection(AIR_DAILY_COLLECTION)
    .updateOne({ day }, { $set: { ...rollup, updatedAt: new Date() } }, { upsert: true });
}

export interface LogResult {
  logged: boolean;
  duplicate?: boolean; // BLUME still serving the same measurement ts as a previous tick
  reason?: string;     // why nothing was logged (BLUME down / no LQI / bad datetime)
  ts?: string;
  day?: string;
  pruned?: number;     // hourly rows older than 90 d removed this tick
}

/** One logger tick: fetch BLUME → upsert reading (dedup on measurement ts) → recompute that day's rollup → prune. A failed fetch logs nothing — the gap is the honest record. */
export async function runAirLogger(db: Db, now: Date = new Date()): Promise<LogResult> {
  await ensureAirIndexes(db);

  let data;
  try {
    data = await fetchMc042();
  } catch (err) {
    return { logged: false, reason: err instanceof Error ? err.message : 'blume_unreachable' };
  }

  const lqiComp = data.find((d) => d.component === 'lqi');
  if (!lqiComp || lqiComp.grade == null) return { logged: false, reason: 'no_lqi' };

  const ts = new Date(lqiComp.datetime);
  if (isNaN(ts.getTime())) return { logged: false, reason: 'bad_datetime' };

  const grade = (name: string): number | null =>
    data.find((d) => d.component === name)?.grade ?? null;

  const day = berlinDayKey(ts);
  const doc: AirLogDoc = {
    ts,
    day,
    lqi: lqiComp.grade,
    pm10: grade('pm10'),
    no2: grade('no2'),
    o3: grade('o3'),
    co: grade('co'),
    loggedAt: now,
  };
  // Dedup on the unique measurement ts. E11000 covers the race where two
  // overlapping ticks (Actions retry / manual dispatch) upsert the same ts.
  let duplicate = false;
  try {
    const upsert = await db
      .collection(AIR_LOG_COLLECTION)
      .updateOne({ ts }, { $setOnInsert: doc }, { upsert: true });
    duplicate = upsert.upsertedCount === 0;
  } catch (err) {
    if ((err as { code?: number })?.code === 11000) duplicate = true;
    else throw err;
  }

  await recomputeDailyRollup(db, day);

  const cutoff = new Date(now.getTime() - HOURLY_RETENTION_DAYS * 86400000);
  const pruneRes = await db.collection(AIR_LOG_COLLECTION).deleteMany({ ts: { $lt: cutoff } });

  return { logged: true, duplicate, ts: ts.toISOString(), day, pruned: pruneRes.deletedCount };
}

/** 7-day strip + last logged reading — Mongo only, never calls BLUME (stays available when the station is silent; feeds state §04). */
export async function getAirHistory(db: Db, now: Date = new Date()): Promise<AirHistoryResponse> {
  const days = lastBerlinDays(7, now);
  const rollups = await db
    .collection(AIR_DAILY_COLLECTION)
    .find({ day: { $in: days } })
    .toArray();
  const byDay = new Map(rollups.map((r) => [r.day as string, r]));

  const out: AirHistoryDay[] = days.map((day) => {
    const r = byDay.get(day);
    return r
      ? { day, lqiMax: r.lqiMax as number, lqiMean: r.lqiMean as number, readings: r.readings as number }
      : { day, lqiMax: null, lqiMean: null, readings: 0 }; // gap — dashed bar, never interpolated
  });

  const last = await db
    .collection(AIR_LOG_COLLECTION)
    .find({ lqi: { $gte: 1, $lte: 5 } }, { projection: { ts: 1, lqi: 1 } }) // never a stored „no measurement" row
    .sort({ ts: -1 })
    .limit(1)
    .toArray();

  return {
    days: out,
    lastReading: last[0]
      ? { ts: (last[0].ts as Date).toISOString(), lqi: last[0].lqi as number }
      : null,
  };
}
