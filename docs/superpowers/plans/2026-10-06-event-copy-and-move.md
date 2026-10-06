# Event Copy and Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An author can copy one of their calendar events onto a new date, and when an author moves an event, everyone who answered or saved it is told and the event carries a „verschoben" tag.

**Architecture:** Copy is the existing create form opened with another event's content and an empty date (`/events/create?copy=<id>`, loaded server-side for the owner only); it publishes through the unchanged create endpoint, so moderation and the daily limit apply. Move hooks into the existing edit endpoint: a pure rule decides whether date, time or place changed; a server helper notifies the members in `rsvps.going`, `rsvps.maybe` and `savedEvents` with a new notification type `event_moved`; a move whose edit the moderation holds back is announced when the admin approves it.

**Tech Stack:** Astro 5 SSR (one page, one API route), Svelte 5 islands, MongoDB driver, node:test via tsx, Tailwind 3.4.

**Spec:** there is no separate spec. The owner's decisions (2026-10-06) and the „Design decisions" section below are binding. Every code block below was built and run on a scratch branch first: 436 lib tests, type and Svelte budgets unchanged, and a 53-check browser probe against the local production build and the dev database.

## Design decisions

1. **No recurring events** (owner: „otherwise they add an event and forget to come back to mahalle"). Copy is the offered way.
2. **Copy carries content, never the day.** Title, text, place, category, times of day, capacity, visibility and tags are carried; the date field opens EMPTY and the form refuses to publish without one. Nothing that belongs to the old event travels: answers, likes, saves, comments, moderation state, „verschoben".
3. **Copy is a new event:** it goes through `POST /api/events/create` unchanged — moderation, the daily limit of 5, the admin alert.
4. **Only the author's own event, and not a rejected one.** Past and pending own events can be copied. Any other id redirects to `/calendar`.
5. **A copy leaves the member's saved draft alone** (`kiosk-draft:event`): no load, no autosave, no clear.
6. **What counts as a move:** the start changed, the last Berlin DAY changed, or timed ↔ all-day (`date`); a new, non-empty place (`place`); both together (`both`). NOT a move: a text-only edit, an end time that only got longer or shorter, the same place written with other case or spacing, a removed place. The edit form re-saves the dates on every save, so timed starts are compared by the minute and all-day events by the days they mean — never by raw stored instants.
7. **Who is told:** everyone in „ich komme", „vielleicht" or with the event saved — each once, never the author.
8. **Every move reaches the bell; only the push has a brake.** A move that is saved but not shown leaves people with a wrong date, so the bell row is always written. Noise is limited in two ways: a member's older UNREAD notice about the same event is replaced by the new one (two different kinds become `both`), so each member has at most one unread row per event and it always shows the current time and place; and phones are rung (web push) for the first three moves of an event per hour only — without that an author could ring every attendee's phone over and over by editing the date. The edit itself is never refused.
9. **A move whose edit the moderation holds back** is not announced while the event is hidden; it is announced exactly once when the admin approves.
10. **„verschoben" tag:** set when date or time changed (not for a place-only change); shown in the agenda/day rows, the phone month's day list and the detail view (with „ursprünglich …" = the FIRST start, however often the event moves). An event moved back to that first start loses the tag. Not on the month grid's pills.
11. **No drag-to-move** in the calendar. Moving stays „bearbeiten" → change the date.
12. **All new texts are drafts** (DE + EN in `src/lib/kiosk-i18n.ts`); push texts are German only, like every other push.

## Global Constraints

- Error budgets stay EXACTLY at `pnpm type-check` 16 errors and `npx -y svelte-check@4` 81 errors; `pnpm test` stays green (422 before this plan, 436 after Task 1).
- Commit messages: plain and concise. NO „🤖 Generated with Claude Code" line, NO „Co-Authored-By" footer.
- Never stage secrets; never print any `.env` value (names only). The dev password lives in `scratchpad/devpw.txt`, read by probes, never printed.
- `src/lib/calendar/eventMove.ts` is dependency-pure (it is imported by a Svelte island): no `mongodb`, no `astro:*`, no Sentry, nothing that reads `import.meta.env`.
- `MovedTag.svelte` has NO `<style>` block (it is reachable only through other islands; a scoped style would be orphaned in the production build). Tailwind classes only.
- New code uses `connectDB()` / a passed `Db`, never the default `clientPromise` export.
- Notification writes never throw into the request: `tellAboutMove()` and `sendOwedMoveNotice()` catch everything.
- The push brake (`eventmove:<eventId>`, 3 per hour) may only ever silence the PUSH. It must never skip the bell row and never refuse the edit.
- Apply every ```diff block with `git apply` from the repo root; a block introduced by a line ending in `` `path`: `` is the WHOLE file.
- Do not start `pnpm dev`. Do not push. Do not touch files outside the task's list.

## Review Focus

1. Several corrections of the date in a row: every one must reach the bell, nobody may end up with a row that shows an outdated date, and an author must not be able to ring phones without limit — `mergeChange` test (Task 1); probe „M6 … newest row carries the CURRENT date", „still one unread row per member" and „all six moves were counted by the push brake" (Task 5).
2. A member who answered AND saved the event, and the author who answered their own event: one notice, respectively none — `moveRecipients` test (Task 1); probe „M2 ayse and admin are told once each, the author is not" (Task 5).
3. An edit that changes nothing people need to know must ring nobody and set no tag — also when it goes through the edit FORM, which re-saves the dates (seconds lost, old all-day rows rewritten): text only, a longer end time, the same place in other case or spacing — `moveChange` tests incl. „re-saving an unchanged event through the form is no move" (Task 1); probe M1, M1b, M1c and M4 (Task 5).
4. An edit held by the moderation: nobody told while the event is hidden, exactly one notice on approval even when two reviews arrive at once — probe H2 and H3 (Task 5).
5. Copy: publishing without a date is refused in the form; another member's or a rejected event cannot be copied; the member's own draft survives — probe C4, C8 and C6 (Task 5).

---

### Task 1: Move rules, types and texts

**Files:**
- Create: `src/lib/calendar/eventMove.ts`
- Test (create): `src/lib/calendar/eventMove.test.ts`
- Modify: `src/types/notification.ts`, `src/types/index.ts`, `src/lib/kiosk-i18n.ts`

**Interfaces:**
- Consumes (already on main): `berlinDayOf(d: Date | string | number): string` and `isLegacyUtcAllDay(start: Date, end: Date): boolean` from `src/lib/calendar/berlinDay.ts`; `NotificationTarget` from `src/types/notification.ts`.
- Produces (pure, `src/lib/calendar/eventMove.ts`):
  - `type MoveChange = 'date' | 'place' | 'both'`, `type MoveLocale = 'de' | 'en'`, `interface MoveFacts { startDate; endDate; allDay?; location? }`
  - `moveChange(before: MoveFacts, after: MoveFacts): MoveChange | null`
  - `originalStart(existing: { startDate; movedFromStart? }, nextStart): Date | null` — the start to store as „ursprünglich", `null` when the event is back at it
  - `mergeChange(unreadBefore: (MoveChange | undefined)[], change: MoveChange): MoveChange`
  - `moveRecipients(going: unknown[], maybe: unknown[], saved: unknown[], authorId: string): string[]`
  - `moveWhenLabel(startISO, endISO, allDay: boolean, locale: MoveLocale): string`
  - `moveTarget(eventId: string, title: string, startISO): NotificationTarget`
  - `movePushBody(change: MoveChange | undefined, title: string, when: string, place: string): string`
- Produces (types): `NotificationType` gains `'event_moved'`; `NotificationMeta` gains `change?`, `startISO?`, `endISO?`, `allDay?`, `place?`; `Event` gains `movedAt?`, `movedFromStart?`, `moveNoticeOwed?`; new `EventCopySource`.
- Produces (texts, DE + EN): `nc.event.moved.date|place|both`, `cal.compose.move.hint`, `cal.moved.label`, `cal.moved.from`, `cal.detail.copy.label`, `cal.detail.copy.tooltip`, `cal.compose.copy.notice`.

- [ ] **Step 1: Write the failing test**

`src/lib/calendar/eventMove.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveChange, mergeChange, originalStart, moveRecipients, moveWhenLabel, moveTarget, movePushBody } from './eventMove';

// Wednesday 14 Oct 2026, 18:00–20:00 Berlin (CEST = UTC+2)
const base = { startDate: '2026-10-14T16:00:00.000Z', endDate: '2026-10-14T18:00:00.000Z', allDay: false, location: 'Herrfurthplatz' };

test('a text-only edit is no move', () => {
  assert.equal(moveChange(base, { ...base }), null);
  assert.equal(moveChange(base, { ...base, startDate: new Date(base.startDate), endDate: new Date(base.endDate) }), null);
});

test('a new start is a date move; an end time that only changes length is not', () => {
  assert.equal(moveChange(base, { ...base, startDate: '2026-10-14T17:00:00.000Z' }), 'date');
  assert.equal(moveChange(base, { ...base, startDate: '2026-10-21T16:00:00.000Z', endDate: '2026-10-21T18:00:00.000Z' }), 'date');
  assert.equal(moveChange(base, { ...base, endDate: '2026-10-14T19:30:00.000Z' }), null);
});

test('re-saving an unchanged event through the form is no move', () => {
  // timed: the form writes HH:MM back, stored seconds are lost
  assert.equal(moveChange({ ...base, startDate: '2026-10-14T16:00:42.500Z' }, { ...base, startDate: '2026-10-14T16:00:00.000Z' }), null);
  assert.equal(moveChange(base, { ...base, startDate: '2026-10-14T16:01:00.000Z' }), 'date');
  // all-day, Berlin bounds re-saved unchanged
  const day = { startDate: '2026-10-13T22:00:00.000Z', endDate: '2026-10-14T21:59:59.999Z', allDay: true, location: 'Herrfurthplatz' };
  assert.equal(moveChange(day, { ...day }), null);
  // all-day in the old UTC storage, rewritten by the form to the Berlin bounds of the SAME day
  const legacy = { startDate: '2026-10-14T00:00:00.000Z', endDate: '2026-10-14T23:59:59.000Z', allDay: true, location: 'Herrfurthplatz' };
  assert.equal(moveChange(legacy, day), null);
  // … and a real move by one day is still seen, from either storage
  const nextDay = { ...day, startDate: '2026-10-14T22:00:00.000Z', endDate: '2026-10-15T21:59:59.999Z' };
  assert.equal(moveChange(day, nextDay), 'date');
  assert.equal(moveChange(legacy, nextDay), 'date');
  // an all-day event that gets one more day
  assert.equal(moveChange(day, { ...day, endDate: '2026-10-15T21:59:59.999Z' }), 'date');
});

test('„ursprünglich" is the first start; back at it the event is not moved any more', () => {
  const first = '2026-10-14T16:00:00.000Z';
  assert.equal(originalStart({ startDate: first }, '2026-10-15T16:00:00.000Z')?.toISOString(), first);
  // a second move keeps the first start, not the one in between
  assert.equal(originalStart({ startDate: '2026-10-15T16:00:00.000Z', movedFromStart: new Date(first) }, '2026-10-16T16:00:00.000Z')?.toISOString(), first);
  // moved back (seconds ignored) → no original to name
  assert.equal(originalStart({ startDate: '2026-10-16T16:00:00.000Z', movedFromStart: first }, '2026-10-14T16:00:30.000Z'), null);
  // only the last day changed, the start stayed → nothing to name either
  assert.equal(originalStart({ startDate: first }, first), null);
});

test('a new last day and a switch to all-day are date moves', () => {
  assert.equal(moveChange(base, { ...base, endDate: '2026-10-15T18:00:00.000Z' }), 'date');
  assert.equal(moveChange(base, { ...base, allDay: true }), 'date');
  assert.equal(moveChange({ ...base, allDay: undefined }, { ...base, allDay: false }), null);
});

test('a new place counts, spelling of case and spaces does not, removing it tells nobody', () => {
  assert.equal(moveChange(base, { ...base, location: 'Schillerpromenade 1' }), 'place');
  assert.equal(moveChange(base, { ...base, location: '  herrfurthplatz ' }), null);
  assert.equal(moveChange(base, { ...base, location: '' }), null);
  assert.equal(moveChange(base, { ...base, location: null }), null);
  assert.equal(moveChange({ ...base, location: undefined }, { ...base, location: 'Herrfurthplatz' }), 'place');
});

test('date and place together are „both"', () => {
  assert.equal(moveChange(base, { ...base, startDate: '2026-10-15T16:00:00.000Z', endDate: '2026-10-15T18:00:00.000Z', location: 'Warthestraße 5' }), 'both');
});

test('an unread older notice is folded into the new one', () => {
  assert.equal(mergeChange([], 'date'), 'date');
  assert.equal(mergeChange(['date'], 'date'), 'date');
  assert.equal(mergeChange(['date'], 'place'), 'both');
  assert.equal(mergeChange(['place'], 'date'), 'both');
  assert.equal(mergeChange(['both'], 'date'), 'both');
  assert.equal(mergeChange(['place', 'place'], 'place'), 'place');
  assert.equal(mergeChange([undefined], 'place'), 'place');
});

test('recipients: going, maybe and saved, each once, never the author, ids of any form', () => {
  const objectIdLike = { toString: () => 'u3' };
  assert.deepEqual(moveRecipients(['u1', 'author'], ['u2', 'u1'], ['u2', objectIdLike, '', null], 'author'), ['u1', 'u2', 'u3']);
  assert.deepEqual(moveRecipients([], [], [], 'author'), []);
  assert.deepEqual(moveRecipients(['author'], [], ['author'], 'author'), []);
});

test('the new time reads in Berlin time, German and English', () => {
  assert.equal(moveWhenLabel(base.startDate, base.endDate, false, 'de'), 'Mi., 14. Okt., 18:00');
  assert.equal(moveWhenLabel(base.startDate, base.endDate, false, 'en'), 'Wed 14 Oct, 18:00');
  // winter time: 18:00 Berlin = 17:00 UTC
  assert.equal(moveWhenLabel('2026-11-04T17:00:00.000Z', '2026-11-04T19:00:00.000Z', false, 'de'), 'Mi., 4. Nov., 18:00');
  // early morning keeps the leading zero
  assert.equal(moveWhenLabel('2026-10-14T07:05:00.000Z', '2026-10-14T08:00:00.000Z', false, 'de'), 'Mi., 14. Okt., 09:05');
});

test('a broken date gives an empty label instead of throwing', () => {
  assert.equal(moveWhenLabel('not a date', 'not a date', false, 'de'), '');
  assert.equal(moveWhenLabel('2026-10-14T16:00:00.000Z', '', false, 'en'), '');
});

test('all-day and multi-day events read without a clock time', () => {
  // all-day = Berlin day bounds: 00:00 → 23:59:59.999 Berlin
  assert.equal(moveWhenLabel('2026-10-13T22:00:00.000Z', '2026-10-14T21:59:59.999Z', true, 'de'), 'Mi., 14. Okt. · ganztägig');
  assert.equal(moveWhenLabel('2026-10-13T22:00:00.000Z', '2026-10-14T21:59:59.999Z', true, 'en'), 'Wed 14 Oct · all day');
  assert.equal(moveWhenLabel('2026-10-13T22:00:00.000Z', '2026-10-16T21:59:59.999Z', true, 'de'), 'Mi., 14. Okt. – Fr., 16. Okt.');
  assert.equal(moveWhenLabel('2026-10-14T16:00:00.000Z', '2026-10-15T10:00:00.000Z', false, 'en'), 'Wed 14 Oct – Thu 15 Oct');
});

test('the link opens the calendar on the new Berlin day', () => {
  assert.deepEqual(moveTarget('6abc', 'Kiezfest', '2026-10-14T16:00:00.000Z'), {
    contentType: 'event', contentId: '6abc', title: 'Kiezfest', href: '/calendar?event=6abc&d=2026-10-14',
  });
  // 23:30 UTC is already the next day in Berlin
  assert.equal(moveTarget('6abc', 'Kiezfest', '2026-10-14T23:30:00.000Z').href, '/calendar?event=6abc&d=2026-10-15');
});

test('push texts', () => {
  assert.equal(movePushBody('date', 'Kiezfest', 'Mi., 14. Okt., 18:00', 'Herrfurthplatz'), 'Termin verschoben: ‚Kiezfest‘ — neu: Mi., 14. Okt., 18:00');
  assert.equal(movePushBody('both', 'Kiezfest', 'Mi., 14. Okt., 18:00', 'Warthestraße 5'), 'Termin verschoben: ‚Kiezfest‘ — neu: Mi., 14. Okt., 18:00, Warthestraße 5');
  assert.equal(movePushBody('place', 'Kiezfest', 'Mi., 14. Okt., 18:00', 'Warthestraße 5'), 'Neuer Ort für ‚Kiezfest‘: Warthestraße 5');
  assert.equal(movePushBody(undefined, 'Kiezfest', 'Mi., 14. Okt., 18:00', ''), 'Termin verschoben: ‚Kiezfest‘ — neu: Mi., 14. Okt., 18:00');
});
```

- [ ] **Step 2: Run it to see it fail** — `npx tsx --test src/lib/calendar/eventMove.test.ts` → fails to load (`Cannot find module './eventMove'`).

- [ ] **Step 3: The types** (the rules file imports `NotificationTarget`; the new fields are used by Tasks 2–4)

```diff
diff --git a/src/types/notification.ts b/src/types/notification.ts
index ee24f69f..d32961c8 100644
--- a/src/types/notification.ts
+++ b/src/types/notification.ts
@@ -1,6 +1,6 @@
 import type { ObjectId } from 'mongodb';
 
-export type NotificationType = 'comment' | 'moderation' | 'official' | 'market_contact' | 'mention' | 'admin_hint' | 'blog' | 'forum';
+export type NotificationType = 'comment' | 'moderation' | 'official' | 'market_contact' | 'mention' | 'admin_hint' | 'blog' | 'forum' | 'event_moved';
 
 export interface NotificationTarget {
   /** The page kind the row deep-links to (mirrors the href, not necessarily
@@ -25,6 +25,13 @@ export interface NotificationMeta {
   sourceId?: string;
   /** blog + forum digest: how many posts this one notification stands for (set only when > 1). */
   count?: number;
+  /** event_moved: what the author changed, and the event's NEW time and place — the row and the
+   *  push text are built from these (see src/lib/calendar/eventMove.ts), nothing rendered is stored. */
+  change?: 'date' | 'place' | 'both';
+  startISO?: string;
+  endISO?: string;
+  allDay?: boolean;
+  place?: string;
 }
 
 /** DB shape — one doc per recipient per event. */
```

```diff
diff --git a/src/types/index.ts b/src/types/index.ts
index c476418f..21b9d51e 100644
--- a/src/types/index.ts
+++ b/src/types/index.ts
@@ -214,6 +214,14 @@ export interface Event {
   editHistory?: EditHistory[];
   isEdited?: boolean;
   lastEditedAt?: Date;
+  // „verschoben" (2026-10-06): set by the edit route when the author moved the date or time —
+  // drives the tag in the calendar; `movedFromStart` is the FIRST start („ursprünglich"). Both are
+  // unset again when the event is moved back to that start.
+  movedAt?: Date;
+  movedFromStart?: Date;
+  // A move whose edit the moderation held back: the people who plan to come are told when the
+  // admin approves it (processReviewAction), then the field is unset.
+  moveNoticeOwed?: 'date' | 'place' | 'both';
   // Moderation fields
   moderationStatus?: 'approved' | 'pending' | 'rejected';
   isUserReported?: boolean;
@@ -225,6 +233,13 @@ export interface Event {
   updatedAt?: Date;
 }
 
+/** What „kopieren" carries from an event into the create form — content only: no date is kept,
+ *  and nothing that belongs to the old event (answers, likes, saves, moderation state). */
+export type EventCopySource = Pick<
+  Event,
+  'title' | 'body' | 'category' | 'startDate' | 'endDate' | 'allDay' | 'location' | 'capacity' | 'visibility' | 'tags'
+>;
+
 // News Types (Newsboard)
 export interface NewsItem {
   _id?: ObjectId | string;
```

- [ ] **Step 4: The rules**

`src/lib/calendar/eventMove.ts`:

```ts
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
const placeOf = (s: string | null | undefined): string => (s ?? '').trim().replace(/\s+/g, ' ');

/**
 * What an edit changed for the people who plan to come — `null` when nothing they need to know.
 * „date" = the start moved (by the minute), the last DAY moved (Berlin), or timed ↔ all-day; an
 * end TIME that only got longer or shorter is not a move, and all-day events are compared by
 * their days, never by their stored instants. „place" = a new, non-empty place (case and spacing
 * ignored); removing the place tells nobody.
 */
export function moveChange(before: MoveFacts, after: MoveFacts): MoveChange | null {
  const date =
    !!before.allDay !== !!after.allDay ||
    (after.allDay
      ? allDayDays(before) !== allDayDays(after)
      : minuteOf(before.startDate) !== minuteOf(after.startDate) || berlinDayOf(before.endDate) !== berlinDayOf(after.endDate));
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
 * A member keeps ONE unread row per event, and it must tell the whole story: when an older notice
 * about the same event is still unread, the new one replaces it — and says „both" unless the two
 * are about the same thing (the row always prints the event's CURRENT time and place).
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

/** „Mi., 14. Okt., 18:00" · „Mi., 14. Okt. · ganztägig" · „Mi., 14. Okt. – Fr., 16. Okt." (Berlin time). */
export function moveWhenLabel(startISO: Instant, endISO: Instant, allDay: boolean, locale: MoveLocale): string {
  // a broken date must cost the row its time, never the whole bell panel (Intl throws on it)
  if (!Number.isFinite(ms(startISO)) || !Number.isFinite(ms(endISO))) return '';
  const first = dayLabel(startISO, locale);
  if (berlinDayOf(startISO) !== berlinDayOf(endISO)) return `${first} – ${dayLabel(endISO, locale)}`;
  if (allDay) return `${first} · ${locale === 'en' ? 'all day' : 'ganztägig'}`;
  const p = berlinParts(startISO);
  return `${first}, ${p.hh}:${p.mm}`;
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
```

- [ ] **Step 5: Run the test** — `npx tsx --test src/lib/calendar/eventMove.test.ts` → `ℹ tests 14` / `ℹ pass 14`.

- [ ] **Step 6: The texts** (German block first, English block second; all drafts)

```diff
diff --git a/src/lib/kiosk-i18n.ts b/src/lib/kiosk-i18n.ts
index 65648d13..17c316df 100644
--- a/src/lib/kiosk-i18n.ts
+++ b/src/lib/kiosk-i18n.ts
@@ -142,6 +142,9 @@ const de = {
   'nc.time.d': 'vor {n} Tg.',
   'nc.forum.one': 'Neu im Forum: ‚{title}‘',
   'nc.forum.many': '{n} neue Beiträge im Forum',
+  'nc.event.moved.date': '{actor} hat ‚{title}‘ verschoben — neu: {when}',
+  'nc.event.moved.place': '{actor} hat den Ort von ‚{title}‘ geändert — neu: {place}',
+  'nc.event.moved.both': '{actor} hat ‚{title}‘ verschoben — neu: {when}, {place}',
   'nc.forumNotify.label': 'Neue Forumsbeiträge',
   'nc.forumNotify.digest': 'täglich',
   'nc.forumNotify.each': 'jeden',
@@ -644,6 +647,9 @@ const de = {
   'cal.compose.field.allDay': 'ganztägig',
   'cal.compose.clip.miss': 'Kein Datum erkannt — bitte Datum und Uhrzeit prüfen.',
   'cal.compose.field.multiDay': 'mehrtägig',
+  'cal.compose.move.hint': 'Änderst du Datum, Uhrzeit oder Ort, sagen wir allen Bescheid, die zugesagt oder den Termin gespeichert haben.',
+  'cal.moved.label': 'verschoben',
+  'cal.moved.from': 'ursprünglich {when}',
   'cal.compose.field.endDate': 'Datum bis',
   'cal.compose.field.capacity': 'Max Personen',
   'cal.compose.field.titleHint': '{n} / 80 Zeichen',
@@ -716,6 +722,9 @@ const de = {
   'detail.edit.label': 'bearbeiten',
   'detail.edit.tooltip': 'Termin bearbeiten',
   'cal.detail.delete.label': 'löschen',
+  'cal.detail.copy.label': 'kopieren',
+  'cal.detail.copy.tooltip': 'Als neuen Termin an einem anderen Datum anlegen',
+  'cal.compose.copy.notice': 'Kopie von „{title}“ — wähle unten das neue Datum. Zusagen des alten Termins werden nicht übernommen.',
   'cal.detail.delete.title': 'Termin löschen',
   'cal.detail.delete.confirm': 'Diesen Termin endgültig löschen? Das kann nicht rückgängig gemacht werden.',
   'cal.detail.delete.cta': 'Endgültig löschen',
@@ -2273,6 +2282,9 @@ const en: Dict = {
   'nc.time.d': '{n} d ago',
   'nc.forum.one': 'New in the forum: ‘{title}’',
   'nc.forum.many': '{n} new posts in the forum',
+  'nc.event.moved.date': '{actor} moved ‘{title}’ — new: {when}',
+  'nc.event.moved.place': '{actor} changed the place of ‘{title}’ — new: {place}',
+  'nc.event.moved.both': '{actor} moved ‘{title}’ — new: {when}, {place}',
   'nc.forumNotify.label': 'New forum posts',
   'nc.forumNotify.digest': 'daily',
   'nc.forumNotify.each': 'each one',
@@ -2744,6 +2756,9 @@ const en: Dict = {
   'cal.compose.field.allDay': 'all-day',
   'cal.compose.clip.miss': 'No date recognised — please check date and time.',
   'cal.compose.field.multiDay': 'multi-day',
+  'cal.compose.move.hint': 'If you change the date, time or place, we tell everyone who said they are coming or saved the event.',
+  'cal.moved.label': 'moved',
+  'cal.moved.from': 'originally {when}',
   'cal.compose.field.endDate': 'End date',
   'cal.compose.field.capacity': 'Capacity',
   'cal.compose.field.titleHint': '{n} / 80 chars',
@@ -2816,6 +2831,9 @@ const en: Dict = {
   'detail.edit.label': 'edit',
   'detail.edit.tooltip': 'Edit event',
   'cal.detail.delete.label': 'delete',
+  'cal.detail.copy.label': 'copy',
+  'cal.detail.copy.tooltip': 'Create a new event from this one on another date',
+  'cal.compose.copy.notice': 'Copy of “{title}” — pick the new date below. Replies to the old event are not carried over.',
   'cal.detail.delete.title': 'Delete event',
   'cal.detail.delete.confirm': 'Delete this event for good? This cannot be undone.',
   'cal.detail.delete.cta': 'Delete for good',
```

- [ ] **Step 7: Gates** — `pnpm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → `tests 436`, `pass 436`, `fail 0`; `pnpm type-check 2>&1 | grep -c "error TS"` → `16`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/calendar/eventMove.ts src/lib/calendar/eventMove.test.ts src/types/notification.ts src/types/index.ts src/lib/kiosk-i18n.ts
git commit -m "feat: calendar — rules, types and texts for moved and copied events"
```

---

### Task 2: Tell the people who plan to come

**Files:**
- Create: `src/lib/calendar/eventMoveNotify.ts`
- Modify: `src/lib/notifications.ts`, `src/lib/push.ts`, `src/lib/reviewAction.ts`, `src/pages/api/events/edit/[id].ts`

**Interfaces:**
- Consumes from Task 1: `moveChange`, `originalStart`, `mergeChange`, `moveRecipients`, `moveTarget`, `movePushBody`, `moveWhenLabel`, `MoveChange`; the `event_moved` type and its `meta` fields; `Event.movedAt`, `.movedFromStart`, `.moveNoticeOwed`.
- Consumes (already on main): `NotifyInput`, `capture()`, `buildPushPayload`, `sendPushToUsers` in `src/lib/notifications.ts` / `src/lib/push.ts`; `consumeRateLimit(baseKey, max, windowMs)` from `src/lib/auth/rateLimit.ts`; `processReviewAction()` in `src/lib/reviewAction.ts`; collection `savedEvents` (`{ userId, eventId }`, both strings).
- Produces:
  - `notifyUsers(userIds: string[], input: Omit<NotifyInput, 'userId'>, opts?: { push?: boolean }): Promise<void>` (`src/lib/notifications.ts`, never throws; `push: false` writes the rows without a web push)
  - `tellAboutMove(db: Db, event, change: MoveChange, authorId: string): Promise<number>` and `sendOwedMoveNotice(db: Db, flagged: Pick<FlaggedContent, 'contentType' | 'contentId'>): Promise<void>` (`src/lib/calendar/eventMoveNotify.ts`, server-only, never throw)

These modules import Sentry and the database, so they have no unit test; they are exercised end to end by the browser probe in Task 5 (rules they call are tested in Task 1).

- [ ] **Step 1: One notification each for a known list of members**

```diff
diff --git a/src/lib/notifications.ts b/src/lib/notifications.ts
index 81ea5331..678f4963 100644
--- a/src/lib/notifications.ts
+++ b/src/lib/notifications.ts
@@ -58,6 +58,22 @@ export async function notify(input: NotifyInput): Promise<void> {
   }
 }
 
+/** One notification each for a known list of members (event moved). The actor is skipped.
+ *  `push: false` writes the bell rows without ringing phones (the caller's flood brake). */
+export async function notifyUsers(userIds: string[], input: Omit<NotifyInput, 'userId'>, opts: { push?: boolean } = {}): Promise<void> {
+  try {
+    const ids = [...new Set(userIds)].filter((id) => id && id !== input.actorId);
+    if (!ids.length) return;
+    const db = await connectDB();
+    const now = new Date();
+    const docs: NotificationDoc[] = ids.map((userId) => ({ userId, ...input, createdAt: now, readAt: null }));
+    await db.collection<NotificationDoc>('notifications').insertMany(docs, { ordered: false });
+    if (opts.push !== false) await sendPushToUsers(ids, buildPushPayload(input.type, input.target, input.meta));
+  } catch (err) {
+    await capture(err);
+  }
+}
+
 /** Broadcast to every member (all non-anonymized users) except the actor. */
 export async function notifyAllMembers(input: Omit<NotifyInput, 'userId'>): Promise<void> {
   try {
```

- [ ] **Step 2: The German push text**

```diff
diff --git a/src/lib/push.ts b/src/lib/push.ts
index 65c08328..c01ac1f2 100644
--- a/src/lib/push.ts
+++ b/src/lib/push.ts
@@ -16,6 +16,7 @@ import webpush from 'web-push';
 import * as Sentry from '@sentry/astro';
 import { connectDB } from './mongodb';
 import type { NotificationMeta, NotificationTarget, NotificationType } from '../types/notification';
+import { movePushBody, moveWhenLabel } from './calendar/eventMove';
 
 export interface PushPayload {
   title: string;
@@ -82,6 +83,11 @@ export function buildPushPayload(
         ? `${meta?.count} neue Beitr\u00e4ge im Forum`
         : `Neu im Forum: \u201a${t}\u2018`;
       break;
+    case 'event_moved': {
+      const when = meta?.startISO ? moveWhenLabel(meta.startISO, meta.endISO ?? meta.startISO, meta.allDay === true, 'de') : '';
+      body = movePushBody(meta?.change, t, when, meta?.place ?? '');
+      break;
+    }
     case 'moderation': {
       const noun = meta?.contentKind === 'comment' ? 'Kommentar' : 'Beitrag';
       if (meta?.outcome === 'rejected') body = `Dein ${noun} wurde abgelehnt — Details in deinem Profil`;
```

- [ ] **Step 3: The sender** — who is concerned, the replace-unread rule, the push brake, the owed notice

`src/lib/calendar/eventMoveNotify.ts`:

```ts
// src/lib/calendar/eventMoveNotify.ts — SERVER-ONLY (mongodb, notifications, rate limits).
// Tells the people who plan to come that an event moved. Rules and wording live in the pure
// ./eventMove.ts; this file only reads who is concerned and sends. NEVER-THROW, like every
// notification write: a failed notice must not fail the author's edit or the admin's review.
import { ObjectId, type Db } from 'mongodb';
import * as Sentry from '@sentry/astro';
import { notifyUsers } from '../notifications';
import { consumeRateLimit } from '../auth/rateLimit';
import { mergeChange, moveRecipients, moveTarget, type MoveChange } from './eventMove';
import type { FlaggedContent } from '../../types';

/** Phones are rung for the first three moves of an event per hour; the bell row is ALWAYS written. */
const MOVE_PUSHES_PER_HOUR = 3;

interface MovedEvent {
  _id: unknown;
  title?: string;
  startDate: Date | string;
  endDate: Date | string;
  allDay?: boolean;
  location?: string;
  rsvps?: { going?: unknown[]; maybe?: unknown[] };
}

/**
 * Sends the notice; returns how many members were told. EVERY move reaches the bell — a move that
 * is saved but not shown would leave people with a wrong date. Two things keep an author who
 * corrects (or abuses) the date from flooding people: a member's older UNREAD notice about the
 * same event is removed and folded into the new one (mergeChange), so the bell holds one unread
 * row per event with the CURRENT time and place; and the PUSH is sent for the first
 * MOVE_PUSHES_PER_HOUR moves of an event per hour only — after that the row still updates, silently.
 */
export async function tellAboutMove(db: Db, event: MovedEvent, change: MoveChange, authorId: string): Promise<number> {
  try {
    const eventId = String(event._id);
    const saved = await db.collection('savedEvents').find({ eventId }, { projection: { userId: 1 } }).toArray();
    const recipients = moveRecipients(event.rsvps?.going ?? [], event.rsvps?.maybe ?? [], saved.map((s) => s.userId), authorId);
    if (!recipients.length) return 0;

    const rows = db.collection('notifications');
    const unread = await rows
      .find({ type: 'event_moved', 'target.contentId': eventId, userId: { $in: recipients }, readAt: null }, { projection: { userId: 1, 'meta.change': 1 } })
      .toArray();
    if (unread.length) await rows.deleteMany({ _id: { $in: unread.map((u) => u._id) } });

    const startISO = new Date(event.startDate).toISOString();
    const base = {
      startISO,
      endISO: new Date(event.endDate).toISOString(),
      allDay: event.allDay === true,
      ...(event.location ? { place: String(event.location) } : {}),
    };
    // The brake counts moves, not members; a bucket failure keeps the phones quiet, never the bell.
    const brake = await consumeRateLimit(`eventmove:${eventId}`, MOVE_PUSHES_PER_HOUR, 60 * 60 * 1000).catch(() => ({ limited: true }));
    // One send per wording (at most three): members with an unread older notice may get „both".
    const byChange = new Map<MoveChange, string[]>();
    for (const userId of recipients) {
      const merged = mergeChange(unread.filter((u) => u.userId === userId).map((u) => u.meta?.change as MoveChange | undefined), change);
      byChange.set(merged, [...(byChange.get(merged) ?? []), userId]);
    }
    for (const [merged, userIds] of byChange) {
      await notifyUsers(userIds, {
        type: 'event_moved',
        actorId: authorId,
        target: moveTarget(eventId, String(event.title ?? ''), startISO),
        meta: { change: merged, ...base },
      }, { push: !brake.limited });
    }
    return recipients.length;
  } catch (err) {
    console.error('[eventMove] notice failed:', err);
    try {
      Sentry.captureException(err);
      await Sentry.flush(2000);
    } catch {
      /* best-effort */
    }
    return 0;
  }
}

/**
 * An edit that moved the event was held back by the moderation: nobody could see the event, so
 * nobody was told. Called when the admin approves — claims the owed notice (unset-and-read in one
 * step, so two parallel reviews send it once) and sends it with the event's CURRENT time and place.
 */
export async function sendOwedMoveNotice(db: Db, flagged: Pick<FlaggedContent, 'contentType' | 'contentId'>): Promise<void> {
  try {
    if (flagged.contentType !== 'event' || !flagged.contentId || !ObjectId.isValid(String(flagged.contentId))) return;
    const event = await db.collection('events').findOneAndUpdate(
      { _id: new ObjectId(String(flagged.contentId)), moveNoticeOwed: { $in: ['date', 'place', 'both'] } },
      { $unset: { moveNoticeOwed: '' } },
      { returnDocument: 'before' },
    );
    if (!event) return;
    await tellAboutMove(db, event as unknown as MovedEvent, event.moveNoticeOwed as MoveChange, String(event.author));
  } catch (err) {
    console.error('[eventMove] owed notice failed:', err);
  }
}
```

- [ ] **Step 4: The edit route** — decide before the update, stamp „verschoben" with the FIRST start (or unset it when the event is back there), send after the update (or owe the notice when the edit is held)

```diff
diff --git a/src/pages/api/events/edit/[id].ts b/src/pages/api/events/edit/[id].ts
index 67a61d19..f78f50e9 100644
--- a/src/pages/api/events/edit/[id].ts
+++ b/src/pages/api/events/edit/[id].ts
@@ -13,6 +13,8 @@ import {
 } from '../../../../lib/moderation';
 import { requireMemberSession } from '../../../../lib/auth';
 import { alertModerationFlagged } from '../../../../lib/adminAlerts';
+import { moveChange, originalStart } from '../../../../lib/calendar/eventMove';
+import { tellAboutMove } from '../../../../lib/calendar/eventMoveNotify';
 
 export const PUT: APIRoute = async ({ request, params }) => {
   try {
@@ -126,13 +128,35 @@ export const PUT: APIRoute = async ({ request, params }) => {
       updateFields.rejectionReason = null;
     }
 
+    // „Termin verschoben": did this edit change when or where? (pure rules: lib/calendar/eventMove.ts)
+    const moved = moveChange(existingEvent, {
+      startDate: updateFields.startDate ?? existingEvent.startDate,
+      endDate: updateFields.endDate ?? existingEvent.endDate,
+      allDay: allDay ?? existingEvent.allDay,
+      location: location ?? existingEvent.location
+    });
+    // The tag names the FIRST start as „ursprünglich"; an event moved back to it loses the tag.
+    let backAtOriginal = false;
+    if (moved === 'date' || moved === 'both') {
+      const original = originalStart(existingEvent, updateFields.startDate ?? existingEvent.startDate);
+      if (original) {
+        updateFields.movedAt = new Date();
+        updateFields.movedFromStart = original;
+      } else {
+        backAtOriginal = true;
+      }
+    }
+    // A held edit hides the event, so the notice waits for the admin's approval.
+    if (moved && mergedResult) updateFields.moveNoticeOwed = moved;
+
     const updateResult = await eventsCollection.findOneAndUpdate(
       { _id: new ObjectId(eventId) },
       {
         $set: updateFields,
         $push: {
           editHistory: editHistoryEntry
-        }
+        },
+        ...(backAtOriginal ? { $unset: { movedAt: '', movedFromStart: '' } } : {})
       },
       { returnDocument: 'after' }
     );
@@ -144,6 +168,12 @@ export const PUT: APIRoute = async ({ request, params }) => {
       });
     }
 
+    // Everyone who answered or saved the event hears about the move (never throws; a held edit
+    // is announced on approval instead).
+    if (moved && !mergedResult) {
+      await tellAboutMove(db, updateResult, moved, userId);
+    }
+
     // Write a new flagged content record so the admin queue surfaces the edit.
     if (mergedResult) {
       const flaggedCollection = db.collection<FlaggedContent>('flaggedContent');
```

- [ ] **Step 5: The approval hook**

```diff
diff --git a/src/lib/reviewAction.ts b/src/lib/reviewAction.ts
index 980b9736..7bdbaf08 100644
--- a/src/lib/reviewAction.ts
+++ b/src/lib/reviewAction.ts
@@ -9,6 +9,7 @@ import { notify, commentTarget, moderationTarget } from './notifications';
 import { notifyMentionsOnApproval } from './mentions/mentionsStore';
 import { notifyForumSubscribersOnApproval } from './forum/forumNotify';
 import { invalidateKiezKontext } from './kiez/kontext';
+import { sendOwedMoveNotice } from './calendar/eventMoveNotify';
 
 const MAX_STRIKES = 3;
 
@@ -171,6 +172,9 @@ export async function processReviewAction(
       await notifyMentionsOnApproval(db, flaggedContent);
       // „Every new forum post" members hear about a held post now (never throws).
       await notifyForumSubscribersOnApproval(flaggedContent, hasWarning);
+      // An event whose move was held back with its edit: the people who plan to come hear it now
+      // (at most once, never throws — see src/lib/calendar/eventMoveNotify.ts).
+      await sendOwedMoveNotice(db, flaggedContent);
     }
 
     // Handle strike system on rejection
```

- [ ] **Step 6: Gates** — `pnpm type-check 2>&1 | grep -c "error TS"` → `16`; `pnpm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → `tests 436`, `pass 436`, `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/calendar/eventMoveNotify.ts src/lib/notifications.ts src/lib/push.ts src/lib/reviewAction.ts "src/pages/api/events/edit/[id].ts"
git commit -m "feat: calendar — a moved event tells everyone who answered or saved it"
```

---

### Task 3: The bell row, the „verschoben" tag and the form

**Files:**
- Create: `src/components/calendar/kiosk/MovedTag.svelte`
- Modify: `src/components/forum/kiosk/NotificationPanel.svelte`, `src/components/calendar/kiosk/AgendaRow.svelte`, `src/components/calendar/kiosk/mobile/CalendarMobileMonth.svelte`, `src/components/calendar/kiosk/EventDetailModal.svelte`, `src/components/calendar/kiosk/compose/EventComposeForm.svelte`, `src/components/calendar/kiosk/compose/EventComposePreview.svelte`

**Interfaces:**
- Consumes from Task 1: `moveWhenLabel`; the texts `nc.event.moved.*`, `cal.moved.label`, `cal.moved.from`, `cal.compose.move.hint`, `cal.detail.copy.label`, `cal.detail.copy.tooltip`; `Event.movedAt`, `.movedFromStart`; the `event_moved` meta fields.
- Produces:
  - `MovedTag.svelte` — props `invert?: boolean` (paper on the dark „today" block), `size?: 'sm' | 'md'`; renders `[data-moved-tag]`.
  - `EventComposeForm` prop `initialMultiDay?: boolean` (used by Task 4).
  - DOM hooks the probe relies on: `[data-moved-tag]`, `[data-moved-from]`, `[data-move-hint]`, `[data-event-copy]`, `[data-ev-field="title|date|start|end|endDate|allDay|multiDay|location|body|capacity"]`, `[data-ev-publish]`.
- The copy link (`/events/create?copy=<id>`) is rendered here; the page understands the parameter after Task 4.

- [ ] **Step 1: The tag**

`src/components/calendar/kiosk/MovedTag.svelte`:

```svelte
<script lang="ts">
  // „verschoben" — shown on an event whose author moved the date or time (events.movedAt,
  // set by /api/events/edit). Tailwind classes only: this component is reachable only through
  // other islands, so a scoped <style> would be orphaned in the production build.
  import { t } from '../../../lib/kiosk-i18n';

  let { invert = false, size = 'sm' }: { invert?: boolean; size?: 'sm' | 'md' } = $props();
</script>

<span
  data-moved-tag
  class={`inline-flex items-center gap-1 rounded-[3px] border font-dmmono font-semibold uppercase tracking-[0.08em] whitespace-nowrap ${
    size === 'md' ? 'px-2 py-0.5 text-[10.5px]' : 'px-[5px] py-px text-[9.5px]'
  } ${invert ? 'text-paper border-paper/70' : 'text-ink border-ink'}`}
>
  <span aria-hidden="true">↦</span>{$t['cal.moved.label']}
</span>
```

- [ ] **Step 2: The bell row** (glyph ↦ in ink; the row is built from `meta`, never from stored text)

```diff
diff --git a/src/components/forum/kiosk/NotificationPanel.svelte b/src/components/forum/kiosk/NotificationPanel.svelte
index 7a41576b..098921ae 100644
--- a/src/components/forum/kiosk/NotificationPanel.svelte
+++ b/src/components/forum/kiosk/NotificationPanel.svelte
@@ -3,7 +3,8 @@
   // Structural sibling of AvatarMenu.svelte (outside-click a tick late,
   // Escape, dual html+body scroll-lock on mobile) with ONE deliberate
   // deviation per CD's motion spec: close is INSTANT — no 140ms exit fade.
-  import { t, tStr } from '../../../lib/kiosk-i18n';
+  import { t, tStr, locale } from '../../../lib/kiosk-i18n';
+  import { moveWhenLabel } from '../../../lib/calendar/eventMove';
   import type { NotificationItem } from '../../../types/notification';
   import { detectPushState, subscribeToPush, unsubscribeFromPush, type PushUiState } from '../../../lib/pushClient';
   import { showError } from '../../../utils/toast';
@@ -223,6 +224,7 @@
     blog: { g: '¶', c: 'var(--k-rust, #a3552e)' },
     forum: { g: '✦', c: 'var(--k-wine, #b23a5b)' },
     admin_hint: { g: '!', c: 'var(--k-plum, #6f2f59)' },
+    event_moved: { g: '↦', c: 'var(--k-ink)' },
   };
 
   function rowText(it: NotificationItem): string {
@@ -250,6 +252,14 @@
         const n = it.meta?.count ?? 1;
         return n > 1 ? tStr($t['nc.forum.many'], { n: String(n) }) : tStr($t['nc.forum.one'], { title });
       }
+      case 'event_moved': {
+        const actor = it.actorName ?? $t['nc.tombstone'];
+        const m = it.meta ?? {};
+        const when = m.startISO ? moveWhenLabel(m.startISO, m.endISO ?? m.startISO, m.allDay === true, $locale === 'en' ? 'en' : 'de') : '';
+        const place = m.place ?? '';
+        const key = m.change === 'place' && place ? 'nc.event.moved.place' : m.change === 'both' && place ? 'nc.event.moved.both' : 'nc.event.moved.date';
+        return tStr($t[key], { actor, title, when, place });
+      }
       case 'market_contact':
         return tStr($t['nc.market'], { title });
       case 'moderation': {
```

- [ ] **Step 3: The tag in the agenda/day rows** (the „today" variant on the dark block is inverted)

```diff
diff --git a/src/components/calendar/kiosk/AgendaRow.svelte b/src/components/calendar/kiosk/AgendaRow.svelte
index e95a6e30..6e2697b3 100644
--- a/src/components/calendar/kiosk/AgendaRow.svelte
+++ b/src/components/calendar/kiosk/AgendaRow.svelte
@@ -15,6 +15,7 @@
   import StatusBadge from '../../forum/kiosk/StatusBadge.svelte';
   import type { Event as EventDoc, EventCategory } from '../../../types';
   import NewMark from '../../forum/kiosk/NewMark.svelte';
+  import MovedTag from './MovedTag.svelte';
 
   let {
     ev,
@@ -165,6 +166,7 @@
             {span} {$t['cal.span.days']}
           </span>
         {/if}
+        {#if ev.movedAt}<MovedTag invert />{/if}
         {#if inferredBadge}
           <StatusBadge state={inferredBadge} size="sm" />
         {/if}
@@ -263,6 +265,7 @@
             {span} {$t['cal.span.days']}
           </span>
         {/if}
+        {#if ev.movedAt}<MovedTag />{/if}
         {#if inferredBadge}
           <StatusBadge state={inferredBadge} size="sm" />
         {/if}
```

- [ ] **Step 4: The tag in the phone month's day list**

```diff
diff --git a/src/components/calendar/kiosk/mobile/CalendarMobileMonth.svelte b/src/components/calendar/kiosk/mobile/CalendarMobileMonth.svelte
index dba99da8..c9a104af 100644
--- a/src/components/calendar/kiosk/mobile/CalendarMobileMonth.svelte
+++ b/src/components/calendar/kiosk/mobile/CalendarMobileMonth.svelte
@@ -40,6 +40,7 @@
   import type { EventCategory, Event as EventDoc } from '../../../../types';
   import DragSelectPin from '../DragSelectPin.svelte';
   import StatusBadge from '../../../forum/kiosk/StatusBadge.svelte';
+  import MovedTag from '../MovedTag.svelte';
 
   // Moderation badge precedence — same as forum cards.
   function inferBadge(ev: EventDoc) {
@@ -653,6 +654,7 @@
                   <span class="font-bricolage font-bold text-[13px] leading-[1.2] truncate">
                     {ev.title}
                   </span>
+                  {#if ev.movedAt}<MovedTag />{/if}
                   {#if badge}
                     <StatusBadge state={badge} size="sm" />
                   {/if}
```

- [ ] **Step 5: The detail view** — tag, „ursprünglich …", and the author's „kopieren" link

```diff
diff --git a/src/components/calendar/kiosk/EventDetailModal.svelte b/src/components/calendar/kiosk/EventDetailModal.svelte
index c736dd7f..20a9f099 100644
--- a/src/components/calendar/kiosk/EventDetailModal.svelte
+++ b/src/components/calendar/kiosk/EventDetailModal.svelte
@@ -24,6 +24,7 @@
   import MemberTypeTag from '../../forum/kiosk/MemberTypeTag.svelte';
   import KioskBtn from '../../forum/kiosk/KioskBtn.svelte';
   import StatusBadge from '../../forum/kiosk/StatusBadge.svelte';
+  import MovedTag from './MovedTag.svelte';
   import OwnStatusBanner from '../../forum/kiosk/states/OwnStatusBanner.svelte';
   import KioskReportModal from '../../forum/kiosk/KioskReportModal.svelte';
 
@@ -31,6 +32,7 @@
   import { generateGoogleCalendarUrl, downloadIcsFile } from '../../../utils/calendarExport';
   import { confirmAction, showError } from '../../../utils/toast';
   import { isLiveNow } from '../../../lib/calendar/eventTime';
+  import { moveWhenLabel } from '../../../lib/calendar/eventMove';
   import { now } from '../../../lib/calendar/nowTicker';
   import { t, tStr, locale } from '../../../lib/kiosk-i18n';
   import { createUserProfilesQuery } from '../../../lib/userProfilesQueries';
@@ -119,6 +121,13 @@
     return null;
   });
 
+  // „verschoben": the start before the author's latest move, for the line under the new time.
+  const movedFromLabel = $derived(
+    event?.movedAt && event?.movedFromStart
+      ? moveWhenLabel(event.movedFromStart as any, event.movedFromStart as any, !!event.allDay, $locale === 'en' ? 'en' : 'de')
+      : null
+  );
+
   // Edit allowed only when the event is approved and not warning-labelled
   // — mirrors the API gate at /api/events/edit/[id].ts and the forum's
   // canEdit derive at ForumPostDetail.svelte:516-535.
@@ -392,6 +401,7 @@
               <span class="text-[10px] tracking-[0.08em]">{($t['cal.team'] as string)?.toUpperCase()}</span>
             {/if}
           </div>
+          {#if event.movedAt}<MovedTag size="md" />{/if}
           {#if inferredBadge}
             <StatusBadge state={inferredBadge} size="md" />
           {/if}
@@ -438,6 +448,11 @@
                 </span>
               {/if}
             </div>
+            {#if movedFromLabel}
+              <div class="font-dmmono text-[11px] text-ink-mute mt-0.5" data-moved-from>
+                {tStr($t['cal.moved.from'] as string, { when: movedFromLabel })}
+              </div>
+            {/if}
           </div>
 
           {#if event.location}
@@ -669,6 +684,16 @@
                 >
                   🗑 {$t['cal.detail.delete.label']}
                 </button>
+                {#if event.moderationStatus !== 'rejected'}
+                  <a
+                    href={`/events/create?copy=${event._id}`}
+                    title={$t['cal.detail.copy.tooltip'] as string}
+                    class="hover:text-wine"
+                    data-event-copy
+                  >
+                    ❐ {$t['cal.detail.copy.label']}
+                  </a>
+                {/if}
                 <a
                   href={canEdit ? `/events/edit/${event._id}` : undefined}
                   title={canEdit ? $t['detail.edit.tooltip'] : $t['detail.edit.blocked']}
```

- [ ] **Step 6: The form** — the `initialMultiDay` prop, the edit-mode hint, the field hooks

```diff
diff --git a/src/components/calendar/kiosk/compose/EventComposeForm.svelte b/src/components/calendar/kiosk/compose/EventComposeForm.svelte
index 2d52d1d7..be229ef2 100644
--- a/src/components/calendar/kiosk/compose/EventComposeForm.svelte
+++ b/src/components/calendar/kiosk/compose/EventComposeForm.svelte
@@ -33,11 +33,14 @@
 
   let {
     initialValues,
+    initialMultiDay,
     onChange,
     showBreadcrumb = false,
     editing = false
   } = $props<{
     initialValues?: Partial<EventComposeValues>;
+    /** „kopieren" opens without dates, so the several-days state cannot be read from them. */
+    initialMultiDay?: boolean;
     onChange: (v: EventComposeValues) => void;
     showBreadcrumb?: boolean;
     editing?: boolean;
@@ -99,9 +102,10 @@
   // 'mehrtägig' checkbox in the When section.
   // svelte-ignore state_referenced_locally
   let multiDay = $state(
-    !!(initialValues?.startDate &&
-      initialValues?.endDate &&
-      initialValues.startDate !== initialValues.endDate)
+    initialMultiDay ??
+      !!(initialValues?.startDate &&
+        initialValues?.endDate &&
+        initialValues.startDate !== initialValues.endDate)
   );
 
   // Single source of truth for date sync. Reactive on multiDay,
@@ -225,7 +229,7 @@
     </div>
     <input
       type="text"
-      bind:value={title}
+      bind:value={title} data-ev-field="title"
       maxlength="80"
       placeholder={$t['cal.compose.field.title.placeholder']}
       class="w-full min-h-[44px] appearance-none bg-paper-warm border-[1.5px] border-ink rounded-md px-3 py-2 font-bricolage text-[15px] text-ink placeholder:text-ink-mute/55 outline-none focus:border-wine"
@@ -253,7 +257,7 @@
         </span>
         <input
           type="date"
-          bind:value={startDate}
+          bind:value={startDate} data-ev-field="date"
           class="w-full min-h-[44px] appearance-none bg-paper border border-ink rounded-sm px-3 py-1.5 font-bricolage text-[14px]"
         />
       </label>
@@ -263,7 +267,7 @@
         </span>
         <input
           type="time"
-          bind:value={startTime}
+          bind:value={startTime} data-ev-field="start"
           disabled={allDay}
           class="w-full min-h-[44px] appearance-none bg-paper border border-ink rounded-sm px-3 py-1.5 font-bricolage text-[14px] disabled:opacity-50"
         />
@@ -274,7 +278,7 @@
         </span>
         <input
           type="time"
-          bind:value={endTime}
+          bind:value={endTime} data-ev-field="end"
           disabled={allDay}
           class="w-full min-h-[44px] appearance-none bg-paper border border-ink rounded-sm px-3 py-1.5 font-bricolage text-[14px] disabled:opacity-50"
         />
@@ -287,7 +291,7 @@
         </span>
         <input
           type="date"
-          bind:value={endDate}
+          bind:value={endDate} data-ev-field="endDate"
           min={startDate}
           class="w-full min-h-[44px] appearance-none bg-paper border border-ink rounded-sm px-3 py-1.5 font-bricolage text-[14px]"
         />
@@ -296,14 +300,19 @@
 
     <div class="flex gap-3.5 mt-2 font-dmmono text-[11px] text-ink-mute">
       <label class="inline-flex items-center gap-1">
-        <input type="checkbox" bind:checked={allDay} />
+        <input type="checkbox" bind:checked={allDay} data-ev-field="allDay" />
         {$t['cal.compose.field.allDay']}
       </label>
       <label class="inline-flex items-center gap-1">
-        <input type="checkbox" bind:checked={multiDay} />
+        <input type="checkbox" bind:checked={multiDay} data-ev-field="multiDay" />
         {$t['cal.compose.field.multiDay']}
       </label>
     </div>
+    {#if editing}
+      <p class="mt-2 font-instrument italic text-[12.5px] leading-snug text-ink-mute" data-move-hint>
+        {$t['cal.compose.move.hint']}
+      </p>
+    {/if}
   </div>
 
   <!-- 04 · Where -->
@@ -318,7 +327,7 @@
     </div>
     <input
       type="text"
-      bind:value={location}
+      bind:value={location} data-ev-field="location"
       maxlength="200"
       placeholder={$t['cal.compose.field.location.placeholder']}
       class="w-full min-h-[44px] appearance-none bg-paper-warm border-[1.5px] border-ink rounded-md px-3 py-2 font-bricolage text-[14px] text-ink placeholder:text-ink-mute/55 outline-none focus:border-wine"
@@ -337,7 +346,7 @@
       <span class="font-bricolage text-[14px] font-bold text-wine" aria-hidden="true">*</span>
     </div>
     <textarea
-      bind:value={body}
+      bind:value={body} data-ev-field="body"
       rows="5"
       maxlength="5000"
       placeholder={$t['cal.compose.field.body.placeholder']}
@@ -364,7 +373,7 @@
           type="number"
           min="1"
           max="10000"
-          bind:value={capacity}
+          bind:value={capacity} data-ev-field="capacity"
           placeholder={$t['cal.compose.field.capacity.placeholder']}
           class="w-full min-h-[44px] appearance-none bg-paper border border-ink rounded-sm px-3 py-1.5 font-bricolage text-[14px]"
         />
```

```diff
diff --git a/src/components/calendar/kiosk/compose/EventComposePreview.svelte b/src/components/calendar/kiosk/compose/EventComposePreview.svelte
index aa16fe87..71c4fd2f 100644
--- a/src/components/calendar/kiosk/compose/EventComposePreview.svelte
+++ b/src/components/calendar/kiosk/compose/EventComposePreview.svelte
@@ -67,6 +67,7 @@
         type="button"
         onclick={onPublish}
         disabled={submitting}
+        data-ev-publish
         class="inline-flex items-center px-3 py-1 rounded-full bg-ink text-paper border-2 border-ink font-bricolage font-bold text-[12.5px] shadow-[3px_3px_0_var(--k-wine,#b23a5b)] hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_var(--k-wine,#b23a5b)] disabled:opacity-60 disabled:cursor-not-allowed transition-[transform,box-shadow] duration-[120ms] ease-out"
       >
         {editing ? $t['cal.compose.submit.edit'] : $t['cal.compose.cta.publish']}
```

- [ ] **Step 7: Gates** — `pnpm type-check 2>&1 | grep -c "error TS"` → `16`; `npx -y svelte-check@4 2>&1 | tail -1` → `… 81 ERRORS …`. If svelte-check prints 82 or more, STOP and report the new error — do not „fix" it by loosening a type.

- [ ] **Step 8: Commit**

```bash
git add src/components/calendar/kiosk/MovedTag.svelte src/components/forum/kiosk/NotificationPanel.svelte src/components/calendar/kiosk/AgendaRow.svelte src/components/calendar/kiosk/mobile/CalendarMobileMonth.svelte src/components/calendar/kiosk/EventDetailModal.svelte src/components/calendar/kiosk/compose/EventComposeForm.svelte src/components/calendar/kiosk/compose/EventComposePreview.svelte
git commit -m "feat: calendar — bell row and tag for moved events, kopieren link, form hooks"
```

---

### Task 4: Copy — the create page opens with another event's content

**Files:**
- Modify: `src/pages/events/create.astro`, `src/components/calendar/kiosk/compose/EventComposePage.svelte`, `src/components/calendar/kiosk/compose/EventComposePageInner.svelte`

**Interfaces:**
- Consumes from Task 1: `EventCopySource`; the text `cal.compose.copy.notice`. From Task 3: `EventComposeForm`'s `initialMultiDay` prop.
- Consumes (already on main): `isOwner(itemAuthor, currentUser)` from `src/utils/authHelpers.ts`; `connectDB()`; the edit-mode value mapping in `EventComposePageInner.computeInitialValues()` (it becomes the shared `valuesOf()`).
- Produces: `/events/create?copy=<event id>`; props `copyFrom?: EventCopySource` on `EventComposePage` and `EventComposePageInner`.

`tsc` does not read `.astro` frontmatter — the page is checked by the build in Step 4.

- [ ] **Step 1: The page** — load the source for its owner, allowlist the fields

```diff
diff --git a/src/pages/events/create.astro b/src/pages/events/create.astro
index 209c3501..8401d94b 100644
--- a/src/pages/events/create.astro
+++ b/src/pages/events/create.astro
@@ -8,11 +8,19 @@
 // Drag-select on the calendar's month grid lands here with prefill
 // query params (?from=YYYY-MM-DD&to=YYYY-MM-DD&allDay=1) — the inner
 // component reads them in onMount.
+//
+// „kopieren" (2026-10-06): ?copy=<event id> loads one of the member's OWN events
+// and hands its content to the form — without the date. Not the member's event,
+// a rejected one or a bad id → back to the calendar.
 
 import KioskLayout from '../../layouts/KioskLayout.astro';
 import EventComposePage from '../../components/calendar/kiosk/compose/EventComposePage.svelte';
 import { getSession } from 'auth-astro/server';
+import { ObjectId } from 'mongodb';
+import { connectDB } from '../../lib/mongodb';
+import { isOwner } from '../../utils/authHelpers';
 import { isUserBanned } from '../../lib/auth/banGuard';
+import type { EventCopySource } from '../../types';
 
 const session = await getSession(Astro.request);
 
@@ -26,8 +34,33 @@ if (await isUserBanned(session.user.id)) {
   return Astro.redirect('/', 302);
 }
 
+let copyFrom: EventCopySource | undefined;
+const copyId = Astro.url.searchParams.get('copy');
+if (copyId !== null) {
+  if (!ObjectId.isValid(copyId)) return Astro.redirect('/calendar', 302);
+  const db = await connectDB();
+  const source = await db.collection('events').findOne(
+    { _id: new ObjectId(copyId) },
+    {
+      projection: {
+        title: 1, body: 1, category: 1, startDate: 1, endDate: 1, allDay: 1, location: 1,
+        capacity: 1, visibility: 1, tags: 1, author: 1, moderationStatus: 1
+      }
+    }
+  );
+  if (!source || !isOwner(source.author, session.user.id) || source.moderationStatus === 'rejected') {
+    return Astro.redirect('/calendar', 302);
+  }
+  // Allowlist + Date → string across the SSR boundary.
+  copyFrom = JSON.parse(JSON.stringify({
+    title: source.title, body: source.body, category: source.category,
+    startDate: source.startDate, endDate: source.endDate, allDay: source.allDay,
+    location: source.location, capacity: source.capacity, visibility: source.visibility,
+    tags: source.tags
+  }));
+}
 ---
 
 <KioskLayout title="Mahalle · neuer Termin" description="Erstelle einen neuen Termin im Mahalle-Kalender." page="calendar">
-  <EventComposePage client:only="svelte" />
+  <EventComposePage client:only="svelte" copyFrom={copyFrom} />
 </KioskLayout>
```

- [ ] **Step 2: Pass it through the provider wrapper**

```diff
diff --git a/src/components/calendar/kiosk/compose/EventComposePage.svelte b/src/components/calendar/kiosk/compose/EventComposePage.svelte
index 3dadbbf7..8d3bf740 100644
--- a/src/components/calendar/kiosk/compose/EventComposePage.svelte
+++ b/src/components/calendar/kiosk/compose/EventComposePage.svelte
@@ -5,11 +5,12 @@
 
   import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
   import EventComposePageInner from './EventComposePageInner.svelte';
-  import type { Event as EventDoc } from '../../../../types';
+  import type { Event as EventDoc, EventCopySource } from '../../../../types';
 
-  let { mode = 'create', initialEvent } = $props<{
+  let { mode = 'create', initialEvent, copyFrom } = $props<{
     mode?: 'create' | 'edit';
     initialEvent?: EventDoc;
+    copyFrom?: EventCopySource;
   }>();
 
   const client = new QueryClient({
@@ -20,5 +21,5 @@
 </script>
 
 <QueryClientProvider {client}>
-  <EventComposePageInner {mode} {initialEvent} />
+  <EventComposePageInner {mode} {initialEvent} {copyFrom} />
 </QueryClientProvider>
```

- [ ] **Step 3: The form logic** — `valuesOf()` shared with edit mode, the empty date, „mehrtägig" from the source, the notice, the draft store left alone

```diff
diff --git a/src/components/calendar/kiosk/compose/EventComposePageInner.svelte b/src/components/calendar/kiosk/compose/EventComposePageInner.svelte
index ca6ffbab..cf17525c 100644
--- a/src/components/calendar/kiosk/compose/EventComposePageInner.svelte
+++ b/src/components/calendar/kiosk/compose/EventComposePageInner.svelte
@@ -28,7 +28,7 @@
     RateLimitError
   } from '../../../../lib/calendarMutations';
   import { eventDraft, type EventDraftValues } from '../../../../lib/eventDraftStore';
-  import { t } from '../../../../lib/kiosk-i18n';
+  import { t, tStr } from '../../../../lib/kiosk-i18n';
   import {
     berlinDayOf,
     berlinTodayISO,
@@ -37,18 +37,25 @@
     isLegacyUtcAllDay
   } from '../../../../lib/calendar/berlinDay';
   import { showToast, showSuccess } from '../../../../utils/toast';
-  import type { EventCategory, Event as EventDoc } from '../../../../types';
+  import type { EventCategory, Event as EventDoc, EventCopySource } from '../../../../types';
 
   let {
     mode = 'create',
-    initialEvent
+    initialEvent,
+    copyFrom
   } = $props<{
     mode?: 'create' | 'edit';
     initialEvent?: EventDoc;
+    copyFrom?: EventCopySource;
   }>();
 
   // svelte-ignore state_referenced_locally
   const isEditing = mode === 'edit';
+  // „kopieren": a new event from an old one's content. Like edit mode it leaves the
+  // draft store alone — the member's own unfinished draft must survive a copy.
+  // svelte-ignore state_referenced_locally
+  const isCopy = !isEditing && !!copyFrom;
+  const usesDraft = !isEditing && !isCopy;
 
   // ─── Initial values — computed synchronously at script-top.
   // This component runs client-only (`client:only="svelte"` on the
@@ -63,36 +70,47 @@
     return { start: berlinDayOf(start), end: berlinDayOf(end) };
   }
 
+  // The form values of a stored event — shared by edit mode and „kopieren".
+  function valuesOf(source: EventCopySource): EventComposeValues {
+    const start = new Date(source.startDate as any);
+    const end = new Date(source.endDate as any);
+    const pad = (n: number) => n.toString().padStart(2, '0');
+    const dateStr = (d: Date) =>
+      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
+    const timeStr = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
+    const allDayDays = source.allDay ? allDayPrefill(start, end) : null;
+    return {
+      title: source.title ?? '',
+      body: source.body ?? '',
+      category: (source.category ?? 'kiez') as EventCategory,
+      // All-day: the stored bounds are Berlin day bounds (since 2026-09-27) —
+      // read the civil day in Berlin, never the browser's local date. Rows
+      // stored before the fix (UTC midnight → 23:59:59Z) carry the meant day
+      // in their UTC date, so read that until the repair script has run.
+      startDate: allDayDays ? allDayDays.start : dateStr(start),
+      startTime: source.allDay ? '00:00' : timeStr(start),
+      endDate: allDayDays ? allDayDays.end : dateStr(end),
+      endTime: source.allDay ? '23:59' : timeStr(end),
+      allDay: !!source.allDay,
+      location: source.location ?? '',
+      capacity: source.capacity ?? null,
+      visibility: (source.visibility ?? 'public') as 'public' | 'private',
+      tags: source.tags ?? []
+    };
+  }
+
+  // A copy keeps everything but the DAY: the member must choose the new one, so nobody
+  // publishes the same event twice on the old date. A source that ran over several days
+  // opens with „mehrtägig" ticked, so the copy cannot shrink to one day unnoticed.
+  // svelte-ignore state_referenced_locally
+  const copyValues = isCopy && copyFrom ? valuesOf(copyFrom) : null;
+  const copyMultiDay = copyValues ? copyValues.startDate !== copyValues.endDate : undefined;
+
   function computeInitialValues(): Partial<EventComposeValues> {
     // Edit mode wins outright — populate from the existing event,
     // never read URL prefill or draft store.
-    if (isEditing && initialEvent) {
-      const start = new Date(initialEvent.startDate as any);
-      const end = new Date(initialEvent.endDate as any);
-      const pad = (n: number) => n.toString().padStart(2, '0');
-      const dateStr = (d: Date) =>
-        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
-      const timeStr = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
-      const allDayDays = initialEvent.allDay ? allDayPrefill(start, end) : null;
-      return {
-        title: initialEvent.title ?? '',
-        body: initialEvent.body ?? '',
-        category: (initialEvent.category ?? 'kiez') as EventCategory,
-        // All-day: the stored bounds are Berlin day bounds (since 2026-09-27) —
-        // read the civil day in Berlin, never the browser's local date. Rows
-        // stored before the fix (UTC midnight → 23:59:59Z) carry the meant day
-        // in their UTC date, so read that until the repair script has run.
-        startDate: allDayDays ? allDayDays.start : dateStr(start),
-        startTime: initialEvent.allDay ? '00:00' : timeStr(start),
-        endDate: allDayDays ? allDayDays.end : dateStr(end),
-        endTime: initialEvent.allDay ? '23:59' : timeStr(end),
-        allDay: !!initialEvent.allDay,
-        location: initialEvent.location ?? '',
-        capacity: initialEvent.capacity ?? null,
-        visibility: (initialEvent.visibility ?? 'public') as 'public' | 'private',
-        tags: initialEvent.tags ?? []
-      };
-    }
+    if (isEditing && initialEvent) return valuesOf(initialEvent);
+    if (copyValues) return { ...copyValues, startDate: '', endDate: '' };
 
     const search =
       typeof window !== 'undefined'
@@ -183,7 +201,7 @@
   // Skipped entirely in edit mode: drafts are scoped to the create flow.
   let draftTimer: ReturnType<typeof setTimeout> | null = null;
   $effect(() => {
-    if (isEditing) return;
+    if (!usesDraft) return;
     const snapshot: EventDraftValues = {
       title: values.title,
       body: values.body,
@@ -271,7 +289,7 @@
         ? await edit.mutateAsync({ id: String(initialEvent._id), input: payload })
         : await create.mutateAsync(payload);
 
-      if (!isEditing) eventDraft.clearDraft();
+      if (usesDraft) eventDraft.clearDraft();
       modalOpen = false;
 
       // Toast: dispatched onto window now, but the full-page redirect
@@ -318,7 +336,7 @@
   }
 
   function onDiscard() {
-    if (!isEditing) eventDraft.clearDraft();
+    if (usesDraft) eventDraft.clearDraft();
     if (typeof window !== 'undefined') window.location.href = '/calendar';
   }
 </script>
@@ -334,11 +352,20 @@
     </div>
   {/if}
 
+  {#if isCopy}
+    <div class="px-4 md:px-9 lg:px-10 pt-5">
+      <p class="font-bricolage text-sm px-3.5 py-2 rounded-md border" style="color: var(--k-ink); background: color-mix(in srgb, var(--k-teal) 14%, transparent); border-color: var(--k-teal);" role="status" data-copy-notice>
+        {tStr($t['cal.compose.copy.notice'] as string, { title: copyFrom?.title ?? '' })}
+      </p>
+    </div>
+  {/if}
+
   <div
     class="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-0 min-h-[calc(100vh-180px)]"
   >
     <EventComposeForm
       {initialValues}
+      initialMultiDay={copyMultiDay}
       onChange={handleChange}
       showBreadcrumb={true}
       editing={isEditing}
```

- [ ] **Step 4: Gates** — `pnpm type-check 2>&1 | grep -c "error TS"` → `16`; `npx -y svelte-check@4 2>&1 | tail -1` → `… 81 ERRORS …`; `npx astro build --config scratchpad/astro.config.preview.mjs > scratchpad/event-copy-move/build.log 2>&1; echo $?` → `0`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/events/create.astro src/components/calendar/kiosk/compose/EventComposePage.svelte src/components/calendar/kiosk/compose/EventComposePageInner.svelte
git commit -m "feat: calendar — copy an own event onto a new date"
```

---

### Task 5: Docs and the browser gate

**Files:**
- Modify: `src/components/calendar/kiosk/CLAUDE.md`, `src/components/forum/kiosk/CLAUDE.md`, `CLAUDE.md`
- Run (already written, gitignored): `scratchpad/event-copy-move/db.mts`, `scratchpad/event-copy-move/probe.cjs`

- [ ] **Step 1: The area notes and the root file**

```diff
diff --git a/src/components/calendar/kiosk/CLAUDE.md b/src/components/calendar/kiosk/CLAUDE.md
index e5848c9e..e4c90e69 100644
--- a/src/components/calendar/kiosk/CLAUDE.md
+++ b/src/components/calendar/kiosk/CLAUDE.md
@@ -191,3 +191,28 @@ Two synthetic-user audit passes (A=browse/navigate, B=compose/interact) → 0 Cr
 
 ### Translation toggle sits above the description (2026-10-01)
 In `EventDetailModal.svelte` the `TranslateControl` block (keyed on `eventId`) renders ABOVE the description since `4fed3f05` — rule and reasons in `src/components/forum/kiosk/CLAUDE.md` → „Translation toggle: above long text, under short text".
+
+## „kopieren" + „verschoben" (2026-10-06)
+
+Owner decisions: no recurring events („otherwise they add an event and forget to come back") — instead the author can COPY an event onto a new date; and when an author MOVES an event, the people who plan to come are told and the event carries a „verschoben" tag. Plan: `docs/superpowers/plans/2026-10-06-event-copy-and-move.md`.
+
+### Copy
+- **Entry:** `❐ kopieren` in the detail view's author row (`[data-event-copy]`, hidden on a rejected event) → `/events/create?copy=<id>`.
+- **Server:** `src/pages/events/create.astro` loads the source with an allowlist projection and hands `copyFrom` (`EventCopySource` in `src/types/index.ts`) to the island. Only the member's OWN event, not a rejected one, valid id — anything else redirects to `/calendar`.
+- **Form:** `EventComposePageInner` builds the values with `valuesOf()` (shared with edit mode) and opens with the DATE EMPTY (`startDate: ''`, `endDate: ''`) — the form's existing „Datum fehlt." check refuses a publish without one, so nobody posts the same event twice on the old day. Times of day, place, category, capacity, visibility and tags are carried. A source that ran over several days opens with „mehrtägig" ticked (`initialMultiDay` prop of `EventComposeForm`; the dates are empty, so the form cannot read it from them). A teal notice (`[data-copy-notice]`, `cal.compose.copy.notice`) names the source.
+- **It is a new event:** it goes through `POST /api/events/create` — moderation, the daily limit of 5 and the admin alert apply. Nothing of the old event travels: no answers, likes, saves, comments, no „verschoben".
+- **Draft store:** a copy leaves `kiosk-draft:event` alone like edit mode does (`usesDraft`) — no load, no autosave, no clear — so the member's own unfinished draft survives.
+- The form fields carry `data-ev-field="title|date|start|end|endDate|allDay|multiDay|location|body|capacity"`, the desktop publish button `data-ev-publish` (probe hooks). Tags have no input in the form; they ride along invisibly, as in edit mode.
+
+### Move
+- **What counts** (pure, tested: `src/lib/calendar/eventMove.ts` → `moveChange()`): `date` = the start moved, the last Berlin DAY moved, or timed ↔ all-day; an end TIME that only got longer or shorter is not a move. **The edit form re-saves the dates on EVERY save, also for a text-only edit** — so timed starts are compared by the minute (the form writes HH:MM back, stored seconds are lost) and all-day events by the days they mean (a row still in the pre-2026-09-27 UTC storage is rewritten to Berlin bounds by the form); comparing raw instants would have announced a typo fix as a move (found in the plan audit, pinned by the test „re-saving an unchanged event through the form is no move" and the probe's M1b/M1c). `place` = a new non-empty place (case and spacing ignored; removing the place tells nobody). Both together = `both`. A text-only edit = `null`.
+- **Edit route** (`/api/events/edit/[id]`): on `date`/`both` it stamps `movedAt` and `movedFromStart` = the FIRST start (`originalStart()`; a second move keeps it, and an event moved back to it gets both fields unset — it is not moved any more); then `tellAboutMove()` (`src/lib/calendar/eventMoveNotify.ts`, server-only, never throws) notifies everyone in `rsvps.going` ∪ `rsvps.maybe` ∪ `savedEvents`, each once, never the author.
+- **Every move reaches the bell; only the push has a brake.** A cap of 3 NOTICES per hour was built first and removed the same evening: the probe showed a fourth move being saved but not announced, which leaves people with a wrong date. Now a member's older UNREAD `event_moved` row about the same event is deleted and folded into the new one (`mergeChange()` — two different kinds become `both`), so there is one unread row per event and it always prints the CURRENT time and place. The PUSH is sent for the first three moves of an event per hour only (`eventmove:<eventId>`, `MOVE_PUSHES_PER_HOUR`; `notifyUsers(…, { push: false })` after that) — otherwise an author could ring every attendee's phone over and over by editing the date (found by the commit security review). The edit itself is never refused.
+- **A held edit** (the moderation flags the edited text → the event is hidden): nobody is told; the route stores `moveNoticeOwed: 'date'|'place'|'both'`. When the admin approves, `processReviewAction()` calls `sendOwedMoveNotice()`, which unsets the field and reads the event in one `findOneAndUpdate` — two reviews at once send it once.
+- **Notification:** type `'event_moved'`, glyph `↦` in ink (a member's action, not the system speaking), `actorId` = the author; `meta` carries `change`, `startISO`, `endISO`, `allDay`, `place` — the panel builds the row from them (`nc.event.moved.date|place|both` + `moveWhenLabel()`, DE/EN), `push.ts` builds the German push text (`movePushBody()`). The row links to `/calendar?event=<id>&d=<new Berlin day>` (`moveTarget()`), which opens the detail view. Deleting the event purges the rows like every other row (`target.contentId`).
+- **Time wording:** `moveWhenLabel()` prints Berlin time from its own weekday/month tables („Mi., 14. Okt., 18:00" · „… · ganztägig" · „Mi., 14. Okt. – Fr., 16. Okt.") — never Intl's formatted strings, which differ between ICU versions while the push text is built on the server.
+- **Tag:** `MovedTag.svelte` (`[data-moved-tag]`, Tailwind classes only — nested island) in `AgendaRow` (agenda + day view, both variants), the phone month's day list and the detail view; the detail view adds „ursprünglich …" under the time (`[data-moved-from]`). Not on the month grid's pills (too small) and not on the agenda's slim „läuft" lines.
+- **Edit form:** in edit mode a line under „Wann" (`[data-move-hint]`, `cal.compose.move.hint`) says that a change of date, time or place is announced.
+- **Probe:** `scratchpad/event-copy-move/probe.cjs` (53 checks: move through the real edit page and the API, bell rows, tag, copy form, draft survival, ownership, held edit + double review) with `db.mts seed|state|cleanup` (dev db only). Build AND start with `TELEGRAM_BOT_TOKEN= TELEGRAM_ADMIN_CHAT_ID=` in front — the probe creates two events and one flagged edit, each of which would send the admin a real Telegram line.
+- **Texts are drafts** (not yet confirmed by the owner): the bell rows, the tag, „ursprünglich", the copy notice and the edit hint.
+
```

```diff
diff --git a/src/components/forum/kiosk/CLAUDE.md b/src/components/forum/kiosk/CLAUDE.md
index e93fafac..66119bd4 100644
--- a/src/components/forum/kiosk/CLAUDE.md
+++ b/src/components/forum/kiosk/CLAUDE.md
@@ -113,6 +113,7 @@ User, the same day: he saved his announcement „als Entwurf" to test it and cou
 - **Constraints baked into the markup**: „Abmelden" is always a WORD (never an icon-only affordance), wine + mono, in its own foot slot behind a **solid** `1.5px` ink rule (`.am-foot { border-top: 1.5px solid var(--k-ink) }`) — visually distinct from the dashed rules used elsewhere in the card. Links straight to `/logout` (real sign-out, lands on `/login?abgemeldet=1`) — never call `signOut()` directly from this component. No item counts anywhere in the menu (v1 decision — counts are a possible v2 addition). Moderation row renders only when `user.role === 'admin'` (no disabled state for non-admins — the row doesn't exist at all), plum-colored (`--k-plum`).
 
 ### Notification bell + panel
+- Row type `'event_moved'` since 2026-10-06 (glyph ↦ in ink, `nc.event.moved.date|place|both`, links to the calendar's detail view): an author moved an event the member answered or saved — rules in `src/components/calendar/kiosk/CLAUDE.md` → „kopieren" + „verschoben". A member keeps ONE unread row per event; a newer move replaces it.
 - Row type `'blog'` since 2026-10-02 (glyph ¶ in rust, `nc.blog.one` / `nc.blog.many`, links to the post or to `/blog`): the automatic new-post announcement — see `src/components/blog/CLAUDE.md` → „New-post notifications".
 - Bell lives in `KioskNav`'s right cluster, left of the avatar (logged-in only), with 90s visible-tab count polling (`?count=1`). Panel is a structural sibling of `AvatarMenu` (outside-click a tick late, `Escape`, dual `html`+`body` scroll-lock on mobile, header z-50 bump via `bellOpen`, styles in `global.css` `.nc-*` — orphan rule) with ONE deliberate deviation: close is INSTANT, no exit fade (CD ruling).
 - Visual layer from `design/handoffs/design_handoff_notify/` (hybrid glyph accents — § plum / ◉ teal, ⇄ not ◈; ink fresh-edge, Kurier-Verblassen read state; NO motion on bell/badge ever).
```

```diff
diff --git a/CLAUDE.md b/CLAUDE.md
index f68ab49e..cd134698 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -28,7 +28,7 @@ pnpm type-check   # TypeScript validation
 pnpm test         # all lib tests (src/**/*.test.ts, node:test via tsx) — also a step in checks.yml since 2026-10-02
 npx -y svelte-check@4  # Svelte diagnostics sweep — dev-only warnings (e.g. state_referenced_locally) never appear in `pnpm build` output
 # CI (checks.yml) runs on Node 24 — its `node-version` (and `schillerkiez-stats.yml`'s) must follow `engines.node` in package.json: after the 2026-10-01 bump to >=24 both workflows still installed Node 20, `pnpm install` refused (ERR_PNPM_UNSUPPORTED_ENGINE) and every checks run failed for a day while Vercel kept deploying; fixed `f36dca6d`. After a push that touches package.json or a workflow, look at the run: `gh run list --workflow=checks.yml --limit 1`.
-# CI (checks.yml) also runs `pnpm test` (422 lib tests as of 2026-10-06) as its last step since 2026-10-02 — a failing test fails the job. Actions are on Node 24 majors: `actions/checkout@v7`, `actions/setup-node@v7`, `gitleaks/gitleaks-action@v3`, and `pnpm/action-setup@v5` (NOT v6: v6 installs pnpm 11 first and self-updates down to the `packageManager` version — open upstream issues with pnpm 10 projects; move to v6 only together with pnpm 11).
+# CI (checks.yml) also runs `pnpm test` (436 lib tests as of 2026-10-06) as its last step since 2026-10-02 — a failing test fails the job. Actions are on Node 24 majors: `actions/checkout@v7`, `actions/setup-node@v7`, `gitleaks/gitleaks-action@v3`, and `pnpm/action-setup@v5` (NOT v6: v6 installs pnpm 11 first and self-updates down to the `packageManager` version — open upstream issues with pnpm 10 projects; move to v6 only together with pnpm 11).
 # CI (checks.yml) gates PRs on ratchet-only error budgets: tsc ≤16, svelte-check ≤81 (27/94→26/93 on 09-06 when the contact-form i18n fix cleared an untyped record, 93→92 on 09-10 with the shared initialsOf helper, 26/92→23/89 on 09-21 when the three unused legacy `/api/*/all` routes were deleted, 23/89→16/81 on 09-30 when the dead legacy React/dark-glass cluster was deleted — lower them when errors get fixed, never raise them)
 # Dead-code sweep (read-only, never installed, never `fix`): `npx -y knip@latest --include files` (text mode — the JSON reporter hides unused files) and `npx -y fallow@latest dead-code` / `fallow dupes`. Both are blind to `scripts/`, `.github/` and `scratchpad/`, so grep those before removing a package (dotenv, exceljs, @astrojs/node are used only there); their false positives here: `auth.config.ts` (loaded by auth-astro by convention), every `*.test.ts` (run by hand with `npx tsx`), all of `src/styles/*.css` (`.astro` frontmatter imports + `global.css` `@import`s), `design/handoffs/**`. Phase 1 (22 dead React/dark-glass files) landed 2026-09-30 (`9f7b92dc`); Phase 2 (19 zero-import packages + the `netlify:*` scripts + the `mongoose` SSR external) landed 2026-09-30; Phase 3 (`requireMemberSession()` in 22 member write routes) landed 2026-09-30 — the file/package sweep is closed; the remainder (unused exports and types, 9 unread Svelte props, the duplicate `ModerationDecision`/`ReportReason`, the `global.css` glass block) landed 2026-10-01 with `docs/superpowers/plans/2026-10-01-unused-exports-sweep.md`. What the tools still report afterwards is the KEEP list in that plan's inventory file (symbols used only by `scripts/`, `scratchpad/`, tests or root configs). Four names stay on that list: `PLR_CODES` (generator output of `scripts/simplify-plr.js`), `AIR_DAILY_COLLECTION` + `recomputeDailyRollup` (`scratchpad/repair-air-sentinel.mts`), the `COMMENT_MAX_LEN` re-export in `comment.schema.ts` (`scratchpad/comment-len-check.mts`). `jsonwebtoken` + `@types/jsonwebtoken` left the same day (`5fb4173a`) once the legacy token helpers in `src/lib/auth.ts` were gone — the `JWT_SECRET` env var STAYS, `auth.config.ts` reads it as the fallback Auth.js secret. Left on purpose, it needs a decision: `ModeratingModal` cannot be dismissed by the member (its `onDismiss` was never called and is gone). (The write-only `lastSubmittedAt` store and the stale `ADM_REPORT_REASONS` comment were removed on 2026-10-02.) When running a per-symbol name search for such a sweep, restrict it to code files and exclude your own analysis output (`scratchpad/sweep/*.json` held every name and made 142 of 164 symbols look used).
 ```
@@ -176,7 +176,7 @@ See `src/pages/api/news/CLAUDE.md` — full notes load when working in that subt
 ## Database Collections
 - `users` - User accounts. **Names may repeat, the handle is the identity (2026-09-21):** display names are NOT unique (prod has two „Petra"); `@handle` is, and it is shown next to the name in comments, post detail, the seller card and the event author slab. ONE display-name rule for signup and profile edit lives in the pure `src/lib/profile/nameRules.ts` (2–30 chars, letters of any script, digits, space, `. ' ’ - _ /` (the slash since the evening of 09-21, user decision — organisations write their names that way, e.g. „STK Schillerpromenade/Neukölln“; first and last character stay letter/digit); invisible/control characters stripped — until that day signup checked only „not empty + profanity"); the same file refuses team lookalikes (`isProtectedName`: „Mahalle", „Admin…", „Team" …, compared after lookalike folding — Cyrillic/Greek twins, leetspeak) and `src/lib/profile/protectedNamesStore.ts` refuses lookalikes of an admin's own display name; admins are exempt on rename. New members may CHOOSE their handle once at signup (`handleChosen?: true`; `RESERVED_HANDLES` + `chosenHandleProblem()` in `src/lib/profile/handle.ts`; error codes `name_invalid` / `name_protected` / `handle_invalid` / `handle_reserved` / `handle_taken` 409); without a choice the automatic slug applies. Existing handles never change (no change route — deliberate, user decision). **Client-visible user joins use ONE allowlist, `PUBLIC_AUTHOR_PROJECTION` + `toPublicAuthor()` in `src/lib/publicAuthor.ts` — never `{ password: 0 }`**: until 09-21 the comments list, all create/edit responses and the News list joined the full user document (e-mail, strike data, `pendingEmail`, tour stamps) for any logged-in member; proven on dev with `scratchpad/author-join-keys.mts` (prints key NAMES only). **Two unique indexes** (both **partial**, both ensured idempotently by `scripts/create-auth-indexes.ts`): `users_handle_unique` on `handle`, and `users_email_unique` on `email` — unique, `partialFilterExpression: { email: { $type: 'string' } }`, collation `{locale:'en',strength:2}`. Partial is load-bearing in both cases: the deletion tombstone `$unset`s those fields, and a full unique index would collide every such doc on one implicit null key. The email collation is a **one-way door** (MongoDB ≥7.3 forbids re-adding the same partial index with a different collation) and the index is **not** used by any query — partial indexes only become plan-eligible when the query restates the filter, which none of the five email lookups do. Because a second unique index now exists, `register.ts` must discriminate code 11000 on `e.keyPattern` (`handle` → retry with a suffix, `email` → 409, anything else → rethrow); never read `e.keyValue`, which is a raw ICU sort key for collated indexes. Full rationale + rollback: `docs/runbooks/users-email-unique-index.md`. Fields include `moderationStrikes`, `strikeHistory` (per-strike ledger: date/reason/contentType/contentId/reviewedBy), `isBanned` — ENFORCED: banned accounts cannot log in and all content-write APIs return 403 `account_banned` (see `src/lib/auth/banGuard.ts`); plus `role?: 'user' | 'admin'` — admin role unlocks `/admin/announcements`, the moderation queue, and the `isOfficial`-true admin-create endpoint; defaults to `'user'`; plus `handle?: string` — unique per-user slug (`[a-z0-9_]{3,20}`, see `src/lib/profile/handle.ts`), enforced by a **partial** unique index `users_handle_unique` (a full unique index would collide every handle-less user on the same implicit null key and break registration) — set at registration going forward, batch-backfilled for older accounts via `scripts/backfill-user-handles.ts`, and lazily self-healed on first profile load by `ensureHandle()` for any stragglers; plus `verified?: boolean` — Kiez-verification v1 (Aug 2026): STRICT, badge renders only on `verified === true` (absent/undefined = not verified); toggled by admins on `/admin/mitglieder` via `PATCH /api/admin/users/[id]` (the flag's only writer — keep it server-controlled); single source of truth so future proof sources (postcard code, event QR) can set the same flag; plus `motto?: string` — optional Steckbrief line, own-view/print-only, never on the public profile; `pendingEmail?: string` — set mid e-mail-change, cleared on confirm/cancel; `passwordChangedAt?: Date` — stamped on password change/reset, invalidates JWTs whose `loginAt` predates it (other-device sign-out, see `auth.config.ts`'s `jwt` callback); `deletionScheduledAt?: Date` — 7-day account-deletion grace timestamp (`src/lib/auth/accountDeletion.ts`), cleared on undo; `dankeCrossedAt?: Date` — stamp-on-first-observation date the user's summed likes crossed 100 (Kiez-Chronik milestone, `src/lib/profile/chronik.ts`); `anonymized?: boolean` + `deletedAt?: Date` — set together by the day-7 deletion pipeline's tombstone step, replacing `name` with "Ehemaliges Mitglied" and unsetting email/password/image/userPicture/hobbies/handle/verified/emailVerified/roleBadge/role/motto/pendingEmail/dankeCrossedAt/deletionScheduledAt/tours/tourHelloDismissedAt/deletionClaimedAt (last three added in the 2026-08-30 hardening batch) and memberType/dailyLimit while KEEPING moderationStrikes/strikeHistory/isBanned/bannedAt/bannedReason/createdAt/passwordChangedAt — see `src/components/profile/kiosk/CLAUDE.md`'s "Account deletion" section for the full ordered pipeline); plus `tours?: { forum?: Date, kalender?: Date, markt?: Date, kurier?: Date, kiezdaten?: Date, blog?: Date, profil?: Date }` + `tourHelloDismissedAt?: Date` — spotlight-tour per-chapter seen stamps (timestamps not booleans; first write wins; see `src/components/tour/CLAUDE.md`); plus `lastSeenAt?: Date` — stamped best-effort by the JWT callback's existing 5-minute recheck (since 2026-09-22), one activity signal among several that feed „active in the last 90 days" for the `@alle` Admin-Hinweis (see `src/components/forum/kiosk/CLAUDE.md` → „Mentions"); plus `memberType?: 'organisation' | 'business'` — self-chosen at signup or in profile edit (absent = person, no migration), shown as the tag „Initiative" / „Gewerbe" beside the name via `MemberTypeTag.svelte`, correctable by the admin on `/admin/mitglieder`, normalised by `storedMemberType()` in every member-data join; plus `dailyLimit?: number` — admin-only (the PATCH on `/api/admin/users/[id]` is its ONLY writer), honoured only while the type is organisation, cleared whenever the member or the admin moves the type away from organisation, never in a client-visible projection except the admin list; plus `lastVisit?: { forum?, kalender?, markt?, blog?: Date }` — last opening of each section's index page (`POST /api/profile/visit`), drives the „new since your last visit" tab dots (`GET /api/profile/section-news`) and the „neu" chips; absent = nothing new; unset by the deletion tombstone. Spec `docs/superpowers/specs/2026-10-01-member-types-design.md`, plan `docs/superpowers/plans/2026-10-01-member-types.md`); plus `forumNotify?: 'digest' | 'off'` — forum-notification preference (2026-10-03; absent = every new public post (the default since 03:41 the same night — it was the daily digest for a few hours), `'digest'` = one notification each morning, `'off'` = none; read/written by `GET/POST /api/profile/forum-notify`, not ban-gated; unset by the deletion tombstone); plus `newsletter?: 'off'` — Kiez-Brief preference (2026-10-03; absent = the weekly Kiez-Brief e-mail, `'off'` = none; read/written by `GET/POST /api/profile/newsletter` (the switch in the profile's Konto card), not ban-gated; also set by the unsubscribe link and the RFC 8058 one-click route, and by the admin on `/admin/mitglieder` (test accounts, bouncing addresses); the mail goes to unconfirmed addresses too since 2026-10-04; unset by the deletion tombstone); plus `locale?: 'en'` — the server's copy of the DE/EN toggle (2026-10-04; absent = German; written by `POST /api/profile/locale` from `src/lib/localeSync.ts`, which the nav calls on load and on every toggle; read by the Kiez-Brief to pick the mail's language; unset by the deletion tombstone)
 - `topics` - Forum posts (includes `moderationStatus`, `isUserReported`, `rejectionReason`, `images` fields — each image is `{ url, publicId, width?, height? }`; the optional pixel size, stored since 2026-09-25 and backfilled by `scripts/backfill-post-image-dimensions.ts`, lets the detail hero reserve its box before the file arrives (CLS). Same shape in `announcements`, `recommendations` and `postDrafts`.)
-- `events` - Calendar events (includes `moderationStatus`, `isUserReported` fields) **All-day events store Europe/Berlin day bounds since 2026-09-27** (00:00:00.000 → 23:59:59.999 Berlin; before: UTC bounds that Berlin read as two days — repair via `scripts/repair-allday-event-bounds.ts`, see `src/components/calendar/kiosk/CLAUDE.md` „All-day events are Berlin days").
+- `events` - Calendar events (includes `moderationStatus`, `isUserReported` fields; since 2026-10-06 `movedAt` + `movedFromStart` when the author moved the date or time (drives the „verschoben" tag) and the short-lived `moveNoticeOwed` while a moved edit waits in the moderation queue — the members who answered or saved the event get an `event_moved` notification, see `src/components/calendar/kiosk/CLAUDE.md` → „kopieren" + „verschoben"; an author can also COPY an own event onto a new date, there are no recurring events by decision) **All-day events store Europe/Berlin day bounds since 2026-09-27** (00:00:00.000 → 23:59:59.999 Berlin; before: UTC bounds that Berlin read as two days — repair via `scripts/repair-allday-event-bounds.ts`, see `src/components/calendar/kiosk/CLAUDE.md` „All-day events are Berlin days").
 - `announcements` - Community + official announcements (includes `moderationStatus`, `isUserReported`, `rejectionReason`, `images`, plus **`isOfficial?: boolean`** + **`pinnedUntil?: Date | null`** for admin-posted official announcements with the 7-day pin lifecycle (up to `MAX_PINS` = 3 concurrent pins since Aug 2026, oldest displaced — `src/lib/announcements/pin.ts`; the forum index renders all pins as slim collapsed bars, one opening in place as a fused bar+card accordion — v3 2026-09-12; on phones 2–3 pins start as ONE summary bar and the tag row folds behind a „# Tags" chip since 2026-09-20, both with a slide animation that the posts below follow; see `src/components/forum/kiosk/CLAUDE.md`) — server-controlled, never settable from client input; **authors can change a post's kind from edit mode since 2026-09-13** (cross-collection move via `POST /api/posts/move/[id]`, `src/lib/forum/movePost.ts`; officials excluded; old URLs 302 — see `src/components/forum/kiosk/CLAUDE.md` „Kind change in edit mode"); plus **`editCount?: number`** — incremented server-side on every successful title/body `PATCH` from the admin composer's edit mode, surfaced in the kiosk `AnnCard` meta line ("Nx bearbeitet" / "edited Nx"); see admin dashboard at `/admin/announcements` (kiosk `AnnounceApp.svelte`, see `src/components/admin/CLAUDE.md`))
 - `recommendations` - User recommendations (includes `moderationStatus`, `isUserReported`, `rejectionReason`, `images` fields)
 - `comments` - Comments on posts (includes `moderationStatus` field). Body limit 3000 characters since 2026-09-18 (`COMMENT_MAX_LEN` in the pure `src/lib/forum/commentLimits.ts`; composer counter, draft-kept-on-failure and localized refusal toasts in `src/components/forum/kiosk/CLAUDE.md` „Comment length, counter and failed sends"). Parent link is `relevantPostId` (ObjectId) ONLY. Deleting a post cascades its thread through `deleteCommentsForPost()` (`src/lib/comments/cascade.ts`) from all five delete routes (topics/events/announcements/recommendations self-delete + admin official delete) since 2026-09-14 — before that, announcement/recommendation deletes filtered on a nonexistent `topic` field and the admin route never cascaded, orphaning threads (cleanup: `scripts/cleanup-orphan-comments.ts`). Reported comments in a deleted thread keep their `flaggedContent` row, stamped `contentDeleted`. The thread's notifications go with the post (see `notifications` below). A malformed comment id on the self-delete route answers 400 `Invalid comment ID` since 2026-09-30 (was a 500).
@@ -186,7 +186,7 @@ See `src/pages/api/news/CLAUDE.md` — full notes load when working in that subt
 - `savedNews` - User bookmarks for news (userId + newsId pairs, server-side persistence)
 - `savedPosts` - User bookmarks for forum posts (userId + postId pairs, server-side persistence). Feed cards show a per-post save COUNT (read-time `$group`, `attachSavedCounts()` in `topicsQuery.ts`) since 2026-09-11 — never store a counter on the post. `/bookmarks` joins all three forum collections since 2026-09-13 (a saved post follows a kind change).
 - `postDrafts` - Server-side forum drafts, several per member (since 2026-09-21; before that „als Entwurf speichern" wrote ONE local-storage slot and the member could not find his draft again). `{ userId (string), kind: 'discussion'|'recommendation'|'announcement', title, body, tags, images: [{url, publicId}], createdAt, updatedAt }`, index `postDrafts_user_updated` `{ userId: 1, updatedAt: -1 }` (`scripts/create-post-draft-indexes.ts` — dry-run default, refuses a non-dev db without `--prod`; the PROD run is the user's). Deliberately its OWN collection, never a status inside `topics`/`announcements`/`recommendations`: no feed, search, count, related-rail, move or notification query can ever see a draft. Max 20 per member (`MAX_POST_DRAFTS`), no TTL, no moderation / daily limit / alert on save — those run when the draft is published through the normal create endpoint of its kind; 120 saves/h per member (`postdraft:<userId>`), banned accounts cannot save. Owner-only, foreign id = 404, `no-store`. **Images: a draft's image list comes from the client, so (a) the schema accepts only our own uploads (`https://res.cloudinary.com/…`, `publicId` under `mahalle/posts/`, url contains the publicId) and (b) an image is destroyed only when NOTHING references it any more — posts of ANY author and drafts of ANY member; an „own posts only" check would let a member destroy someone else's published photo by naming its publicId.** Removed by the account-deletion pipeline. **One page lists them together with the marketplace's draft listings: `/entwuerfe`** (`src/pages/entwuerfe.astro` + `src/components/drafts/DraftsPage.svelte`, pure row mapper `src/lib/drafts/unifiedDrafts.ts`); the account menu's „Meine Entwürfe" and the profile Archive's „Entwürfe →" link there. Details + probes: `src/components/forum/kiosk/CLAUDE.md` → „Drafts".
-- `notifications` - In-app notification center docs, one per recipient per event (`{ userId, type: 'comment'|'moderation'|'official'|'market_contact'|'mention'|'admin_hint'|'blog'|'forum', actorId?, target: { contentType, contentId, title, href }, meta?, createdAt, readAt }`). Fan-out on write (broadcasts insertMany one doc per member); actor names are a read-time join, never stored; no rendered copy stored (client renders DE/EN from kiosk-i18n by type). Real Mongo TTL index on `createdAt` (90d) + `{userId, createdAt}` compound (`scripts/create-notification-indexes.ts`). Write helpers in `src/lib/notifications.ts` are never-throw (Sentry capture + flush). **R2 (Aug 2026):** each insert also fires a best-effort web push — German-only payload, dead endpoints (404/410) pruned from `pushSubscriptions`, never-throw (mirrors the write helpers). `'admin_hint'` (2026-09-22): the admin-only `@alle` broadcast in a forum post or comment — one doc per member active in the last 90 days, `meta.sourceId` = the post/comment id (idempotent dedupe key), comment rows carry a `#comment-<id>` deep link. **Purged with their content since 2026-09-30:** every delete path calls `purgeNotificationsFor()` as its LAST step — the four post self-deletes and the admin official delete with `[id, ...cascade.commentIds]` (the cascade returns the thread's ids; one moderation-row shape targets a comment id), listing and comment delete with `[id]` (`src/lib/notificationPurge.ts`, pure, tested) — rows match on `target.contentId` OR `meta.sourceId`; a post id sweeps its whole thread because every comment row targets the parent page; a comment id matches mention/@alle rows and, for comments created after that day, the „replied" row (`meta.sourceId` on `type: 'comment'` since then — older replied rows go with the post or the TTL). Only the account-deletion pipeline deletes by recipient. See `src/components/forum/kiosk/CLAUDE.md` "Notification bell + panel".
+- `notifications` - In-app notification center docs, one per recipient per event (`{ userId, type: 'comment'|'moderation'|'official'|'market_contact'|'mention'|'admin_hint'|'blog'|'forum'|'event_moved', actorId?, target: { contentType, contentId, title, href }, meta?, createdAt, readAt }`). Fan-out on write (broadcasts insertMany one doc per member); actor names are a read-time join, never stored; no rendered copy stored (client renders DE/EN from kiosk-i18n by type). Real Mongo TTL index on `createdAt` (90d) + `{userId, createdAt}` compound (`scripts/create-notification-indexes.ts`). Write helpers in `src/lib/notifications.ts` are never-throw (Sentry capture + flush). **R2 (Aug 2026):** each insert also fires a best-effort web push — German-only payload, dead endpoints (404/410) pruned from `pushSubscriptions`, never-throw (mirrors the write helpers). `'admin_hint'` (2026-09-22): the admin-only `@alle` broadcast in a forum post or comment — one doc per member active in the last 90 days, `meta.sourceId` = the post/comment id (idempotent dedupe key), comment rows carry a `#comment-<id>` deep link. **Purged with their content since 2026-09-30:** every delete path calls `purgeNotificationsFor()` as its LAST step — the four post self-deletes and the admin official delete with `[id, ...cascade.commentIds]` (the cascade returns the thread's ids; one moderation-row shape targets a comment id), listing and comment delete with `[id]` (`src/lib/notificationPurge.ts`, pure, tested) — rows match on `target.contentId` OR `meta.sourceId`; a post id sweeps its whole thread because every comment row targets the parent page; a comment id matches mention/@alle rows and, for comments created after that day, the „replied" row (`meta.sourceId` on `type: 'comment'` since then — older replied rows go with the post or the TTL). Only the account-deletion pipeline deletes by recipient. See `src/components/forum/kiosk/CLAUDE.md` "Notification bell + panel".
 - `pushSubscriptions` - Web push subscription endpoints (`{ endpoint (unique), keys: { p256dh, auth }, userId, createdAt, updatedAt }`). Upsert-by-`endpoint` on re-subscribe or account-switch on the same browser (no duplicate rows). Deleted on account tombstone (day-7 anonymization pipeline) and pruned server-side on 404/410 from the push service. **SSRF guard (final review, Aug 2026):** the server later POSTs VAPID-signed requests to whatever endpoint is stored, so `PushSubscribeSchema` (`src/schemas/push.schema.ts`) accepts only `https:` + an allowlist of known push-service hosts (FCM/Google, Mozilla autopush, Apple, legacy WNS) — an unknown push service is rejected at subscribe time (client shows the error toast); extend the list rather than loosening the check. Unsubscribe is deliberately NOT allowlisted (it only deletes the caller's own row, no outbound request). Sends carry `timeout: 10000` — without it web-push registers no socket timeout and a hung endpoint would stall the awaited send past the never-throw envelope until Vercel kills the function. Opt-in UI lives in the notification panel's foot slot — see `src/components/forum/kiosk/CLAUDE.md` and `src/lib/pushClient.ts`. Smoke/rollout recipe: `docs/runbooks/web-push-smoke.md`.
 - `flaggedContent` - Content flagged by AI or user reports (for admin review queue)
 - `passwordResetTokens` - Single-use password-reset tokens (`{ tokenHash (sha256 of raw), userId, expiresAt, usedAt, createdAt }`); raw token only in the emailed link. 30-min TTL, atomic single-use consume. See `src/lib/auth/passwordReset.ts`.
```

- [ ] **Step 2: Commit the docs**

```bash
git add src/components/calendar/kiosk/CLAUDE.md src/components/forum/kiosk/CLAUDE.md CLAUDE.md
git commit -m "docs: calendar — kopieren and verschoben"
```

- [ ] **Step 3: Browser gate (run by the controller, not by an implementer).** The probe creates two events and one flagged edit; each would send the admin a real Telegram line, so BOTH the build and the server start with the two Telegram variables emptied.

```bash
TELEGRAM_BOT_TOKEN= TELEGRAM_ADMIN_CHAT_ID= npx astro build --config scratchpad/astro.config.preview.mjs
TELEGRAM_BOT_TOKEN= TELEGRAM_ADMIN_CHAT_ID= PORT=4655 HOST=127.0.0.1 node --env-file=.env dist/server/entry.mjs   # background
npx tsx --env-file=.env scratchpad/event-copy-move/db.mts seed
NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node scratchpad/event-copy-move/probe.cjs http://127.0.0.1:4655 > scratchpad/event-copy-move/probe.out 2>&1
grep -c "^PASS" scratchpad/event-copy-move/probe.out      # 53
grep -E "^FAIL|CRASHED|ALL " scratchpad/event-copy-move/probe.out   # ALL 53 PASS
npx tsx --env-file=.env scratchpad/event-copy-move/db.mts cleanup
fuser -k 4655/tcp   # in its own call
```

Expected: `53` and `ALL 53 PASS`; the cleanup line reports 5 events removed (3 seeded + 2 copies). Look at `scratchpad/event-copy-move/bell-rows.png`, `detail-moved.png`, `agenda-row.png`, `copy-form.png` and `detail-copy-phone.png` before reporting.
