<!-- src/components/blog/kiosk/BlogTranslate.svelte
     „Übersetzung anzeigen" for a blog article. Mounted client:only from the three
     blog layouts ABOVE the server-rendered body (#bl-original). Shown: renders the
     translated blocks with the layout's own bl-prose classes (text interpolation only,
     never HTML), hides #bl-original and tells BlogArticleHeader the translated
     title/standfirst through the `bl:translation` document event. Reuses the .ktr-*
     classes from global.css; the blog's accent is rust. -->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t, locale } from '../../../lib/kiosk-i18n';
  import { pickTargetLang, requestBlogTranslation } from '../../../lib/translation/client';
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
    {phase === 'working' ? $t['tr.working'] : phase === 'shown' ? $t['tr.original'] : $t['tr.show']}
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
