<!-- src/components/blog/kiosk/BlogTranslate.svelte
     „Übersetzung anzeigen" for a blog article. Mounted client:only from the three
     blog layouts ABOVE the server-rendered body (#bl-original). Shown: renders the
     translated blocks with the layout's own bl-prose classes (text interpolation only,
     never HTML), hides #bl-original and tells BlogArticleHeader the translated
     title/standfirst through the `bl:translation` document event. Reuses the .ktr-*
     classes from global.css; the blog's accent is rust. -->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t, locale } from '../../../lib/kiosk-i18n';
  import { pickTargetLang, requestBlogTranslation, wantsAutoTranslate } from '../../../lib/translation/client';
  import type { Block } from '../../../lib/blog/markdownBlocks';

  let {
    slug,
    proseClass,
    controlClass = '',
  }: {
    slug: string;
    proseClass: string;
    controlClass?: string;
  } = $props();

  type Tr = { title: string; description: string; blocks: Block[]; lang: string };

  // `phase`, not `state` — see TranslateControl.svelte for the svelte-check trap.
  let phase = $state<'idle' | 'working' | 'shown'>('idle');
  let error = $state<string | null>(null);
  let shown = $state<Tr | null>(null);
  let cache: Tr | null = null;
  let destroyed = false;

  const ERR_KEY: Record<string, string> = {
    translate_unavailable: 'tr.err.unavailable',
    rate_limited: 'tr.err.rate_limited',
    too_long: 'tr.err.too_long',
    Unauthorized: 'tr.err.login',
    http_401: 'tr.err.login',
  };

  function publish(tr: Tr | null) {
    const original = document.getElementById('bl-original');
    if (original) original.style.display = tr ? 'none' : '';
    document.dispatchEvent(
      new CustomEvent('bl:translation', { detail: tr ? { title: tr.title, description: tr.description } : null })
    );
  }

  onDestroy(() => {
    destroyed = true;
    if (shown) publish(null);
  });
  // A link from the English Kiez-Brief carries ?translate=1: open the translation on load.
  onMount(() => { if (wantsAutoTranslate($locale)) void toggle(); });

  async function toggle() {
    error = null;
    if (phase === 'shown') {
      phase = 'idle';
      shown = null;
      publish(null);
      return;
    }
    if (cache) {
      shown = cache;
      phase = 'shown';
      publish(cache);
      return;
    }
    phase = 'working';
    const lang = pickTargetLang($locale);
    const res = await requestBlogTranslation(slug, lang);
    if (destroyed) return;
    if (!res.ok) {
      phase = 'idle';
      error = $t[(ERR_KEY[res.error] ?? 'tr.err.generic') as keyof typeof $t];
      return;
    }
    cache = { title: res.title, description: res.description, blocks: res.blocks, lang };
    shown = cache;
    phase = 'shown';
    publish(cache);
  }
</script>

<div class="ktr bl-print-hide {controlClass}" style="margin: 12px 0 2px;">
  {#if phase === 'shown'}
    <span class="ktr-label">● {$t['tr.label']}</span>
  {/if}
  <button type="button" class="ktr-btn" style="color: var(--k-rust);" onclick={toggle} disabled={phase === 'working'}>
    <svg class="ktr-ico" viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg><span class="ktr-btn-text">{phase === 'working' ? $t['tr.working'] : phase === 'shown' ? $t['tr.original'] : $t['tr.show']}</span>
  </button>
  {#if error}
    <span class="ktr-err" role="status">{error}</span>
  {/if}
</div>

{#if shown}
  <div class={proseClass} lang={shown.lang} data-bl-translation>
    {#each shown.blocks as b, i (i)}
      {#if b.kind === 'ul'}
        <ul>{#each b.items as item, j (j)}<li>{item}</li>{/each}</ul>
      {:else if b.kind === 'ol'}
        <ol>{#each b.items as item, j (j)}<li>{item}</li>{/each}</ol>
      {:else if b.kind === 'h2'}
        <h2>{b.text}</h2>
      {:else if b.kind === 'h3'}
        <h3>{b.text}</h3>
      {:else if b.kind === 'quote'}
        <blockquote><p>{b.text}</p></blockquote>
      {:else if b.kind === 'p'}
        <p>{b.text}</p>
      {/if}
    {/each}
  </div>
{/if}
