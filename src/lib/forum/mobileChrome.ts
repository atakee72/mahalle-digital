// Phone-only chrome of the forum index (2026-09-20): one summary bar for
// the pinned officials and a "# Tags" chip instead of the tag row.
// Dependency-pure on purpose — imported by client islands.

export type PinStackMode = 'single' | 'folded' | 'unfolded';

// 0–1 pins: nothing to fold, render the bars as always. 2–3 pins: phones
// start with ONE summary bar; a tap unfolds the usual bars. (Tablet and
// desktop ignore the mode — they always show the bars, via CSS.)
export function pinStackMode(count: number, unfolded: boolean): PinStackMode {
  if (count <= 1) return 'single';
  return unfolded ? 'unfolded' : 'folded';
}

// The chip names the active tag so a folded tag row never hides the fact
// that a filter is on.
export function tagsChipLabel(activeTag: string | null | undefined, fallback: string): string {
  const tag = (activeTag ?? '').trim();
  return tag ? `#${tag}` : fallback;
}
