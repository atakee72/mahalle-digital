<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../../lib/kiosk-i18n';

  // Asks the DB on every page load (no session cache: the answer flips when the address is changed).
  let visible = $state(false);

  onMount(async () => {
    try {
      const res = await fetch('/api/auth/account-status');
      if (!res.ok) return;
      const data = await res.json();
      visible = data?.emailBounced === true;
    } catch { /* network error → don't nag */ }
  });
</script>

{#if visible}
  <div class="bounce-banner" role="status">
    <div class="bounce-banner-inner">
      <span class="font-dmmono bounce-banner-dot" aria-hidden="true">✉</span>
      <span class="font-bricolage bounce-banner-text">{$t['auth.bounce.banner']}</span>
      <a href="/profile" class="font-bricolage bounce-banner-cta">{$t['auth.bounce.cta']}</a>
    </div>
  </div>
{/if}

<style>
  .bounce-banner {
    background: var(--k-paper-warm);
    border-bottom: 1.5px solid var(--k-ink);
    border-top: 3px solid var(--k-ochre);
  }
  .bounce-banner-inner {
    max-width: 80rem;
    margin: 0 auto;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .bounce-banner-dot { font-size: 14px; color: var(--k-ochre); flex-shrink: 0; }
  .bounce-banner-text { font-size: 13px; color: var(--k-ink-soft); line-height: 1.4; flex: 1; min-width: 0; }
  .bounce-banner-cta {
    flex-shrink: 0;
    background: var(--k-ink);
    color: var(--k-paper);
    font-size: 12px;
    font-weight: 700;
    padding: 6px 14px;
    border-radius: 999px;
    border: 1.5px solid var(--k-ink);
    box-shadow: 2px 2px 0 var(--k-ochre);
    text-decoration: none;
    white-space: nowrap;
  }
</style>
