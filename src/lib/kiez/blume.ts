// Shared BLUME (luftdaten.berlin.de) fetch for station mc042 — used by the
// public /api/kiez-air route and the air logger. Server-only.
export const BLUME_LQI_URL = 'https://luftdaten.berlin.de/api/lqis/data';
export const BLUME_STATION_ID = 'mc042';

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

/** Fetch mc042's current component list („no measurement" already normalised to null). Throws on network error, non-OK status, or missing station. */
export async function fetchMc042(): Promise<BlumeComponent[]> {
  const res = await fetch(BLUME_LQI_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`BLUME API returned ${res.status}`);
  const stations: Array<{ station: string; data: BlumeComponent[] }> = await res.json();
  const mc042 = stations.find((s) => s.station === BLUME_STATION_ID);
  if (!mc042) throw new Error('Station mc042 not found');
  return normalizeBlumeComponents(mc042.data);
}
