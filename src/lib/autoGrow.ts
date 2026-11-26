/**
 * A textarea that grows with its text (Svelte action) — no imports, safe for islands.
 *
 *   <textarea bind:value={body} use:autoGrow={{ value: body, maxVh: 0.4 }} rows="3" />
 *
 * The box starts at the height its `rows`/`min-height` give it, grows line by line and
 * stops at the ceiling (`maxPx`, or `maxVh` × the visible viewport — on a phone that is the
 * part above the keyboard); only beyond the ceiling does the text scroll inside. Pass the
 * bound value as `value` so a programmatic change (cleared after sending, a picked
 * „@mention") re-measures too.
 */
export interface AutoGrowOptions {
  value?: string;
  /** Ceiling in px. */
  maxPx?: number;
  /** Ceiling as a share of the visible viewport height (0–1). The smaller of both wins. */
  maxVh?: number;
}

/** Pure: the height to set and whether the content now scrolls inside. */
export function grownHeight(contentPx: number, minPx: number, maxPx: number): { height: number; scroll: boolean } {
  const ceiling = Math.max(minPx, maxPx);
  if (contentPx > ceiling) return { height: ceiling, scroll: true };
  return { height: Math.max(minPx, contentPx), scroll: false };
}

export function autoGrow(node: HTMLTextAreaElement, options: AutoGrowOptions = {}) {
  let opts = options;
  let floor = 0;

  function ceiling(): number {
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const byVh = opts.maxVh ? vh * opts.maxVh : Infinity;
    const byPx = opts.maxPx ?? Infinity;
    const c = Math.min(byVh, byPx);
    return Number.isFinite(c) ? c : vh * 0.5;
  }

  function measure() {
    // Collapse first: scrollHeight never reports less than the current height.
    node.style.height = 'auto';
    if (!floor) floor = node.offsetHeight; // the rows/min-height box, read once
    const cs = getComputedStyle(node);
    const borders = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const { height, scroll } = grownHeight(node.scrollHeight + borders, floor, ceiling());
    node.style.height = `${height}px`;
    node.style.overflowY = scroll ? 'auto' : 'hidden';
  }

  node.addEventListener('input', measure);
  window.addEventListener('resize', measure);
  window.visualViewport?.addEventListener('resize', measure);
  measure();

  return {
    update(next: AutoGrowOptions = {}) {
      opts = next;
      measure();
    },
    destroy() {
      node.removeEventListener('input', measure);
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    },
  };
}
