import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginCardCopy } from './loginCardCopy';

test('shared calendar event gets the event card', () => {
  const copy = loginCardCopy('/calendar?event=6a7f977a6ef9655fa05febe9&d=2026-09-19');
  assert.ok(copy);
  assert.match(copy.title, /Termin/);
});

test('the card never carries anything from the link itself', () => {
  const copy = loginCardCopy('/calendar?event=GEHEIM123&d=2026-09-19');
  assert.ok(copy);
  assert.ok(!JSON.stringify(copy).includes('GEHEIM123'));
});

test('plain calendar, other pages and no redirect keep the default card', () => {
  assert.equal(loginCardCopy('/calendar'), null);
  assert.equal(loginCardCopy('/calendar?d=2026-09-19'), null);
  assert.equal(loginCardCopy('/forum'), null);
  assert.equal(loginCardCopy('/calendarx?event=1'), null);
  assert.equal(loginCardCopy(null), null);
  assert.equal(loginCardCopy(''), null);
});

test('an off-site redirect never changes the card', () => {
  assert.equal(loginCardCopy('https://evil.example/calendar?event=1'), null);
  assert.equal(loginCardCopy('//evil.example/calendar?event=1'), null);
});
