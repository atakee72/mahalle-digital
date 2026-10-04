import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupAgenda } from './agendaGroups';

const d = (s: string) => new Date(s);
const today = d('2026-10-04T15:00:00');
const ev = (id: string, start: string, end: string, allDay = false) => ({ id, startDate: d(start), endDate: d(end), allDay });
const ids = (g: { events: { id: string }[] }) => g.events.map((e) => e.id);
const dayOf = (g: { day: Date }) => `${g.day.getMonth() + 1}-${g.day.getDate()}`;

test('single-day events are listed under their start day, in incoming order', () => {
  const groups = groupAgenda([ev('a', '2026-10-04T12:00', '2026-10-04T13:00'), ev('b', '2026-10-04T14:30', '2026-10-04T16:00'), ev('c', '2026-10-07T10:00', '2026-10-07T11:00')], today);
  assert.deepEqual(groups.map(dayOf), ['10-4', '10-7']);
  assert.deepEqual(ids(groups[0]), ['a', 'b']);
});

test('a running multi-day event is also listed under today, first', () => {
  const groups = groupAgenda([ev('month', '2026-10-01T00:00', '2026-10-31T23:59:59', true), ev('a', '2026-10-04T12:00', '2026-10-04T13:00')], today);
  assert.deepEqual(groups.map(dayOf), ['10-1', '10-4']);
  assert.deepEqual(ids(groups[0]), ['month']);
  assert.deepEqual(ids(groups[1]), ['month', 'a']);
});

test('a running event creates the today group when today has no event of its own', () => {
  const groups = groupAgenda([ev('fest', '2026-10-02T18:00', '2026-10-05T22:00')], today);
  assert.deepEqual(groups.map(dayOf), ['10-2', '10-4']);
  assert.deepEqual(ids(groups[1]), ['fest']);
});

test('an event that ends today still counts as running today', () => {
  const groups = groupAgenda([ev('last', '2026-10-02T00:00', '2026-10-04T23:59:59', true)], today);
  assert.deepEqual(ids(groups[groups.length - 1]), ['last']);
  assert.equal(dayOf(groups[groups.length - 1]), '10-4');
});

test('an event that ended yesterday is not carried to today', () => {
  const groups = groupAgenda([ev('over', '2026-10-01T00:00', '2026-10-03T23:59:59', true)], today);
  assert.deepEqual(groups.map(dayOf), ['10-1']);
});

test('an event that starts today is not listed twice', () => {
  const groups = groupAgenda([ev('new', '2026-10-04T00:00', '2026-10-08T23:59:59', true)], today);
  assert.deepEqual(groups.map(dayOf), ['10-4']);
  assert.deepEqual(ids(groups[0]), ['new']);
});

test('a future multi-day event stays under its start day only', () => {
  const groups = groupAgenda([ev('later', '2026-10-10T00:00', '2026-10-12T23:59:59', true)], today);
  assert.deepEqual(groups.map(dayOf), ['10-10']);
});

test('several running events keep their incoming order ahead of today’s own', () => {
  const groups = groupAgenda([ev('r1', '2026-09-28T00:00', '2026-10-06T00:00'), ev('r2', '2026-10-01T00:00', '2026-10-31T00:00'), ev('own', '2026-10-04T09:00', '2026-10-04T10:00')], today);
  assert.deepEqual(ids(groups[groups.length - 1]), ['r1', 'r2', 'own']);
});

test('string dates (JSON from the server) work like Date objects', () => {
  const groups = groupAgenda([{ id: 's', startDate: '2026-10-01T00:00:00', endDate: '2026-10-31T23:59:59' }], today);
  assert.deepEqual(groups.map(dayOf), ['10-1', '10-4']);
});

test('no events → no groups', () => {
  assert.deepEqual(groupAgenda([], today), []);
});
