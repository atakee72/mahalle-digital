<!-- src/components/search/SearchModal.svelte -->
<script lang="ts">
  // Masthead search modal (2026-09-25, user: „a modal in the middle of the
  // page with a background blurring everything behind"). Scrim and box are
  // SIBLINGS — the blur must never be an ancestor of the fixed box (root
  // CLAUDE.md, backdrop-filter containing block). Mounted by KioskNav as the
  // last child of <header>, whose z-50 (searchOpen) covers the bottom nav.
  // Live top hits per section from the shared runner; Enter / „Alle Treffer"
  // → full navigation to /search?q=. Scroll lock html-only, focus trap,
  // Escape / scrim close, instant close (notification-panel ruling).
  // Styles .sm-* in global.css, never here (nested island).
  import { tick } from 'svelte';
  import { t, tStr } from '../../lib/kiosk-i18n';
  import { lockPageScroll } from '../../lib/scrollLock';
  import { SEARCH_MAX_LEN } from '../../lib/forum/searchQuery';
  import { SECTIONS, SECTION_LABEL_KEY, SECTION_ACCENT, MODAL_PER_SECTION, countHits } from '../../lib/search/siteSearch';
  import { createSearchRunner } from '../../lib/search/searchRunner.svelte';
  import SearchHit from './SearchHit.svelte';

  let { onClose }: { onClose: (restoreFocus: boolean, opts?: { navigating?: boolean }) => void } = $props();

  const runner = createSearchRunner();
  let boxEl = $state<HTMLElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  const counts = $derived(runner.hits ? countHits(runner.hits) : null);
  const resultsHref = $derived(`/search?q=${encodeURIComponent(runner.normalized ?? '')}`);

  $effect(() => lockPageScroll()); // the returned closure restores <html> on unmount
  $effect(() => { tick().then(() => inputEl?.focus()); });

  function close(fromEscape = false) {
    const restoreFocus = fromEscape || (boxEl?.contains(document.activeElement) ?? false);
    onClose(restoreFocus);
  }
  // Tab trap walks EVERY control; the arrows walk only input → hits → footer
  // (skipping the × and Esc buttons, which a keyboard user reaches by Tab).
  function focusables(): HTMLElement[] {
    return boxEl ? Array.from(boxEl.querySelectorAll<HTMLElement>('input, a[href], button:not([disabled])')) : [];
  }
  function rovers(): HTMLElement[] {
    return boxEl ? Array.from(boxEl.querySelectorAll<HTMLElement>('input, a.sh, a.sm-foot')) : [];
  }
  function onDocKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
  }
  function onBoxKeydown(e: KeyboardEvent) {
    const active = document.activeElement as HTMLElement;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const els = rovers();
      if (!els.length) return;
      e.preventDefault();
      const i = els.indexOf(active);
      els[e.key === 'ArrowDown' ? (i + 1) % els.length : (i - 1 + els.length) % els.length].focus();
    } else if (e.key === 'Tab') {
      // Focus trap (WAI-ARIA dialog): Tab cycles inside the box.
      const els = focusables();
      if (!els.length) return;
      const i = els.indexOf(active);
      if (e.shiftKey && i <= 0) { e.preventDefault(); els[els.length - 1].focus(); }
      else if (!e.shiftKey && i === els.length - 1) { e.preventDefault(); els[0].focus(); }
    }
  }
  $effect(() => {
    document.addEventListener('keydown', onDocKeydown);
    return () => document.removeEventListener('keydown', onDocKeydown);
  });
  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!runner.normalized) return;
    window.location.href = resultsHref;
  }
  // A hit link can be a same-page hash (e.g. a comment on the post detail
  // page the modal was opened from) — no page swap happens, so without this
  // the modal would stay open (and scroll-locked) over the in-page scroll.
  // Close on any hit-row or footer click; never preventDefault, the
  // navigation itself must still happen.
  function onBodyClick(e: MouseEvent) {
    const a = (e.target as Element | null)?.closest('a.sh, a.sm-foot');
    if (a) onClose(false, { navigating: true });
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="sm-scrim" data-search-scrim onclick={() => close(false)}></div>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div bind:this={boxEl} id="site-search" class="sm-box" role="dialog" aria-modal="true" aria-label={$t['nav.search.aria']} onkeydown={onBoxKeydown}>
  <form class="sm-head" role="search" onsubmit={submit}>
    <span class="font-dmmono text-[15px] text-ink-mute" aria-hidden="true">⌕</span>
    <input bind:this={inputEl} value={runner.query} oninput={(e) => (runner.query = e.currentTarget.value)} type="text" inputmode="search" enterkeyhint="search" maxlength={SEARCH_MAX_LEN} autocomplete="off" placeholder={$t['nav.search.placeholder']} aria-label={$t['nav.search.aria']} class="sm-input" />
    {#if runner.query}
      <button type="button" class="sm-clear" onclick={() => { runner.query = ''; inputEl?.focus(); }} aria-label={$t['search.clear']}>×</button>
    {/if}
    <button type="button" class="sm-esc kiosk-tap" onclick={() => close(true)} aria-label={$t['nav.search.close']}>Esc</button>
  </form>
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="sm-body" onclick={onBodyClick}>
    {#if !runner.normalized}
      <p class="sm-note">{$t['search.hint']}</p>
    {:else if runner.failed}
      <p class="sm-note">{$t['search.unavailable']}</p>
    {:else if runner.pending || runner.loading}
      <p class="sm-note" aria-live="polite">{$t['search.searching']}</p>
    {:else if counts && counts.total === 0}
      <p class="sm-note">{$t['search.none']}</p>
    {:else if runner.hits}
      {#each SECTIONS as section (section)}
        {@const rows = runner.hits.hits[section]}
        {#if rows.length}
          <section class="sm-group" data-modal-group={section}>
            <h3 class="sm-kicker" style="color: {SECTION_ACCENT[section]}">{$t[SECTION_LABEL_KEY[section]]} · {rows.length}</h3>
            {#each rows.slice(0, MODAL_PER_SECTION) as hit (hit.kind + hit.id)}
              <SearchHit {hit} q={runner.normalized ?? ''} compact />
            {/each}
          </section>
        {/if}
      {/each}
    {/if}
  </div>
  {#if counts && counts.total > 0}
    <a class="sm-foot" href={resultsHref} onclick={onBodyClick}>{tStr($t['search.all'], { n: counts.total })} →</a>
  {/if}
</div>
