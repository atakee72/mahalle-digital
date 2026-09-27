# All-day events as Berlin days Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-day „ganztägig" event stays one day: its stored bounds are the Europe/Berlin civil day, the edit form reads them back as that day, the composer's default date is Berlin's today, and the rows already stored with UTC bounds are repaired by a dry-run-default script.

**Architecture:** Today `EventComposePageInner.composeIso()` stores an all-day event as `<date>T00:00:00.000Z` → `<endDate>T23:59:59.000Z` (UTC). A Berlin browser reads that as 02:00 on the day → 01:59 the NEXT day, so `eventSpanDays()` says 2, the pill says „· 2 Tage", and the edit prefill (`dateStr()` via local `getDate()`) turns the end into the next day — every save grows the event by one day (reproduced by simulation and on dev: `scratchpad/e2e-event-edit-allday.mts`). Fix at the source: a pure module `src/lib/calendar/berlinDay.ts` (Intl-based, no tz library — the repo has `date-fns` only) gives `berlinDayOf()`, `berlinTodayISO()`, `berlinDayStart()`, `berlinDayEnd()`; the composer stores all-day bounds as Berlin day bounds and prefills all-day dates through `berlinDayOf()`; a repair script rewrites legacy rows (`--apply`, `--prod` is the USER's run). `eventTime.ts` stays untouched: with Berlin bounds a Berlin browser computes the span correctly.

**Tech Stack:** Astro 5, Svelte 5 island (`client:only`), MongoDB driver, `Intl.DateTimeFormat`, node:test via `npx tsx --test`.

**Spec:** none — user report 2026-09-27 11:51 („why does the calendar make this event automatically mehrtägig?", event `6ab8e5f94dac18ff…`, „I tick of course ganztägig") and his „go --subagent-driven" at 12:04. Also closes the open ticket „composer default date is the UTC date".

## Global Constraints

- `src/lib/calendar/berlinDay.ts` is dependency-pure (imported by islands AND scripts): no `mongodb`, no env, no `date-fns-tz` (not installed), no regex lookbehind.
- Storage contract from now on: `allDay: true` ⇒ `startDate` = Berlin 00:00:00.000 of the start day, `endDate` = Berlin 23:59:59.999 of the end day. Timed events unchanged (exact instants).
- Scripts: dry-run default, `--apply` writes, `--prod` forces `/mahalle` on the same cluster and is the USER's run; refuse a non-dev db name without `--prod` (copy the interlock from `scripts/backfill-post-image-dimensions.ts`). Never print connection strings or any `.env` value.
- Gates: `npx tsc --noEmit 2>&1 | grep -c "error TS"` ≤ 23; `npx -y svelte-check@4 2>&1 | tail -1` errors ≤ 89.
- Commits: one line, no attribution footer, pathspec commits of the named files only. Never `git add scratchpad/` or `.superpowers/`.
- Dev server on 4655 is running (restarted 12:20); never start/stop a server. Probes write to the dev db only, clean up in `finally`, read `scratchpad/devpw.txt` straight into the login form (never print it).

## Review Focus

1. DST edges: 2026-03-29 (23-hour day) and 2026-10-25 (25-hour day) — `berlinDayStart/End` must still bound the civil day (test in Task 1).
2. An all-day event saved from a browser OUTSIDE Berlin must store the same bounds (Berlin, not the browser's zone) — the helpers use `Intl` with `timeZone: 'Europe/Berlin'`, never `getHours()`; test runs with `TZ=UTC` and `TZ=America/New_York` (Task 1 step 6).
3. Legacy rows (UTC bounds) must prefill and repair to the day the author meant: start day = UTC date of `startDate`, end day = UTC date of `endDate` (Task 3 test cases, Task 2 tolerant prefill).
4. A timed event that legitimately crosses midnight (22:00 → 00:30) must stay two calendar days — timed path untouched (Task 2 probe check 4).
5. Composer default date at 00:30 Berlin must be today in Berlin, not yesterday (UTC) — `berlinTodayISO()` everywhere the form or page seeds a date (Task 2 step 1, grep gate in step 4).

---

### Task 1: Pure Berlin-day helpers + tests

**Files:**
- Create: `src/lib/calendar/berlinDay.ts`
- Create: `src/lib/calendar/berlinDay.test.ts`
- Modify: `src/lib/clipper/extract.ts` (replace its local `berlinTodayISO` with a re-export)

**Interfaces:**
- Produces:
  - `berlinDayOf(d: Date | string | number): string` — `YYYY-MM-DD` of the instant in Europe/Berlin.
  - `berlinTodayISO(now?: Date): string` — `berlinDayOf(now ?? new Date())`.
  - `berlinDayStart(iso: string): Date` — Berlin 00:00:00.000 of civil day `iso` (`YYYY-MM-DD`).
  - `berlinDayEnd(iso: string): Date` — Berlin 23:59:59.999 of civil day `iso`.
  - `isLegacyUtcAllDay(start: Date, end: Date): boolean` — `start.toISOString()` ends with `T00:00:00.000Z` AND `end.toISOString()` ends with `T23:59:59.000Z` (the pre-fix storage shape).

- [ ] **Step 1: Write the failing tests**

`src/lib/calendar/berlinDay.test.ts`:

```ts
// Run: npx tsx --test src/lib/calendar/berlinDay.test.ts   (also under TZ=UTC and TZ=America/New_York — results must not change)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berlinDayOf, berlinTodayISO, berlinDayStart, berlinDayEnd, isLegacyUtcAllDay } from './berlinDay';

test('berlinDayOf: civil day in Europe/Berlin, not UTC', () => {
  assert.equal(berlinDayOf('2026-10-03T22:30:00.000Z'), '2026-10-04'); // 00:30 CEST next day
  assert.equal(berlinDayOf('2026-01-15T23:30:00.000Z'), '2026-01-16'); // 00:30 CET
  assert.equal(berlinDayOf(new Date('2026-10-03T12:00:00.000Z')), '2026-10-03');
  assert.equal(berlinTodayISO(new Date('2026-10-03T22:30:00.000Z')), '2026-10-04');
});

test('berlinDayStart/End: summer (CEST, +02:00) and winter (CET, +01:00)', () => {
  assert.equal(berlinDayStart('2026-10-03').toISOString(), '2026-10-02T22:00:00.000Z');
  assert.equal(berlinDayEnd('2026-10-03').toISOString(), '2026-10-03T21:59:59.999Z');
  assert.equal(berlinDayStart('2026-01-15').toISOString(), '2026-01-14T23:00:00.000Z');
  assert.equal(berlinDayEnd('2026-01-15').toISOString(), '2026-01-15T22:59:59.999Z');
});

test('DST edges: the 23-hour day (2026-03-29) and the 25-hour day (2026-10-25)', () => {
  assert.equal(berlinDayStart('2026-03-29').toISOString(), '2026-03-28T23:00:00.000Z'); // still CET at midnight
  assert.equal(berlinDayEnd('2026-03-29').toISOString(), '2026-03-29T21:59:59.999Z');   // CEST by the evening
  assert.equal(berlinDayStart('2026-10-25').toISOString(), '2026-10-24T22:00:00.000Z'); // still CEST at midnight
  assert.equal(berlinDayEnd('2026-10-25').toISOString(), '2026-10-25T22:59:59.999Z');   // CET by the evening
});

test('round trip: the bounds land on the same civil day', () => {
  for (const d of ['2026-10-03', '2026-01-15', '2026-03-29', '2026-10-25', '2026-12-31']) {
    assert.equal(berlinDayOf(berlinDayStart(d)), d, `start ${d}`);
    assert.equal(berlinDayOf(berlinDayEnd(d)), d, `end ${d}`);
    assert.equal(berlinDayOf(new Date(berlinDayEnd(d).getTime() + 1)), nextDay(d), `end+1ms ${d}`);
  }
});

test('isLegacyUtcAllDay recognises the pre-fix storage shape only', () => {
  assert.equal(isLegacyUtcAllDay(new Date('2026-10-03T00:00:00.000Z'), new Date('2026-10-04T23:59:59.000Z')), true);
  assert.equal(isLegacyUtcAllDay(berlinDayStart('2026-10-03'), berlinDayEnd('2026-10-03')), false);
  assert.equal(isLegacyUtcAllDay(new Date('2026-10-03T07:00:00.000Z'), new Date('2026-10-03T16:00:00.000Z')), false);
});

function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/lib/calendar/berlinDay.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

`src/lib/calendar/berlinDay.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/lib/calendar/berlinDay.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: One definition of `berlinTodayISO`**

In `src/lib/clipper/extract.ts`, delete the local `berlinTodayISO` function (the three lines incl. its doc comment) and add at the top, under the header comment:

```ts
export { berlinTodayISO } from '../calendar/berlinDay';
```

Run: `npx tsx --test src/lib/clipper/extract.test.ts` → PASS (unchanged count).

- [ ] **Step 6: Zone independence + gate**

Run: `TZ=UTC npx tsx --test src/lib/calendar/berlinDay.test.ts && TZ=America/New_York npx tsx --test src/lib/calendar/berlinDay.test.ts` → both PASS.
Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → ≤ 23 (report the number).

- [ ] **Step 7: Commit**

```bash
git add src/lib/calendar/berlinDay.ts src/lib/calendar/berlinDay.test.ts src/lib/clipper/extract.ts
git commit -m "calendar: pure Europe/Berlin civil-day helpers (day start/end, today, legacy all-day shape)" -- src/lib/calendar/berlinDay.ts src/lib/calendar/berlinDay.test.ts src/lib/clipper/extract.ts
```

---

### Task 2: Composer stores and reads all-day events as Berlin days; Berlin default date

**Files:**
- Modify: `src/components/calendar/kiosk/compose/EventComposePageInner.svelte` (prefill `computeInitialValues`, `composeIso`/`onPublish`, the two `toISOString().slice(0, 10)` defaults at lines 154/156)
- Modify: `src/components/calendar/kiosk/compose/EventComposeForm.svelte` (`todayISO()` at line 50)
- Create: `scratchpad/e2e-event-allday-berlin.mts` (gitignored dev probe)

**Interfaces:**
- Consumes: `berlinDayOf`, `berlinTodayISO`, `berlinDayStart`, `berlinDayEnd`, `isLegacyUtcAllDay` from `src/lib/calendar/berlinDay.ts` (Task 1). Import path from `compose/`: `../../../../lib/calendar/berlinDay`.
- Produces: the storage contract in Global Constraints. Payload to `POST /api/events/create` and `PUT /api/events/edit/[id]` unchanged in shape (ISO strings), only the all-day values change.

- [ ] **Step 1: Default date = Berlin today**

`EventComposeForm.svelte`: add `import { berlinTodayISO } from '../../../../lib/calendar/berlinDay';` and make `todayISO()` return `berlinTodayISO()`:

```ts
  function todayISO(): string {
    return berlinTodayISO(); // Berlin's civil date — between 00:00 and 02:00 CEST the UTC date is still yesterday
  }
```

`EventComposePageInner.svelte`: add the import `import { berlinDayOf, berlinTodayISO, berlinDayStart, berlinDayEnd, isLegacyUtcAllDay } from '../../../../lib/calendar/berlinDay';` and replace both `new Date().toISOString().slice(0, 10)` (lines 154 and 156) with `berlinTodayISO()`.

- [ ] **Step 2: Edit prefill reads all-day bounds as Berlin days**

In `computeInitialValues()` (edit branch) replace the two date lines:

```ts
        startDate: dateStr(start),
        ...
        endDate: dateStr(end),
```

with

```ts
        // All-day: the stored bounds are Berlin day bounds (since 2026-09-27) —
        // read the civil day in Berlin, never the browser's local date. Rows
        // stored before the fix (UTC midnight → 23:59:59Z) carry the meant day
        // in their UTC date, so read that until the repair script has run.
        startDate: initialEvent.allDay ? allDayPrefill(start, end).start : dateStr(start),
        ...
        endDate: initialEvent.allDay ? allDayPrefill(start, end).end : dateStr(end),
```

and add, above `computeInitialValues`:

```ts
  function allDayPrefill(start: Date, end: Date): { start: string; end: string } {
    if (isLegacyUtcAllDay(start, end)) {
      return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
    }
    return { start: berlinDayOf(start), end: berlinDayOf(end) };
  }
```

- [ ] **Step 3: All-day save writes Berlin day bounds**

Replace `composeIso` and the `endISO` line in `onPublish`:

```ts
  // Compose ISO datetime strings from the date+time inputs. Timed events are
  // exact instants in the browser's zone; all-day events are Berlin civil
  // days (storage contract since 2026-09-27, see berlinDay.ts).
  function composeIso(date: string, time: string, allDay: boolean): string {
    if (allDay) return berlinDayStart(date).toISOString();
    return new Date(`${date}T${time || '00:00'}`).toISOString();
  }
```

```ts
      const endISO = values.allDay
        ? berlinDayEnd(values.endDate).toISOString()
        : composeIso(values.endDate, values.endTime, false);
```

- [ ] **Step 4: Grep gate — no UTC date seeding left in the calendar**

Run: `grep -rn "toISOString().slice(0, 10)" src/components/calendar src/lib/calendar` → only the legacy branch inside `allDayPrefill` may match (two hits on one line). Anything else: fix it.

- [ ] **Step 5: Gates**

Run: `npx -y svelte-check@4 2>&1 | tail -1` → errors ≤ 89 (report the number). `npx tsc --noEmit 2>&1 | grep -c "error TS"` → ≤ 23.

- [ ] **Step 6: Browser probe on dev (Berlin zone)**

Create `scratchpad/e2e-event-allday-berlin.mts` modelled on `scratchpad/e2e-event-edit-allday.mts` (read it first: same `createRequire(process.env.PW_PATH)` playwright import, dev-db interlock, admin login through `/login?redirect=/forum`, `timezoneId: 'Europe/Berlin'`, PUT/POST capture via `page.on('response')`, cleanup in `finally`). Run with `PW_PATH="$(npm root -g)/@playwright/cli/node_modules/playwright" npx tsx scratchpad/e2e-event-allday-berlin.mts`. Checks:

1. CREATE one-day all-day: open `/events/create`, fill title `E2E-BERLIN-<ts> Hoffest` (≥ 5 chars) and body (≥ 10 chars), pick category if required, set the date input to `2026-10-03`, tick „ganztägig", click „veröffentlichen →"; POST answered 201; db row: `allDay === true`, `startDate` = `2026-10-02T22:00:00.000Z`, `endDate` = `2026-10-03T21:59:59.999Z`.
2. The calendar page after the redirect: navigate to October (`/calendar?d=2026-10-03` if the page accepts `d`, else click the month stepper) and assert the pill text for the title does NOT contain „Tage".
3. RE-EDIT: open `/events/edit/<id>` → date inputs `2026-10-03` only, „ganztägig" checked, „mehrtägig" unchecked. Save without changes → PUT 200 → db bounds IDENTICAL to check 1 (no drift).
4. TIMED across midnight stays two days: on the same edit page untick „ganztägig", set 22:00 / 00:30 and (tick „mehrtägig") end date `2026-10-04`; save → db `startDate` = `2026-10-03T20:00:00.000Z`, `endDate` = `2026-10-03T22:30:00.000Z`; re-open edit: `2026-10-03 → 2026-10-04`, 22:00–00:30.
5. LEGACY row prefill: seed a row like the reproduction (`allDay: true`, `2026-10-03T00:00:00.000Z` → `2026-10-04T23:59:59.000Z`, author = dev admin, `moderationStatus: 'approved'`); open its edit page → prefill `2026-10-03 → 2026-10-04` (UTC dates, NOT 05.10), „mehrtägig" checked; untick „mehrtägig", save → db `2026-10-02T22:00:00.000Z` → `2026-10-03T21:59:59.999Z`.
6. Composer default date: open `/events/create`; the date input equals `berlinTodayISO()` computed in the script (import it from `../src/lib/calendar/berlinDay`).
7. Cleanup: delete every event the probe made; print `N passed, M failed`.

Expected: all PASS. Note the count in the report.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/kiosk/compose/EventComposePageInner.svelte src/components/calendar/kiosk/compose/EventComposeForm.svelte
git commit -m "calendar: all-day events are Berlin days (store day bounds, read them back), composer defaults to Berlin's today" -- src/components/calendar/kiosk/compose/EventComposePageInner.svelte src/components/calendar/kiosk/compose/EventComposeForm.svelte
```

---

### Task 3: Repair script for legacy rows + docs

**Files:**
- Create: `scripts/repair-allday-event-bounds.ts`
- Create: `src/lib/calendar/allDayRepair.ts` (pure mapping, testable) + `src/lib/calendar/allDayRepair.test.ts`
- Modify: `src/components/calendar/kiosk/CLAUDE.md` (new section before „## Compose URL prefill + Termin-Clipper (Aug 2026)")
- Modify: `CLAUDE.md` (root: the `events` bullet under „Database Collections")

**Interfaces:**
- Consumes: `berlinDayStart`, `berlinDayEnd`, `isLegacyUtcAllDay` (Task 1).
- Produces: `repairedAllDayBounds(start: Date, end: Date): { start: Date; end: Date } | null` — `null` when the row is not in the legacy shape.

- [ ] **Step 1: Failing test for the pure mapping**

`src/lib/calendar/allDayRepair.test.ts`:

```ts
// Run: npx tsx --test src/lib/calendar/allDayRepair.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairedAllDayBounds } from './allDayRepair';

test('legacy UTC bounds → Berlin day bounds of the SAME civil days (the days the author typed)', () => {
  const r = repairedAllDayBounds(new Date('2026-10-03T00:00:00.000Z'), new Date('2026-10-03T23:59:59.000Z'));
  assert.deepEqual([r!.start.toISOString(), r!.end.toISOString()], ['2026-10-02T22:00:00.000Z', '2026-10-03T21:59:59.999Z']);
});

test('a row that already grew keeps its (wrong) end day — the author fixes that once in the form', () => {
  const r = repairedAllDayBounds(new Date('2026-10-03T00:00:00.000Z'), new Date('2026-10-04T23:59:59.000Z'));
  assert.deepEqual([r!.start.toISOString(), r!.end.toISOString()], ['2026-10-02T22:00:00.000Z', '2026-10-04T21:59:59.999Z']);
});

test('winter row', () => {
  const r = repairedAllDayBounds(new Date('2026-01-15T00:00:00.000Z'), new Date('2026-01-15T23:59:59.000Z'));
  assert.deepEqual([r!.start.toISOString(), r!.end.toISOString()], ['2026-01-14T23:00:00.000Z', '2026-01-15T22:59:59.999Z']);
});

test('not legacy → null (already Berlin bounds, or a timed event)', () => {
  assert.equal(repairedAllDayBounds(new Date('2026-10-02T22:00:00.000Z'), new Date('2026-10-03T21:59:59.999Z')), null);
  assert.equal(repairedAllDayBounds(new Date('2026-10-03T07:00:00.000Z'), new Date('2026-10-03T16:00:00.000Z')), null);
});
```

Run: `npx tsx --test src/lib/calendar/allDayRepair.test.ts` → FAIL (module missing).

- [ ] **Step 2: Pure mapping**

`src/lib/calendar/allDayRepair.ts`:

```ts
// Pure mapping for scripts/repair-allday-event-bounds.ts (dependency-pure).
import { berlinDayStart, berlinDayEnd, isLegacyUtcAllDay } from './berlinDay';

/** Legacy all-day row (UTC midnight → UTC 23:59:59.000) → Berlin day bounds of
 *  the civil days its UTC dates name. Anything else → null (leave alone). */
export function repairedAllDayBounds(start: Date, end: Date): { start: Date; end: Date } | null {
  if (!isLegacyUtcAllDay(start, end)) return null;
  return {
    start: berlinDayStart(start.toISOString().slice(0, 10)),
    end: berlinDayEnd(end.toISOString().slice(0, 10)),
  };
}
```

Run: `npx tsx --test src/lib/calendar/allDayRepair.test.ts` → 4 PASS.

- [ ] **Step 3: The script**

`scripts/repair-allday-event-bounds.ts` — copy the header/interlock/`--apply`/`--prod` pattern from `scripts/backfill-post-image-dimensions.ts` (read it first), then:

```ts
// scripts/repair-allday-event-bounds.ts
// Run: pnpm tsx scripts/repair-allday-event-bounds.ts                  (DRY RUN, dev db)
//      pnpm tsx scripts/repair-allday-event-bounds.ts --apply          (writes, dev db)
//      pnpm tsx scripts/repair-allday-event-bounds.ts --apply --prod   (prod — the USER runs this)
//
// Until 2026-09-27 the composer stored an all-day event as UTC midnight → UTC
// 23:59:59, which Berlin reads as two calendar days. Rewrites such rows to the
// Berlin day bounds of the civil days their UTC dates name (allDayRepair.ts).
// A row whose end day already grew through re-saves keeps that end day — the
// author fixes it once in the form. Rows already in Berlin shape are skipped.
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { repairedAllDayBounds } from '../src/lib/calendar/allDayRepair';
import { berlinDayOf } from '../src/lib/calendar/berlinDay';

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

async function main() {
  const raw = process.env.MONGODB_URI;
  if (!raw) { console.error('MONGODB_URI missing'); process.exit(1); }
  const u = new URL(raw);
  if (PROD) u.pathname = '/mahalle';
  const dbName = u.pathname.slice(1);
  if (!dbName.includes('dev') && !PROD) {
    console.error(`refusing: db name "${dbName}" does not look like a dev db (pass --prod to override)`);
    process.exit(1);
  }
  const client = new MongoClient(u.toString());
  await client.connect();
  try {
    const events = client.db().collection('events');
    const rows = await events.find({ allDay: true }, { projection: { title: 1, startDate: 1, endDate: 1 } }).toArray();
    let fixed = 0, skipped = 0;
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} · db ${dbName} · ${rows.length} all-day events`);
    for (const r of rows) {
      const start = new Date(r.startDate), end = new Date(r.endDate);
      const next = repairedAllDayBounds(start, end);
      if (!next) { skipped++; continue; }
      console.log(`  ${String(r._id)}  ${String(r.title).slice(0, 48).padEnd(48)}  ${start.toISOString()} → ${end.toISOString()}  ⇒  ${berlinDayOf(next.start)} … ${berlinDayOf(next.end)} (Berlin)`);
      if (APPLY) await events.updateOne({ _id: r._id }, { $set: { startDate: next.start, endDate: next.end, updatedAt: new Date() } });
      fixed++;
    }
    console.log(`${APPLY ? 'rewrote' : 'would rewrite'} ${fixed}, already fine ${skipped}`);
  } finally {
    await client.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Dry-run and apply on the DEV db**

Seed one legacy row first (a tiny inline `npx tsx -e` or reuse the seed block of `scratchpad/e2e-event-edit-allday.mts` without the browser part; title `E2E-REPAIR-<ts>`, author = dev admin id string, `moderationStatus: 'approved'`, bounds `2026-10-03T00:00:00.000Z` → `2026-10-03T23:59:59.000Z`). Then:

Run: `pnpm tsx scripts/repair-allday-event-bounds.ts` → lists the row, „would rewrite 1".
Run: `pnpm tsx scripts/repair-allday-event-bounds.ts --apply` → „rewrote 1"; read the row back: `2026-10-02T22:00:00.000Z` → `2026-10-03T21:59:59.999Z`.
Run the dry run once more → „would rewrite 0". Delete the seeded row. Do NOT pass `--prod`.

- [ ] **Step 5: Docs**

`src/components/calendar/kiosk/CLAUDE.md`, insert BEFORE the line `## Compose URL prefill + Termin-Clipper (Aug 2026)`:

```
## All-day events are Berlin days (2026-09-27, user report: „why does the calendar make this event automatically mehrtägig?")

Until this day `EventComposePageInner.composeIso()` stored an all-day event as `<date>T00:00:00.000Z` → `<endDate>T23:59:59.000Z` — UTC bounds. A Berlin browser reads that as 02:00 → 01:59 the NEXT day: `eventSpanDays()` said 2, the pill said „· 2 Tage", the banner covered two cells, and the edit prefill (local `getDate()`) turned the end into the next day, so EVERY save grew the event by one more day (his clipped Termin went 1 → 2 → 3 days). Reproduced on dev with `scratchpad/e2e-event-edit-allday.mts`.
- **Storage contract now**: `allDay: true` ⇒ `startDate` = Berlin 00:00:00.000 of the start day, `endDate` = Berlin 23:59:59.999 of the end day — computed by the pure `src/lib/calendar/berlinDay.ts` (`berlinDayStart/End`, `berlinDayOf`, `berlinTodayISO`; Intl-based, DST-safe, tested under three TZs). Timed events are unchanged exact instants (22:00 → 00:30 legitimately spans two days).
- **Prefill** for all-day events reads the civil day in Berlin (`berlinDayOf`), never the browser's local date; rows still in the legacy UTC shape (`isLegacyUtcAllDay`) are read by their UTC dates until repaired. `eventTime.ts` is untouched: with Berlin bounds a Berlin browser computes spans correctly (a member abroad would still see local-zone spans — accepted).
- **Composer default date** is `berlinTodayISO()` everywhere (form + page fallbacks) — closed the old ticket „between 00:00 and 02:00 the default was yesterday" (UTC date).
- **Repair**: `scripts/repair-allday-event-bounds.ts` (dry-run default, `--apply`, `--prod` = the user's run; pure mapping `allDayRepair.ts`, tested) rewrites legacy rows to the Berlin bounds of the days their UTC dates name. A row whose end already grew keeps that end day — the author fixes it once in the form.
- **Probe**: `scratchpad/e2e-event-allday-berlin.mts` (dev :4655, Berlin zone; create/re-edit/midnight-crossing/legacy prefill/default date).
```

Root `CLAUDE.md`, the `events` bullet under „Database Collections" (`- \`events\` - Calendar events (includes \`moderationStatus\`, \`isUserReported\` fields)`): append ` **All-day events store Europe/Berlin day bounds since 2026-09-27** (00:00:00.000 → 23:59:59.999 Berlin; before: UTC bounds that Berlin read as two days — repair via \`scripts/repair-allday-event-bounds.ts\`, see \`src/components/calendar/kiosk/CLAUDE.md\` „All-day events are Berlin days").`

- [ ] **Step 6: Gate + commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → ≤ 23.

```bash
git add scripts/repair-allday-event-bounds.ts src/lib/calendar/allDayRepair.ts src/lib/calendar/allDayRepair.test.ts src/components/calendar/kiosk/CLAUDE.md CLAUDE.md
git commit -m "calendar: repair script for legacy UTC all-day rows (dry-run default), all-day docs" -- scripts/repair-allday-event-bounds.ts src/lib/calendar/allDayRepair.ts src/lib/calendar/allDayRepair.test.ts src/components/calendar/kiosk/CLAUDE.md CLAUDE.md
```

---

## Self-review record

- Root cause reproduced twice (simulation + dev browser probe) before designing; the fix targets the writer (`composeIso`), the reader (prefill) and the stored rows (script). `eventTime.ts` deliberately untouched (Berlin browsers compute correctly with Berlin bounds; documented).
- Type consistency: helper names identical across Tasks 1–3; import path from `compose/` is four levels up (`compose → kiosk → calendar → components → src`): `../../../../lib/calendar/berlinDay` — matches the existing `../../../../lib/mentions/mentions` import in `MentionPopup.svelte`.
- Review Focus 1, 2 → Task 1 tests/step 6; 3 → Task 2 step 2 + probe check 5 + Task 3 tests; 4 → probe check 4; 5 → Task 2 steps 1/4 + probe check 6.
- Task 2 and Task 3 touch disjoint files and both depend only on Task 1 → they may run in parallel.
- No placeholders.
