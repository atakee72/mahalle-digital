import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickAirSource, normalizeBlumeComponents, BLUME_STATION_ID, FALLBACK_STATION, type BlumeStationData } from './blume';
import { silenceKind } from './airLog';

const comp = (component: string, grade: number | null) => ({ datetime: '2026-09-20T11:00:00+02:00', component, value: grade, grade });
const station = (id: string, lqi: number | null, extra: Array<[string, number | null]> = []): BlumeStationData => ({
  station: id,
  data: normalizeBlumeComponents([comp('lqi', lqi), ...extra.map(([c, g]) => comp(c, g))]),
});

test('our station wins whenever it has a real value', () => {
  const pick = pickAirSource([station(FALLBACK_STATION.id, 3), station(BLUME_STATION_ID, 2)]);
  assert.equal(pick?.source, 'primary');
  assert.equal(pick?.station, BLUME_STATION_ID);
});

test('our station silent (-1 from BLUME) → the Karl-Marx-Straße substitute', () => {
  const pick = pickAirSource([station(BLUME_STATION_ID, -1, [['pm10', -1]]), station(FALLBACK_STATION.id, 2, [['pm10', 2], ['no2', 1], ['o3', null]])]);
  assert.equal(pick?.source, 'substitute');
  assert.equal(pick?.station, 'mc221');
  assert.equal(pick?.data.find((c) => c.component === 'lqi')?.grade, 2);
});

test('our station missing from the feed altogether → substitute', () => {
  assert.equal(pickAirSource([station(FALLBACK_STATION.id, 1)])?.source, 'substitute');
});

test('both silent, or an empty feed → nothing (the strip shows „Kein Signal")', () => {
  assert.equal(pickAirSource([station(BLUME_STATION_ID, -1), station(FALLBACK_STATION.id, -1)]), null);
  assert.equal(pickAirSource([]), null);
});

test('a third station is never used, however good its value', () => {
  assert.equal(pickAirSource([station('mc171', 1), station(BLUME_STATION_ID, -1)]), null);
});

test('morning alarm: readings in the window → all fine', () => {
  assert.equal(silenceKind(3, false), 'ok');
  assert.equal(silenceKind(1, null), 'ok');
});

test('morning alarm: no readings and the station has no value right now → the STATION is silent, the logger is fine', () => {
  assert.equal(silenceKind(0, false), 'station_silent');
});

test('morning alarm: no readings although the station reports → the LOGGER is dead', () => {
  assert.equal(silenceKind(0, true), 'logger_dead');
});

test('morning alarm: BLUME unreachable → assume the worse case, the logger', () => {
  assert.equal(silenceKind(0, null), 'logger_dead');
});
