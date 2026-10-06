// DEPENDENCY-PURE: imported by the event edit route, push.ts AND the notification panel island.
// No node/astro/mongodb imports, ever.
//
// „Termin verschoben": what counts as a move, who is told, and how the new time reads.
// An author's edit of date, time or place tells everyone who answered „ich komme" / „vielleicht"
// or saved the event; a text-only edit tells nobody.
import { berlinDayOf, isLegacyUtcAllDay } from './berlinDay';
import type { NotificationTarget } from '../../types/notification';

export type MoveChange = 'date' | 'place' | 'both';
export type MoveLocale = 'de' | 'en';

type Instant = Date | string | number;
export interface MoveFacts {
  startDate: Instant;
  endDate: Instant;
  allDay?: boolean | null;
  location?: string | null;
}

const ms = (v: Instant): number => new Date(v).getTime();
// The edit form reads a stored time as HH:MM and writes it back: seconds are lost on the way.
// Compared by the minute, so re-saving an unchanged time is never a move.
const minuteOf = (v: Instant): number => Math.floor(ms(v) / 60000);
/** The civil days an all-day event MEANS. Rows in the pre-2026-09-27 storage (UTC bounds) carry
 *  them in their UTC dates; the form rewrites such a row to Berlin bounds on any save. */
function allDayDays(f: MoveFacts): string {
  const start = new Date(f.startDate);
  const end = new Date(f.endDate);
  return isLegacyUtcAllDay(start, end)
    ? `${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)}`
    : `${berlinDayOf(start)}..${berlinDayOf(end)}`;
}
const DAY_MS = 24 * 60 * 60 * 1000;
const runsADay = (f: MoveFacts): boolean => ms(f.endDate) - ms(f.startDate) >= DAY_MS;
const placeOf = (s: string | null | undefined): string => (s ?? '').trim().replace(/\s+/g, ' ');

/**
 * What an edit changed for the people who plan to come — `null` when nothing they need to know.
 * „date" = the start moved (by the minute), the last DAY moved (Berlin), or timed ↔ all-day; an
 * end TIME that only got longer or shorter is not a move — also when it slips past midnight
 * (18:00–23:00 → 18:00–00:30): for a timed event the last day counts only when the event runs
 * a day or longer, before or after the edit. All-day events are compared by their days, never
 * by their stored instants. „place" = a new, non-empty place (case and spacing
 * ignored); removing the place tells nobody.
 */
export function moveChange(before: MoveFacts, after: MoveFacts): MoveChange | null {
  // a stored date that is not a date cannot be compared (and Intl throws on it): no date move
  const readable = [before.startDate, before.endDate, after.startDate, after.endDate].every((v) => Number.isFinite(ms(v)));
  const date =
    readable && (
    !!before.allDay !== !!after.allDay ||
    (after.allDay
      ? allDayDays(before) !== allDayDays(after)
      : minuteOf(before.startDate) !== minuteOf(after.startDate) ||
        ((runsADay(before) || runsADay(after)) && berlinDayOf(before.endDate) !== berlinDayOf(after.endDate))));
  const next = placeOf(after.location);
  const place = next !== '' && next.toLowerCase() !== placeOf(before.location).toLowerCase();
  if (date && place) return 'both';
  if (date) return 'date';
  return place ? 'place' : null;
}

/**
 * The start the „verschoben" tag names as „ursprünglich": the FIRST one, however often the event
 * moves. `null` = the event is back at that start — it is not moved any more, the tag goes.
 */
export function originalStart(existing: { startDate: Instant; movedFromStart?: Instant | null }, nextStart: Instant): Date | null {
  const original = new Date(existing.movedFromStart ?? existing.startDate);
  return minuteOf(original) === minuteOf(nextStart) ? null : original;
}

/**
 * A member keeps ONE row per event, and it must tell the whole story: every older notice about the
 * same event is replaced by the new one. When an older one was still UNREAD, the new row says
 * „both" unless the two are about the same thing (the row always prints the event's CURRENT time
 * and place); a notice the member had read needs no folding.
 */
export function mergeChange(unreadBefore: (MoveChange | undefined)[], change: MoveChange): MoveChange {
  return unreadBefore.some((c) => c !== undefined && c !== change) ? 'both' : change;
}

/** Everyone who said „ich komme" or „vielleicht" or saved the event — each once, never the author. */
export function moveRecipients(going: unknown[], maybe: unknown[], saved: unknown[], authorId: string): string[] {
  const ids = new Set<string>();
  for (const v of [...going, ...maybe, ...saved]) {
    const id = v == null ? '' : String(v);
    if (id && id !== authorId) ids.add(id);
  }
  return [...ids];
}

const WD_DE = ['Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.', 'So.'];
const WD_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON_DE = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Own tables instead of Intl's formatted strings: those differ between ICU versions
// („Mi., 14. Okt." vs „Mi. 14. Okt."), and the push text is built on the server.
const BERLIN = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin', weekday: 'short', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function berlinParts(v: Instant): { wd: number; d: number; m: number; hh: string; mm: string } {
  const parts = BERLIN.formatToParts(new Date(v));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // padded by hand: some engines print a one-digit hour despite „2-digit"
  return { wd: Math.max(0, WD_EN.indexOf(get('weekday'))), d: Number(get('day')), m: Number(get('month')), hh: get('hour').padStart(2, '0'), mm: get('minute').padStart(2, '0') };
}
function dayLabel(v: Instant, locale: MoveLocale): string {
  const p = berlinParts(v);
  return locale === 'en' ? `${WD_EN[p.wd]} ${p.d} ${MON_EN[p.m - 1]}` : `${WD_DE[p.wd]}, ${p.d}. ${MON_DE[p.m - 1]}`;
}

/**
 * „Mi., 14. Okt., 18:00" · „Mi., 14. Okt. · ganztägig" · „Mi., 14. Okt. – Fr., 16. Okt." (all-day,
 * several days) · „Mi., 14. Okt., 18:00 – Fr., 16. Okt." (timed, a day or longer). Berlin time.
 * A timed event that only runs past midnight (22:00 – 01:00) reads by its start alone.
 */
export function moveWhenLabel(startISO: Instant, endISO: Instant, allDay: boolean, locale: MoveLocale): string {
  // a broken date must cost the row its time, never the whole bell panel (Intl throws on it)
  if (!Number.isFinite(ms(startISO)) || !Number.isFinite(ms(endISO))) return '';
  const first = dayLabel(startISO, locale);
  const severalDays = berlinDayOf(startISO) !== berlinDayOf(endISO);
  if (allDay) return severalDays ? `${first} – ${dayLabel(endISO, locale)}` : `${first} · ${locale === 'en' ? 'all day' : 'ganztägig'}`;
  const p = berlinParts(startISO);
  const timed = `${first}, ${p.hh}:${p.mm}`;
  return severalDays && ms(endISO) - ms(startISO) >= DAY_MS ? `${timed} – ${dayLabel(endISO, locale)}` : timed;
}

/** The bell row's link: the calendar opens on the NEW day with the event's detail view. */
export function moveTarget(eventId: string, title: string, startISO: Instant): NotificationTarget {
  return { contentType: 'event', contentId: eventId, title, href: `/calendar?event=${eventId}&d=${berlinDayOf(startISO)}` };
}

/** German push text (push payloads are German-only, like every other type). */
export function movePushBody(change: MoveChange | undefined, title: string, when: string, place: string): string {
  if (change === 'place') return `Neuer Ort für ‚${title}‘: ${place}`;
  const tail = change === 'both' && place ? `, ${place}` : '';
  return `Termin verschoben: ‚${title}‘ — neu: ${when}${tail}`;
}
