/**
 * Folding long comments — pure rules, no imports (ships in island bundles).
 * A long comment shows its first FOLD_LINES lines and a „mehr anzeigen" button, so one
 * long answer does not push the rest of the thread far down. Only a comment that is
 * CLEARLY longer folds: hiding two lines behind a button would be worse than showing them.
 */
export const FOLD_LINES = 8;
export const FOLD_FROM_LINES = 11;

/** `fullPx` = the text's natural height, `linePx` = one line of it. */
export function shouldFold(fullPx: number, linePx: number): boolean {
  if (!(fullPx > 0) || !(linePx > 0)) return false;
  return fullPx > linePx * FOLD_FROM_LINES;
}

export function foldedHeight(linePx: number): number {
  return linePx * FOLD_LINES;
}
