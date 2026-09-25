<script lang="ts">
  // Magnifier disc in the masthead's right cluster — sibling of the bell disc
  // (same 36 px paper-warm disc, frame in the bar's text colour, bevel; styles
  // in global.css `.ms-*`, never here: a nested island's <style> is orphaned
  // in prod builds). Click opens the search modal (SearchModal, mounted by KioskNav);
  // on /search itself the disc is a plain link to the page's own box.
  import { t } from '../../../lib/kiosk-i18n';
  let { open = false, onToggle, currentPath = '/' } = $props<{
    open?: boolean;
    onToggle: () => void;
    currentPath?: string;
  }>();
  const onSearchPage = $derived(currentPath === '/search' || currentPath.startsWith('/search?'));
</script>

{#if onSearchPage}
  <a href="/search" aria-current="page" aria-label={$t['nav.search.aria']} class="ms-btn">
    <span class="ms-disc ms-disc--active">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>
    </span>
  </a>
{:else}
  <button type="button" onclick={onToggle} aria-expanded={open} aria-controls="site-search" aria-haspopup="dialog" aria-label={$t['nav.search.aria']} class="ms-btn" data-mast-search-btn>
    <span class="ms-disc" class:ms-disc--active={open}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>
    </span>
  </button>
{/if}
