// Svelte action: drag a phone bottom sheet down to close it.
// Attached to the sheet ROOT (.nc-menu / .am-menu). Below 1024 px only; on
// desktop it returns at pointerdown and changes nothing. Rules live in the
// pure sheetDragRules.ts.
import { shouldStart, velocityFrom, decideRelease, closeDurationMs, type Sample } from './sheetDragRules';

export type DragToCloseOptions = {
  /** The sheet's card — also the scroll container on phones. */
  card: () => HTMLElement | null | undefined;
  /** Selector of the zones where a drag may start whatever the scroll position. */
  handles: string;
  /** The component's close path, called once the sheet is off the screen. */
  onClose: () => void;
  /** True while the component is already closing (blocks a new gesture). */
  disabled?: () => boolean;
};

const SNAP_EASE = 'transform 180ms cubic-bezier(0.2, 0.7, 0.3, 1)';

export function dragToClose(node: HTMLElement, initial: DragToCloseOptions) {
  let opts = initial;
  let destroyed = false;
  let finishing = false;

  // Per-gesture state
  let pointerId: number | null = null;
  let state: 'idle' | 'pending' | 'active' | 'rejected' = 'idle';
  let startX = 0;
  let startY = 0;
  let fromHandle = false;
  let scrollTop = 0;
  let dy = 0;
  let samples: Sample[] = [];
  let card: HTMLElement | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];

  function later(fn: () => void, ms: number) {
    const id = setTimeout(fn, ms);
    timers.push(id);
  }

  // Native scroll can only be stopped by a non-passive touchmove listener.
  function onTouchMove(e: TouchEvent) {
    if (state === 'active' && e.cancelable) e.preventDefault();
  }

  function detach() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    node.removeEventListener('lostpointercapture', onUp);
    card?.removeEventListener('touchmove', onTouchMove);
  }

  function reset() {
    detach();
    if (pointerId !== null) {
      try { node.releasePointerCapture(pointerId); } catch { /* already released */ }
    }
    pointerId = null;
    state = 'idle';
    samples = [];
    dy = 0;
  }

  function onDown(e: PointerEvent) {
    if (destroyed || finishing || state !== 'idle') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!window.matchMedia('(max-width: 1023px)').matches) return;
    if (opts.disabled?.()) return;
    card = opts.card() ?? null;
    if (!card) return;
    const target = e.target as Element | null;
    fromHandle = !!target?.closest && !!target.closest(opts.handles) && node.contains(target);
    scrollTop = card.scrollTop;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    dy = 0;
    samples = [{ y: 0, t: e.timeStamp }];
    state = 'pending';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    card.addEventListener('touchmove', onTouchMove, { passive: false });
  }

  function onMove(e: PointerEvent) {
    if (e.pointerId !== pointerId || !card) return;
    const mx = e.clientX - startX;
    const my = e.clientY - startY;
    if (state === 'pending') {
      const verdict = shouldStart({ dx: mx, dy: my, fromHandle, scrollTop });
      if (verdict === 'reject') { state = 'rejected'; return; }
      if (verdict === 'wait') return;
      state = 'active';
      try { node.setPointerCapture(e.pointerId); } catch { /* pointer gone */ }
      node.addEventListener('lostpointercapture', onUp);
      card.style.transition = 'none';
    }
    if (state !== 'active') return;
    dy = my;
    samples.push({ y: my, t: e.timeStamp });
    if (samples.length > 8) samples.shift();
    card.style.transform = `translateY(${Math.max(0, my)}px)`;
  }

  // A drag that ends on a link/button must not also click it.
  function swallowNextClick() {
    const onClick = (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation(); cleanup(); };
    const cleanup = () => { document.removeEventListener('click', onClick, true); clearTimeout(timer); };
    document.addEventListener('click', onClick, true);
    const timer = setTimeout(cleanup, 400);
  }

  function clearInline() {
    if (!card) return;
    card.style.transform = '';
    card.style.transition = '';
  }

  function onUp(e: Event) {
    if (destroyed) return; // the close path unmounted us mid-gesture
    if ('pointerId' in e && (e as PointerEvent).pointerId !== pointerId) return;
    const wasActive = state === 'active';
    const el = card;
    const travelled = Math.max(0, dy);
    const velocity = velocityFrom(samples, (e as PointerEvent).timeStamp ?? performance.now());
    reset();
    if (!wasActive || !el) return;
    swallowNextClick();

    const height = el.offsetHeight;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const verdict = decideRelease({ dy: travelled, velocity, height });

    if (verdict === 'snap') {
      if (reduced) { clearInline(); return; }
      el.style.transition = SNAP_EASE;
      el.style.transform = 'translateY(0px)';
      const done = () => { el.removeEventListener('transitionend', done); clearInline(); };
      el.addEventListener('transitionend', done);
      later(done, 220);
      return;
    }

    finishing = true;
    if (reduced) { opts.onClose(); return; }
    // The sheet is already moving under the finger; it finishes the travel,
    // then the component's own close path runs (no extra exit animation).
    el.style.transition = `transform ${closeDurationMs(travelled, height)}ms linear`;
    el.style.transform = 'translateY(100%)';
    later(() => { if (!destroyed) opts.onClose(); }, closeDurationMs(travelled, height) + 20);
  }

  node.addEventListener('pointerdown', onDown);

  return {
    update(next: DragToCloseOptions) { opts = next; },
    destroy() {
      destroyed = true;
      node.removeEventListener('pointerdown', onDown);
      detach();
      timers.forEach(clearTimeout);
      timers = [];
    },
  };
}
