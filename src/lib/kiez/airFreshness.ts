// Freshness tripwire for the air logger (SERVER-ONLY — imports mongodb).
//
// Why this exists: the logger is rung by GitHub Actions
// (`.github/workflows/kiez-air-logger.yml`), so when the CALLER breaks, the
// request never reaches this app — no exception, no Sentry event, nothing but
// a red Actions tab nobody watches. The Aug 2026 domain cutover killed it
// exactly that way (old origin → 308 → `curl` exit 1) and it went unnoticed
// for two days. Error tracking is structurally blind to callers that never
// arrive, so the only honest check is on the DATA, not on the absence of
// errors.
//
// Called once a day by the news cron (`/api/news/fetch-daily`) — it already
// runs on a Vercel-native schedule, which the alias/redirect layer can't
// break, so it makes a reliable host for this check.
import * as Sentry from '@sentry/astro';
import { connectDB } from '../mongodb';
import { AIR_LOG_COLLECTION, silenceKind } from './airLog';
import { fetchMc042, isValidGrade } from './blume';

/**
 * Window for "is anything arriving at all". Deliberately a whole day rather
 * than a few hours: BLUME publishes hourly and real days land 17–21 readings,
 * so multi-hour upstream gaps are NORMAL and a tight threshold would cry wolf.
 * Zero readings in 24h is unambiguous — either the logger is dead or the
 * upstream is, and both want a human.
 */
const WINDOW_HOURS = 24;

/**
 * Alerts (via Sentry) when no air reading has landed in the last 24h.
 * Best-effort and never throws: the caller is a cron whose own job must not
 * fail because a watchdog did.
 */
export async function checkAirLoggerFreshness(now: Date = new Date()): Promise<void> {
  try {
    const db = await connectDB();
    const col = db.collection(AIR_LOG_COLLECTION);
    const since = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000);

    const recent = await col.countDocuments({ ts: { $gte: since } });
    if (recent > 0) return;

    // Since 2026-09-19 a silent STATION logs nothing (BLUME's -1 is not a
    // reading), so an empty window no longer proves the logger is dead. Ask
    // the feed: no value for mc042 right now ⇒ the station is down, the logger
    // is fine. BLUME unreachable ⇒ null ⇒ assume the logger (needs a human).
    let stationHasLqiNow: boolean | null = null;
    try {
      stationHasLqiNow = (await fetchMc042()).some((c) => c.component === 'lqi' && isValidGrade(c.grade));
    } catch {
      stationHasLqiNow = null;
    }
    const kind = silenceKind(recent, stationHasLqiNow);

    const newest = await col.findOne<{ ts?: Date }>({}, { sort: { ts: -1 }, projection: { ts: 1 } });

    // STATIC message — a variable one fragments into a new Sentry issue per
    // string. Detail belongs in `extra`. And flush explicitly: this is a
    // success path, so the middleware's error-path flush never runs and
    // Vercel freezes the function the moment the response leaves.
    if (kind === 'station_silent') {
      // Its OWN static message + warning level: a different issue from the
      // logger alarm, true to its cause. Leave it UNRESOLVED while the station
      // is down — resolved, it would reopen (and ping) every morning.
      Sentry.captureMessage('kiez: station mc042 silent — no valid reading in 24h (logger healthy)', {
        level: 'warning',
        extra: {
          windowHours: WINDOW_HOURS,
          newestReadingTs: newest?.ts instanceof Date ? newest.ts.toISOString() : 'none',
          hint: 'BLUME sends -1 for mc042; nothing to fix in the app. The live strip shows the labelled Karl-Marx-Straße substitute meanwhile.',
        },
      });
      await Sentry.flush(2000);
      return;
    }

    Sentry.captureMessage('kiez: air logger silent — no readings in 24h', {
      level: 'error',
      extra: {
        windowHours: WINDOW_HOURS,
        newestReadingTs: newest?.ts instanceof Date ? newest.ts.toISOString() : 'none',
        hint: 'check `gh run list --workflow=kiez-air-logger.yml`; APP_ORIGIN must be the canonical domain — a 308 from the old *.vercel.app origin fails the curl step (and -L does not help: curl drops Authorization across hosts)',
      },
    });
    await Sentry.flush(2000);
  } catch (err) {
    // Swallowing here would rebuild the exact blind spot this function exists
    // to close, so report the watchdog's own failure before giving up.
    Sentry.captureException(err);
    await Sentry.flush(2000);
  }
}
