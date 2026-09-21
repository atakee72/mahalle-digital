import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afsImportProblems, expectedRefDate, refDateFromTitle } from './syncChecks';

const TITLE = '2  Einwohnerinnen und Einwohner in Berlin am 30. Juni 2026 nach LOR-Planungsräumen und Altersgruppen';
const row = (code: string, total: number, ageSum = total, foreign = Math.round(total * 0.36), mh = Math.round(total * 0.58)) => ({ plr_code: code, total, ageSum, foreign, mh });
const FOUR = [row('08100102', 8182), row('08100103', 7095), row('08100104', 6665), row('08100105', 6388)];

test('period ↔ reference date', () => {
  assert.equal(expectedRefDate('2026h1'), '2026-06-30');
  assert.equal(expectedRefDate('2025h2'), '2025-12-31');
  assert.equal(expectedRefDate('2026'), null);
  assert.equal(refDateFromTitle(TITLE), '2026-06-30');
  assert.equal(refDateFromTitle('… in Berlin am 31. Dezember 2025 nach …'), '2025-12-31');
  assert.equal(refDateFromTitle('Inhaltsverzeichnis'), null);
});

test('the real June import is clean', () => {
  assert.deepEqual(afsImportProblems({ period: '2026h1', title: TITLE, expectedAreas: 4, rows: FOUR }), []);
});

test('a December file under a June label is refused', () => {
  const p = afsImportProblems({ period: '2026h1', title: '… am 31. Dezember 2025 nach …', expectedAreas: 4, rows: FOUR });
  assert.equal(p.length, 1);
  assert.match(p[0], /dated 2025-12-31/);
});

test('missing areas, zero totals and sums that do not add up are problems', () => {
  assert.match(afsImportProblems({ period: '2026h1', title: TITLE, expectedAreas: 4, rows: FOUR.slice(0, 3) })[0], /matched 3 of 4/);
  assert.match(afsImportProblems({ period: '2026h1', title: TITLE, expectedAreas: 4, rows: [...FOUR.slice(0, 3), row('08100105', 0)] })[0], /total is 0/);
  assert.match(afsImportProblems({ period: '2026h1', title: TITLE, expectedAreas: 4, rows: [...FOUR.slice(0, 3), row('08100105', 6388, 6000)] })[0], /age groups add up to 6000/);
  assert.match(afsImportProblems({ period: '2026h1', title: TITLE, expectedAreas: 4, rows: [...FOUR.slice(0, 3), row('08100105', 6388, 6388, 2342, 0)] })[0], /origin figures implausible/); // sheet T1 missing → mh 0
  assert.match(afsImportProblems({ period: '2026h1', title: TITLE, expectedAreas: 4, rows: [...FOUR.slice(0, 3), row('08100105', 6388, 6388, 2342, 7000)] })[0], /origin figures implausible/);
});

test('an unreadable title is not a problem by itself, a bad period is', () => {
  assert.deepEqual(afsImportProblems({ period: '2026h1', title: '', expectedAreas: 4, rows: FOUR }), []);
  assert.match(afsImportProblems({ period: 'h1-2026', title: TITLE, expectedAreas: 4, rows: FOUR })[0], /not of the form/);
});
