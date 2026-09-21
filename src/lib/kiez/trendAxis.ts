// Time-true x positions for the Kiez-Daten trend charts. Dependency-pure.
//
// The imported AfS editions are NOT evenly spaced (2021h2, 2022h2, 2023h1, …,
// 2024h1, 2025h1 — 2022h1 and 2024h2 were never imported), but the charts used
// to place point i at i/(n-1): a full year looked like a half year and the
// slope was wrong in those places (found 2026-09-21). A point now sits where
// its reference date is.

/** Reference date of a period as a fractional year: "2026h1" = 30 June 2026 →
 *  2026.5, "2025h2" = 31 Dec 2025 → 2026, a plain MSS year "2023" = end of that
 *  year → 2024. NaN for anything else. */
export function periodTime(period: string): number {
  const half = period.match(/^(\d{4})h([12])$/);
  if (half) return Number(half[1]) + (half[2] === '1' ? 0.5 : 1);
  const year = period.match(/^(\d{4})$/);
  return year ? Number(year[1]) + 1 : NaN;
}

/** x for every point, proportional to time between `start` and `end`. One point
 *  (or no usable time span) sits in the middle; a point without a valid time
 *  falls back to its index position so nothing ever lands on NaN. */
export function trendXs(times: number[], start: number, end: number): number[] {
  const n = times.length;
  if (n === 0) return [];
  const valid = times.filter((t) => Number.isFinite(t));
  const min = Math.min(...valid);
  const span = Math.max(...valid) - min;
  if (n === 1 || !valid.length || !(span > 0)) {
    return times.map((_, i) => (n > 1 ? start + i * ((end - start) / (n - 1)) : (start + end) / 2));
  }
  return times.map((t, i) =>
    Number.isFinite(t) ? start + ((t - min) / span) * (end - start) : start + i * ((end - start) / (n - 1))
  );
}
