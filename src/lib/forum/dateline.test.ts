import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import { shortDayMonth } from './dateline';

test('German short day+month reads exactly like the calendar heading (date-fns), for every month', () => {
  for (let m = 0; m < 12; m++) {
    const d = new Date(2026, m, 5, 12);
    assert.equal(shortDayMonth(d, 'de'), format(d, 'dd. MMM', { locale: de }));
  }
});

test('English short day+month, for every month', () => {
  for (let m = 0; m < 12; m++) {
    const d = new Date(2026, m, 24, 12);
    assert.equal(shortDayMonth(d, 'en'), format(d, 'dd MMM', { locale: enUS }));
  }
});

test('the day keeps two digits, like the full forum dateline', () => {
  assert.equal(shortDayMonth(new Date(2026, 8, 5, 12), 'de'), '05. Sep.');
  assert.equal(shortDayMonth(new Date(2026, 8, 19, 12), 'de'), '19. Sep.');
});
