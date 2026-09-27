// Civil-day helpers for Europe/Berlin — dependency-pure (islands, API routes,
// scripts). The app's calendar lives in ONE zone: an all-day event is a Berlin
// day, whatever zone the browser or the server runs in. Until 2026-09-27 the
// composer stored all-day bounds as UTC midnight → 23:59:59Z, which a Berlin
// browser reads as 02:00 → 01:59 the NEXT day: the pill said „· 2 Tage" and
// every edit grew the event by a day (calendar area file, „All-day events").
// No tz library in the repo — offsets come from Intl.DateTimeFormat.

const DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
});
const PARTS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Berlin', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** YYYY-MM-DD of an instant in Europe/Berlin (en-CA prints ISO order). */
export function berlinDayOf(d: Date | string | number): string {
  return DAY_FMT.format(d instanceof Date ? d : new Date(d));
}

/** Today's civil date in Berlin. */
export function berlinTodayISO(now: Date = new Date()): string {
  return berlinDayOf(now);
}

/** Berlin's UTC offset in minutes at the instant `at` (+60 CET, +120 CEST). */
function berlinOffsetMinutes(at: Date): number {
  const parts = PARTS_FMT.formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((wall - at.getTime()) / 60_000);
}

function splitISO(iso: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`berlinDay: expected YYYY-MM-DD, got "${iso}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Berlin 00:00:00.000 of the civil day `iso` (YYYY-MM-DD). */
export function berlinDayStart(iso: string): Date {
  const [y, m, d] = splitISO(iso);
  const wallMidnight = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  // Two passes: the offset that applies AT local midnight, re-read once at the
  // candidate instant so a DST switch on that day resolves correctly.
  let t = wallMidnight - berlinOffsetMinutes(new Date(wallMidnight)) * 60_000;
  t = wallMidnight - berlinOffsetMinutes(new Date(t)) * 60_000;
  return new Date(t);
}

/** Berlin 23:59:59.999 of the civil day `iso` = next day's start minus 1 ms. */
export function berlinDayEnd(iso: string): Date {
  const [y, m, d] = splitISO(iso);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return new Date(berlinDayStart(next).getTime() - 1);
}

/** The pre-2026-09-27 all-day storage: UTC midnight → UTC 23:59:59.000. */
export function isLegacyUtcAllDay(start: Date, end: Date): boolean {
  return start.toISOString().endsWith('T00:00:00.000Z') && end.toISOString().endsWith('T23:59:59.000Z');
}
