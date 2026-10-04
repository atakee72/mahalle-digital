<!-- Styles live in global.css (.ktr-*) — this component is only imported by
     other islands, and nested-island <style> blocks get orphaned in prod. -->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t, locale } from '../../../lib/kiosk-i18n';
  import { pickTargetLang, requestTranslation } from '../../../lib/translation/client';

  let {
    contentType,
    contentId,
    onTranslated,
    accent = 'inherit',
    autoOpen = false,
  }: {
    contentType: string;
    contentId: string;
    onTranslated: (t: { title: string | null; body: string } | null) => void;
    accent?: string;
    /** open the translation once on mount (a link from the English Kiez-Brief) */
    autoOpen?: boolean;
  } = $props();

  // Named `phase` rather than the brief's `state` — a local variable named
  // literally `state` alongside a second `$state<T>()` call in the same
  // file trips a svelte-check@4 / svelte5 transform bug (spurious "used
  // before its declaration" + implicit-any on the rune itself). Verified
  // in isolation; renaming is a no-op behaviorally.
  let phase = $state<'idle' | 'working' | 'shown'>('idle');
  let error = $state<string | null>(null);
  let cache: { title: string | null; body: string } | null = null;
  let destroyed = false;
  onDestroy(() => {
    destroyed = true;
  });
  onMount(() => { if (autoOpen) void toggle(); });

  async function toggle() {
    error = null;
    if (phase === 'shown') {
      phase = 'idle';
      onTranslated(null);
      return;
    }
    if (cache) {
      phase = 'shown';
      onTranslated(cache);
      return;
    }
    phase = 'working';
    const target = pickTargetLang($locale);
    const res = await requestTranslation(contentType, contentId, target);
    if (destroyed) return;
    if (!res.ok) {
      phase = 'idle';
      const known = ['translate_unavailable', 'rate_limited', 'too_long'];
      const key = res.error === 'translate_unavailable' ? 'unavailable' : res.error;
      error = $t[(known.includes(res.error) ? `tr.err.${key}` : 'tr.err.generic') as keyof typeof $t] ?? $t['tr.err.generic'];
      return;
    }
    cache = { title: res.title, body: res.body };
    phase = 'shown';
    onTranslated(cache);
  }
</script>

<div class="ktr">
  {#if phase === 'shown'}
    <span class="ktr-label">● {$t['tr.label']}</span>
  {/if}
  <button type="button" class="ktr-btn" style={`color:${accent}`} onclick={toggle} disabled={phase === 'working'}>
    <svg class="ktr-ico" viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg><span class="ktr-btn-text">{phase === 'working' ? $t['tr.working'] : phase === 'shown' ? $t['tr.original'] : $t['tr.show']}</span>
  </button>
  {#if error}
    <span class="ktr-err" role="status">{error}</span>
  {/if}
</div>
