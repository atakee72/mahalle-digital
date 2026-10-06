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
});

test('a timed event always reads with its start time', () => {
  // runs past midnight (22:00 → 01:00): the start says it all
  assert.equal(moveWhenLabel('2026-10-14T20:00:00.000Z', '2026-10-14T23:00:00.000Z', false, 'de'), 'Mi., 14. Okt., 22:00');
  assert.equal(moveWhenLabel('2026-10-14T16:00:00.000Z', '2026-10-15T10:00:00.000Z', false, 'en'), 'Wed 14 Oct, 18:00');
  // a day or longer: the last day is named too
  assert.equal(moveWhenLabel('2026-10-14T16:00:00.000Z', '2026-10-16T10:00:00.000Z', false, 'de'), 'Mi., 14. Okt., 18:00 – Fr., 16. Okt.');
  assert.equal(moveWhenLabel('2026-10-14T16:00:00.000Z', '2026-10-15T16:00:00.000Z', false, 'en'), 'Wed 14 Oct, 18:00 – Thu 15 Oct');
});

test('a stored date that is not a date is never a date move and never throws', () => {
  assert.equal(moveChange({ ...base, startDate: 'kaputt' }, { ...base }), null);
  assert.equal(moveChange({ ...base }, { ...base, endDate: 'kaputt', location: 'Warthestraße 5' }), 'place');
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
