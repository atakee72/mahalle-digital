// Pure decisions for the swipe-down-to-close gesture of the two phone bottom
// sheets (notification panel, account menu). NO imports: shared by islands.

export const DRAG_START_PX = 8;
export const CLOSE_MIN_PX = 80;
export const CLOSE_FRACTION = 0.25;
export const FLICK_MIN_PX = 24;
export const FLICK_VELOCITY = 0.5; // px per ms
export const VELOCITY_WINDOW_MS = 100;

export type Sample = { y: number; t: number };

/** 'drag' = take over, 'reject' = let the browser handle this pointer, 'wait' = not decided yet. */
export function shouldStart(args: { dx: number; dy: number; fromHandle: boolean; scrollTop: number }): 'drag' | 'reject' | 'wait' {
  const { dx, dy, fromHandle, scrollTop } = args;
  if (!fromHandle && scrollTop > 0) return 'reject';
  if (dy <= -DRAG_START_PX) return 'reject';
  if (dy >= DRAG_START_PX && dy > Math.abs(dx)) return 'drag';
  if (Math.abs(dx) > DRAG_START_PX) return 'reject';
  return 'wait';
}

/** px/ms over the last VELOCITY_WINDOW_MS; falls back to the whole gesture when the window holds < 2 samples. 0 when < 2 usable samples. */
export function velocityFrom(samples: readonly Sample[], nowMs: number): number {
  if (samples.length < 2) return 0;
  let usable = samples.filter((s) => nowMs - s.t <= VELOCITY_WINDOW_MS);
  if (usable.length < 2) usable = samples.slice();
  const first = usable[0];
  const last = usable[usable.length - 1];
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return (last.y - first.y) / dt;
}

export function decideRelease(args: { dy: number; velocity: number; height: number }): 'close' | 'snap' {
  const { dy, velocity, height } = args;
  if (dy >= Math.max(CLOSE_MIN_PX, CLOSE_FRACTION * height)) return 'close';
  if (dy >= FLICK_MIN_PX && velocity >= FLICK_VELOCITY) return 'close';
  return 'snap';
}

export function closeDurationMs(dy: number, height: number): number {
  if (height <= 0) return 0;
  return Math.max(0, Math.min(150, Math.round(150 * (1 - dy / height))));
}
