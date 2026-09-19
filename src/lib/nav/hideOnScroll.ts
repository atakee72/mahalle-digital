/**
 * Hide-on-scroll for the kiosk masthead on phones/tablets. PURE — no DOM, so
 * it is unit-tested and safe to import from any island.
 *
 * Rules (user decision 2026-09-19): top bar only, below `lg` only; hide after
 * a deliberate scroll down, show on the FIRST scroll up; always visible near
 * the top of the page and whenever the caller says `locked`.
 */

/** Below Tailwind's `lg` — the viewports that get the bottom nav. */
export const MAST_HIDE_QUERY = '(max-width: 1023.98px)';

/** px from the top where the bar is always shown. */
export const TOP_ZONE = 80;
/** px of continuous DOWNWARD travel before the bar hides (a deliberate scroll, not a nudge). */
export const HIDE_AFTER = 24;
/** px of continuous UPWARD travel before it returns (more than finger jitter). */
export const SHOW_AFTER = 8;
/** A single-step jump larger than this is programmatic (scroll restore, anchor), not a gesture. */
export const TELEPORT = 600;

export interface MastState {
  hidden: boolean;
  /** Last clamped scroll position seen. */
  lastY: number;
  /** Where the current direction of travel started. */
  anchorY: number;
  dir: -1 | 0 | 1;
}

export const initialMastState = (y = 0): MastState => ({ hidden: false, lastY: y, anchorY: y, dir: 0 });

export function nextMastState(prev: MastState, rawY: number, maxY: number, locked: boolean): MastState {
  // iOS rubber-bands past both ends: clamp, or the bounce reads as a scroll the other way.
  const y = Math.min(Math.max(rawY, 0), Math.max(maxY, 0));
  if (locked || y <= TOP_ZONE) return { hidden: false, lastY: y, anchorY: y, dir: 0 };

  const step = y - prev.lastY;
  if (step === 0) return prev;
  if (Math.abs(step) > TELEPORT) return { ...prev, lastY: y, anchorY: y, dir: 0 };

  const dir: -1 | 1 = step > 0 ? 1 : -1;
  const anchorY = dir === prev.dir ? prev.anchorY : prev.lastY;
  const travel = Math.abs(y - anchorY);

  let hidden = prev.hidden;
  if (dir === 1 && travel >= HIDE_AFTER) hidden = true;
  if (dir === -1 && travel >= SHOW_AFTER) hidden = false;
  return { hidden, lastY: y, anchorY, dir };
}

/**
 * For code that scrolls the page so something lands "right under the masthead":
 * the scroll itself may hide or show the bar, so aim at where the bar WILL be.
 * `delta` = the scroll distance computed against the bar's current bottom
 * (positive = down); `hides` = whether this viewport hides the bar at all;
 * `currentY` = the scroll position before the scroll.
 */
export function mastBottomAfterScroll(delta: number, mastH: number, currentBottom: number, hides: boolean, currentY: number): number {
  if (!hides) return currentBottom;
  if (currentY + delta <= TOP_ZONE) return mastH; // the bar is always shown near the top
  if (delta >= HIDE_AFTER) return 0;
  if (delta <= -SHOW_AFTER) return mastH;
  return Math.max(currentBottom, 0);
}
