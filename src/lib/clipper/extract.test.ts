import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  berlinTodayISO, buildClipMessages, parseClipJson, normalizeClipResult, mergeHint, toComposeParams,
  CLIP_JSON_SCHEMA,
} from './extract';

const today = '2026-09-26';

test('berlinTodayISO: Berlin date, not UTC — 23:30 UTC on the 25th is already the 26th in Berlin (CEST)', () => {
  assert.equal(berlinTodayISO(new Date('2026-09-25T23:30:00Z')), '2026-09-26');
  assert.equal(berlinTodayISO(new Date('2026-01-10T12:00:00Z')), '2026-01-10');
});

test('buildClipMessages: system prompt states today + weekday, user message carries title, url, selection, text and hints', () => {
  const msgs = buildClipMessages(
    { title: 'Kiezfest', url: 'https://example.org/e', text: 'Samstag 19 Uhr im Park', selection: 'Der Kiez feiert.', hint: { from: '2026-10-03', startTime: '19:00' } },
    today
  );
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /2026-09-26/);
  assert.match(msgs[0].content, /Saturday/);
  assert.match(msgs[0].content, /Europe\/Berlin/);
  assert.equal(msgs[1].role, 'user');
  assert.match(msgs[1].content, /Kiezfest/);
  assert.match(msgs[1].content, /https:\/\/example\.org\/e/);
  assert.match(msgs[1].content, /Der Kiez feiert\./);
  assert.match(msgs[1].content, /Samstag 19 Uhr im Park/);
  assert.match(msgs[1].content, /2026-10-03/);
});

test('CLIP_JSON_SCHEMA is strict and names every result field', () => {
  const s = CLIP_JSON_SCHEMA as any;
  assert.equal(s.strict, true);
  const props = Object.keys(s.schema.properties);
  for (const k of ['title', 'startDate', 'startTime', 'endDate', 'endTime', 'allDay', 'location', 'summary', 'confidence']) {
    assert.ok(props.includes(k), `missing ${k}`);
  }
  assert.deepEqual(s.schema.required.slice().sort(), props.slice().sort());
  assert.equal(s.schema.additionalProperties, false);
});

test('parseClipJson: plain JSON, fenced JSON, garbage', () => {
  assert.deepEqual(parseClipJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseClipJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(parseClipJson('Sorry, I cannot'), null);
  assert.equal(parseClipJson(''), null);
});

test('normalize: full valid answer passes through, dateFound true', () => {
  const r = normalizeClipResult({
    title: 'Kiezfest', startDate: '2026-10-03', startTime: '19:00', endDate: '2026-10-03', endTime: '22:00',
    allDay: false, location: 'Herrfurthplatz', summary: 'Ein Fest.', confidence: 'high',
  }, today);
  assert.equal(r.dateFound, true);
  assert.equal(r.startDate, '2026-10-03');
  assert.equal(r.endTime, '22:00');
  assert.equal(r.allDay, false);
});

test('normalize: time without date → no date, no time, dateFound false (Review Focus 2)', () => {
  const r = normalizeClipResult({ title: 'x', startDate: null, startTime: '19:00', endDate: null, endTime: null, allDay: false, location: null, summary: null, confidence: 'low' }, today);
  assert.equal(r.startDate, null);
  assert.equal(r.startTime, null);
  assert.equal(r.dateFound, false);
});

test('normalize: date without time → allDay true', () => {
  const r = normalizeClipResult({ title: 'x', startDate: '2026-10-03', startTime: null, endDate: null, endTime: null, allDay: false, location: null, summary: null, confidence: 'medium' }, today);
  assert.equal(r.allDay, true);
  assert.equal(r.endDate, '2026-10-03');
});

test('normalize: hallucinated far dates are dropped (Review Focus 1)', () => {
  const past = normalizeClipResult({ title: 'x', startDate: '2024-01-01', startTime: '10:00', endDate: null, endTime: null, allDay: false, location: null, summary: null, confidence: 'high' }, today);
  assert.equal(past.startDate, null);
  assert.equal(past.dateFound, false);
  const far = normalizeClipResult({ title: 'x', startDate: '2028-06-01', startTime: null, endDate: null, endTime: null, allDay: false, location: null, summary: null, confidence: 'high' }, today);
  assert.equal(far.startDate, null);
});

test('normalize: end before start is dropped; same-day end time not after start is dropped (Review Focus 3)', () => {
  const a = normalizeClipResult({ title: 'x', startDate: '2026-10-05', startTime: '20:00', endDate: '2026-10-03', endTime: '22:00', allDay: false, location: null, summary: null, confidence: 'high' }, today);
  assert.equal(a.endDate, '2026-10-05');
  assert.equal(a.endTime, null);
  const b = normalizeClipResult({ title: 'x', startDate: '2026-10-03', startTime: '20:00', endDate: '2026-10-03', endTime: '02:00', allDay: false, location: null, summary: null, confidence: 'high' }, today);
  assert.equal(b.endTime, null);
  const c = normalizeClipResult({ title: 'x', startDate: '2026-10-03', startTime: '20:00', endDate: '2026-10-04', endTime: '02:00', allDay: false, location: null, summary: null, confidence: 'high' }, today);
  assert.equal(c.endDate, '2026-10-04');
  assert.equal(c.endTime, '02:00');
});

test('normalize: malformed values and wrong types are nulled, strings clamped, unknown confidence → low', () => {
  const r = normalizeClipResult({ title: 'T'.repeat(300), startDate: '3.10.2026', startTime: '19 Uhr', endDate: 5, endTime: '25:00', allDay: 'yes', location: 'L'.repeat(300), summary: 'S'.repeat(1000), confidence: 'sure' }, today);
  assert.equal(r.title!.length, 200);
  assert.equal(r.startDate, null);
  assert.equal(r.startTime, null);
  assert.equal(r.endTime, null);
  assert.equal(r.allDay, false);
  assert.equal(r.location!.length, 200);
  assert.equal(r.summary!.length, 600);
  assert.equal(r.confidence, 'low');
  assert.equal(normalizeClipResult(null, today).dateFound, false);
  assert.equal(normalizeClipResult('x', today).title, null);
});

test('mergeHint: markup hint fills only what the model left empty', () => {
  const base = normalizeClipResult({ title: 'x', startDate: null, startTime: null, endDate: null, endTime: null, allDay: false, location: null, summary: null, confidence: 'low' }, today);
  const m = mergeHint(base, { from: '2026-10-03', startTime: '19:00', location: 'Park' });
  assert.equal(m.startDate, '2026-10-03');
  assert.equal(m.startTime, '19:00');
  assert.equal(m.location, 'Park');
  assert.equal(m.dateFound, true);
  const keep = mergeHint(normalizeClipResult({ title: 'x', startDate: '2026-10-04', startTime: '10:00', endDate: null, endTime: null, allDay: false, location: 'A', summary: null, confidence: 'high' }, today), { from: '2026-10-03', location: 'B' });
  assert.equal(keep.startDate, '2026-10-04');
  assert.equal(keep.location, 'A');
  assert.equal(mergeHint(base, { from: 'garbage' }).startDate, null);
});

test('toComposeParams: prefill contract of /events/create, selection wins over summary, source line appended, clipMiss on no date', () => {
  const found = normalizeClipResult({ title: 'Kiezfest', startDate: '2026-10-03', startTime: '19:00', endDate: '2026-10-04', endTime: '02:00', allDay: false, location: 'Park', summary: 'Ein Fest.', confidence: 'high' }, today);
  const p = toComposeParams(found, { title: 'Page title', url: 'https://example.org/e' });
  assert.equal(p.get('title'), 'Kiezfest');
  assert.equal(p.get('from'), '2026-10-03');
  assert.equal(p.get('to'), '2026-10-04');
  assert.equal(p.get('startTime'), '19:00');
  assert.equal(p.get('endTime'), '02:00');
  assert.equal(p.get('allDay'), null);
  assert.equal(p.get('location'), 'Park');
  assert.equal(p.get('body'), 'Ein Fest.\n\nQuelle: https://example.org/e');
  assert.equal(p.get('clipMiss'), null);

  const sel = toComposeParams(found, { title: 'Page title', url: 'https://example.org/e', selection: 'Markiert.' });
  assert.equal(sel.get('body'), 'Markiert.\n\nQuelle: https://example.org/e');

  const allDay = normalizeClipResult({ title: null, startDate: '2026-10-03', startTime: null, endDate: null, endTime: null, allDay: true, location: null, summary: null, confidence: 'medium' }, today);
  const q = toComposeParams(allDay, { title: 'Page title', url: 'https://example.org/e' });
  assert.equal(q.get('title'), 'Page title');
  assert.equal(q.get('allDay'), '1');
  assert.equal(q.get('to'), null);
  assert.equal(q.get('body'), 'Quelle: https://example.org/e');

  const miss = toComposeParams(normalizeClipResult(null, today), { title: 'Page title', url: 'https://example.org/e' });
  assert.equal(miss.get('clipMiss'), '1');
  assert.equal(miss.get('from'), null);
  assert.equal(miss.get('title'), 'Page title');
});
