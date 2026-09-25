<!-- src/components/search/SearchPage.svelte -->
<script lang="ts">
  // /search results — site-wide since 2026-09-25 (forum only from 09-24).
  // The page SSRs the first `?q=`; the runner (shared with the masthead
  // modal) debounces later keystrokes. Section chips filter client-side and
  // ride in `?s=`; „Alle" lists every section as a group in nav order.
  // URL sync keeps Astro's ClientRouter state (root CLAUDE.md).
  import { onMount } from 'svelte';
  import { t, tStr } from '../../lib/kiosk-i18n';
  import { SEARCH_MAX_LEN } from '../../lib/forum/searchQuery';
  import { SECTIONS, SECTION_LABEL_KEY, SECTION_ACCENT, countHits, type SiteSearchResult, type SearchSection } from '../../lib/search/siteSearch';
  import { createSearchRunner } from '../../lib/search/searchRunner.svelte';
  import SearchHit from './SearchHit.svelte';

  let { initialQuery = '', initialResults = null, initialSection = 'all' } = $props<{
    initialQuery?: string;
    initialResults?: SiteSearchResult | null;
    initialSection?: SearchSection | 'all';
  }>();

  const runner = createSearchRunner({ query: initialQuery, results: initialResults });
  let section = $state<SearchSection | 'all'>(initialSection);
  let inputEl = $state<HTMLInputElement | null>(null);

  const counts = $derived(runner.hits ? countHits(runner.hits) : null);
  const shown = $derived.by((): SearchSection[] => {
    if (!runner.hits) return [];
    const list = section === 'all' ? SECTIONS : [section];
    return list.filter((s) => runner.hits!.hits[s].length > 0);
  });
  const shownTotal = $derived(counts ? shown.reduce((n, s) => n + counts.bySection[s], 0) : 0);

  onMount(() => { if (!runner.query) inputEl?.focus(); });
  $effect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (runner.normalized) url.searchParams.set('q', runner.normalized); else url.searchParams.delete('q');
    if (section !== 'all') url.searchParams.set('s', section); else url.searchParams.delete('s');
    window.history.replaceState(window.history.state, '', url.toString());
  });

  const kicker = $derived.by(() => {
    if (!runner.normalized) return $t['search.hint'];
    if (runner.failed) return $t['search.unavailable'];
    if (runner.loading || runner.pending) return $t['search.searching'];
    return tStr($t['search.count'], { n: counts?.total ?? 0 });
  });
</script>

<!-- A <div>, not <main>: KioskLayout already provides the page's main landmark. -->
<div class="max-w-3xl mx-auto pb-10" data-search-page>
  <section class="px-[18px] py-2.5 bg-paper-warm border-b border-dashed border-rule">
    <div class="flex items-center gap-2 bg-paper border-[1.5px] border-ink rounded-full px-3.5 py-2">
      <span class="font-dmmono text-[14px] text-ink-mute pointer-events-none shrink-0" aria-hidden="true">⌕</span>
      <!-- type="text": Chrome draws its own clear button on type="search" (prod, 09-24). -->
      <input
        bind:this={inputEl}
        type="text" inputmode="search" enterkeyhint="search"
        maxlength={SEARCH_MAX_LEN}
        value={runner.query}
        oninput={(e) => (runner.query = e.currentTarget.value)}
        placeholder={$t['nav.search.placeholder']}
        aria-label={$t['nav.search.aria']}
        autocomplete="off"
        class="flex-1 min-w-0 bg-transparent border-none outline-none font-bricolage text-[14px] font-semibold text-ink placeholder:text-ink-mute placeholder:font-normal"
      />
      {#if runner.query}
        <button type="button" onclick={() => { runner.query = ''; inputEl?.focus(); }} aria-label={$t['search.clear']}
          class="shrink-0 w-4 h-4 rounded-full bg-ink-mute text-paper text-[9px] font-bold flex items-center justify-center hover:bg-ink transition-colors">×</button>
      {/if}
    </div>
    <p class="mt-1.5 font-dmmono text-[9.5px] uppercase tracking-[0.05em] text-ink-soft">{kicker}</p>

    <!-- Section chips: always all five (the promise is „alle Bereiche"); a zero count is dimmed, not hidden. -->
    {#if counts && counts.total > 0}
      <div class="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={$t['nav.search.aria']}>
        <button type="button" data-section-chip="all" aria-pressed={section === 'all'} onclick={() => (section = 'all')}
          class="font-dmmono text-[10px] uppercase tracking-[0.06em] rounded-full border-[1.5px] border-ink px-2.5 py-1 {section === 'all' ? 'bg-ink text-paper' : 'bg-paper text-ink'}">
          {$t['search.section.all']} · {counts.total}
        </button>
        {#each SECTIONS as s (s)}
          <button type="button" data-section-chip={s} aria-pressed={section === s} disabled={counts.bySection[s] === 0} onclick={() => (section = s)}
            class="font-dmmono text-[10px] uppercase tracking-[0.06em] rounded-full border-[1.5px] border-ink px-2.5 py-1 disabled:opacity-40 {section === s ? 'bg-ink text-paper' : 'bg-paper text-ink'}">
            {$t[SECTION_LABEL_KEY[s]]} · {counts.bySection[s]}
          </button>
        {/each}
      </div>
    {/if}
  </section>

  {#if !runner.normalized}
    <div class="px-[18px] py-10 text-center"><p class="font-bricolage text-ink-mute">{$t['search.idle']}</p></div>
  {:else if runner.failed}
    <div class="mx-[18px] my-6 px-6 py-10 bg-paper-warm border-[1.5px] border-dashed border-rule rounded-xl text-center">
      <p class="font-bricolage text-2xl text-ink mb-2">{$t['search.unavailable']}</p>
      <p class="font-bricolage text-ink-soft">{$t['search.retry']}</p>
    </div>
  {:else if runner.loading || runner.pending}
    <!-- Answer on its way: no list and no empty state until it is here. -->
    <div class="px-[18px] py-10" aria-hidden="true"></div>
  {:else if counts && (counts.total === 0 || shownTotal === 0)}
    <div class="mx-[18px] my-6 px-6 py-10 bg-paper-warm border-[1.5px] border-dashed border-rule rounded-xl text-center">
      <p class="font-bricolage text-2xl text-ink mb-2">{$t['search.none']}</p>
      <p class="font-bricolage text-ink-soft">{$t['search.none.hint']}</p>
    </div>
  {:else if runner.hits}
    <div class="px-[18px] py-2.5 flex flex-col gap-4">
      {#each shown as s (s)}
        <section data-search-group={s}>
          <h2 class="font-dmmono text-[10px] uppercase tracking-[0.12em] m-0 mb-2" style="color: {SECTION_ACCENT[s]}">
            {$t[SECTION_LABEL_KEY[s]]} · {counts?.bySection[s]}
          </h2>
          <div class="flex flex-col gap-2.5">
            {#each runner.hits.hits[s] as hit (hit.kind + hit.id)}
              <SearchHit {hit} q={runner.normalized ?? ''} />
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</div>
