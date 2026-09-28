// src/lib/landing/loop.ts
/** Autoplay maths for the landing Schaufenster strip (2026-09-28). Pure. */

/** Next scrollLeft: once the first copy has fully passed, jump back by exactly one copy — invisible because both copies are identical. */
export function advance(scrollLeft: number, halfWidth: number, dx: number): number {
  const next = scrollLeft + dx;
  return halfWidth > 0 && next >= halfWidth ? next - halfWidth : next;
}

/** Index (0..count-1) of the frame nearest the left edge; `step` = frame width + gap. */
export function activeIndex(scrollLeft: number, step: number, count: number): number {
  if (!(step > 0) || !(count > 0)) return 0;
  return ((Math.round(scrollLeft / step) % count) + count) % count;
}
