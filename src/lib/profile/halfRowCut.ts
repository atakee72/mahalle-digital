// Pure helper for the profile Archive box (2026-09-28): the box is capped
// (CSS max-height); when the list overflows, the visible height is trimmed
// so the cap lands HALFWAY through a row — a cut-off row is the hint that
// more is below (user: „cutting the last one on the list halfway").

export type RowBox = { top: number; height: number };

/**
 * Returns the height that ends in the middle of the row crossing `cap`, or
 * null when nothing overflows (or the crossing row is the first one — a box
 * that shows half a row and nothing else would be worse than the cap).
 */
export function halfRowCutHeight(rows: RowBox[], cap: number): number | null {
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];
  if (last.top + last.height <= cap) return null;
  const i = rows.findIndex((r) => r.top + r.height > cap);
  if (i <= 0) return null;
  const r = rows[i];
  // The row starts inside the box: cut through its middle. If it starts at
  // or past the cap (no row crosses), show half of it anyway so the hint holds.
  return Math.round(r.top + r.height / 2);
}
