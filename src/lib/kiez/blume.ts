// Shared BLUME (luftdaten.berlin.de) fetch for station mc042 — used by the
// public /api/kiez-air route and the air logger. Server-only.
export const BLUME_LQI_URL = 'https://luftdaten.berlin.de/api/lqis/data';
export const BLUME_STATION_ID = 'mc042';

/**
 * Substitute when mc042 has no value (user decision 2026-09-20, the day after
 * mc042 went silent as the only one of Berlin's 15 stations). Karl-Marx-Str. 38
 * is the nearest LIVE station — 0.9 km from Herrfurthplatz, closer to the
 * Schillerkiez than Nansenstraße itself (1.4 km) — but it is a TRAFFIC station
 * at the kerb of a main road: values lean higher than in residential streets,
 * and it has no O₃/CO sensor. It is therefore ONLY shown live, clearly
 * labelled, with that caveat — never logged, never part of the 7-day history
 * (a main-road station mixed into a residential series would bend the record).
 * The nearest station of the same kind (Mitte, background) is 4 km away.
 */
export const FALLBACK_STATION = {
  id: 'mc221',
  name: 'Karl-Marx-Straße',
  kind: 'traffic',
  distanceKm: 0.9,
} as const;
export const PRIMARY_STATION_NAME = 'Nansenstraße';

export interface BlumeStationData {
  station: string;
  data: BlumeComponent[];
}

export interface BlumeComponent {
  datetime: string; // ISO with explicit offset, e.g. "2026-07-13T18:00:00+02:00"
  component: string; // "lqi" | "pm10" | "no2" | "o3" | "co"
  value: number | null;
  grade: number | null;
}

/** An LQI / pollutant grade is 1 (sehr gut) … 5 (sehr schlecht). Anything else is not a grade. */
export function isValidGrade(g: number | null | undefined): g is number {
  return typeof g === 'number' && Number.isInteger(g) && g >= 1 && g <= 5;
}

/**
 * BLUME reports „no measurement" as the NUMBER -1 (grade and value), not as
 * null — seen live 2026-09-19 22:00 for every component of mc042. Every
 * consumer only checked `== null`, so -1 was shown on the Kiez-Daten strip
 * („Luftgüte: -1"), logged as a reading, averaged into the day (lqiMean -0.1)
 * and served to the public landing page. Normalised HERE, at the one place the
 * data enters the app, so the existing null paths do the right thing: the
 * live route answers 502 → the strip's „station silent" state; the logger logs
 * nothing → the gap is the honest record.
 */
export function normalizeBlumeComponents(data: BlumeComponent[]): BlumeComponent[] {
  return data.map((c) => {
    const grade = isValidGrade(c.grade) ? c.grade : null;
    const value = typeof c.value === 'number' && c.value >= 0 ? c.value : null;
    return grade === c.grade && value === c.value ? c : { ...c, grade, value };
  });
}

const hasLqi = (data: BlumeComponent[]): boolean => data.some((c) => c.component === 'lqi' && isValidGrade(c.grade));

export interface AirSourcePick {
  source: 'primary' | 'substitute';
  station: string;
  data: BlumeComponent[];
}

/** Which station the LIVE strip shows: mc042 whenever it has a real LQI, else the labelled substitute, else nothing. Expects normalised data. Never any third station. */
export function pickAirSource(all: BlumeStationData[]): AirSourcePick | null {
  const primary = all.find((s) => s.station === BLUME_STATION_ID);
  if (primary && hasLqi(primary.data)) return { source: 'primary', station: primary.station, data: primary.data };
  const sub = all.find((s) => s.station === FALLBACK_STATION.id);
  if (sub && hasLqi(sub.data)) return { source: 'substitute', station: sub.station, data: sub.data };
  return null;
}

/** Every station of the live feed, „no measurement" already normalised to null. One request serves all stations. Throws on network error or non-OK status. */
export async function fetchBlumeAll(): Promise<BlumeStationData[]> {
  const res = await fetch(BLUME_LQI_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`BLUME API returned ${res.status}`);
  const stations: BlumeStationData[] = await res.json();
  return stations.map((s) => ({ station: s.station, data: normalizeBlumeComponents(s.data) }));
}

/** mc042's current component list — what the LOGGER and the print page use (never the substitute). Throws on network error, non-OK status, or missing station. */
export async function fetchMc042(): Promise<BlumeComponent[]> {
  const mc042 = (await fetchBlumeAll()).find((s) => s.station === BLUME_STATION_ID);
  if (!mc042) throw new Error('Station mc042 not found');
  return mc042.data;
}
