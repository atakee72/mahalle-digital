import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupAgenda } from './agendaGroups';

const d = (s: string) => new Date(s);
const today = d('2026-10-04T15:00:00');
const ev = (id: string, start: string, end: string, allDay = false) => ({ id, startDate: d(start), endDate: d(end), allDay });
const ids = (list: { id: string }[]) => list.map((e) => e.id);
const dayOf = (g: { day: Date }) => `${g.day.getMonth() + 1}-${g.day.getDate()}`;
const month = ev('month', '2026-10-01T00:00', '2026-10-31T23:59:59', true);

test('single-day events are listed under their start day, in incoming order, nothing running', () => {
  const groups = groupAgenda([ev('a', '2026-10-04T12:00', '2026-10-04T13:00'), ev('b', '2026-10-04T14:30', '2026-10-04T16:00'), ev('c', '2026-10-07T10:00', '2026-10-07T11:00')], today);
  assert.deepEqual(groups.map(dayOf), ['10-4', '10-7']);
  assert.deepEqual(ids(groups[0].events), ['a', 'b']);
  assert.ok(groups.every((g) => g.running.length === 0));
});

test('a multi-day event is running under today and under every later listed day it covers', () => {
  const groups = groupAgenda([month, ev('a', '2026-10-04T12:00', '2026-10-04T13:00'), ev('b', '2026-10-10T10:00', '2026-10-10T11:00')], today);
  assert.deepEqual(groups.map(dayOf), ['10-1', '10-4', '10-10']);
  assert.deepEqual([ids(groups[0].events), ids(groups[0].running)], [['month'], []]);
  assert.deepEqual([ids(groups[1].events), ids(groups[1].running)], [['a'], ['month']]);
  assert.deepEqual([ids(groups[2].events), ids(groups[2].running)], [['b'], ['month']]);
});

test('the owner’s case: five events start on the 10th, the day view counts six', () => {
  const five = [1, 2, 3, 4, 5].map((n) => ev('e' + n, `2026-10-10T1${n}:00`, `2026-10-10T1${n}:30`));
  const g = groupAgenda([month, ...five], today).find((x) => dayOf(x) === '10-10')!;
  assert.equal(g.events.length + g.running.length, 6);
});

test('a running event creates the today group when today has no event of its own', () => {
  const groups = groupAgenda([ev('fest', '2026-10-02T18:00', '2026-10-05T22:00')], today);
  assert.deepEqual(groups.map(dayOf), ['10-2', '10-4']);
  assert.deepEqual([ids(groups[1].events), ids(groups[1].running)], [[], ['fest']]);
});

test('only today is created for a running event — no group for the other days it covers', () => {
  const groups = groupAgenda([month], today);
  assert.deepEqual(groups.map(dayOf), ['10-1', '10-4']);
});

test('an event that ends today still counts as running today', () => {
  const groups = groupAgenda([ev('last', '2026-10-02T00:00', '2026-10-04T23:59:59', true)], today);
  assert.deepEqual(ids(groups[groups.length - 1].running), ['last']);
  assert.equal(dayOf(groups[groups.length - 1]), '10-4');
});

test('an event that ended yesterday is not carried to today or beyond', () => {
  const groups = groupAgenda([ev('over', '2026-10-01T00:00', '2026-10-03T23:59:59', true), ev('x', '2026-10-06T10:00', '2026-10-06T11:00')], today);
  assert.deepEqual(groups.map(dayOf), ['10-1', '10-6']);
  assert.deepEqual(ids(groups[1].running), []);
});

test('past day groups carry it too (shown when past days are opened)', () => {
  const groups = groupAgenda([month, ev('p', '2026-10-02T10:00', '2026-10-02T11:00')], today);
  const second = groups.find((x) => dayOf(x) === '10-2')!;
  assert.deepEqual(ids(second.running), ['month']);
});

test('an event is never running on its own start day', () => {
  const groups = groupAgenda([ev('new', '2026-10-04T00:00', '2026-10-08T23:59:59', true)], today);
  assert.deepEqual(groups.map(dayOf), ['10-4']);
  assert.deepEqual([ids(groups[0].events), ids(groups[0].running)], [['new'], []]);
});

test('a future multi-day event runs under the later listed days it covers, not under today', () => {
  const groups = groupAgenda([ev('later', '2026-10-10T00:00', '2026-10-12T23:59:59', true), ev('y', '2026-10-11T10:00', '2026-10-11T11:00'), ev('z', '2026-10-13T10:00', '2026-10-13T11:00')], today);
  assert.deepEqual(groups.map(dayOf), ['10-10', '10-11', '10-13']);
  assert.deepEqual(ids(groups[1].running), ['later']);
  assert.deepEqual(ids(groups[2].running), []);
});

test('several running events keep their incoming order', () => {
  const groups = groupAgenda([ev('r1', '2026-09-28T00:00', '2026-10-06T00:00'), ev('r2', '2026-10-01T00:00', '2026-10-31T00:00'), ev('own', '2026-10-04T09:00', '2026-10-04T10:00')], today);
  const t = groups[groups.length - 1];
  assert.deepEqual([ids(t.running), ids(t.events)], [['r1', 'r2'], ['own']]);
});

test('string dates (JSON from the server) work like Date objects', () => {
  const groups = groupAgenda([{ id: 's', startDate: '2026-10-01T00:00:00', endDate: '2026-10-31T23:59:59' }], today);
  assert.deepEqual(groups.map(dayOf), ['10-1', '10-4']);
});

test('no events → no groups', () => {
  assert.deepEqual(groupAgenda([], today), []);
});
