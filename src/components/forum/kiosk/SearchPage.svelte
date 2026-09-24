<script lang="ts">
  // Search results — port of `ForumSearchMobile` (design handoff
  // kiosk-forum-extras.jsx L195–268), slim result cards with an ochre
  // <mark> on the first match. Since 2026-09-24 the results come from
  // GET /api/search (server query over all three post kinds + comments);
  // the page SSRs the first `?q=` so a shared link renders its hits at once.
  //
  // Comment-match card is a documented extension — design's kicker
  // promises comment search but the JSX only shows post results.
  // Comment cards re-use the same outer frame, swap PostTypeChip for a
  // `↪ KOMMENTAR` mono kicker, and prepend the parent post title on a
  // small line above the body excerpt.
  import { onMount } from 'svelte';
  import PostTypeChip from './PostTypeChip.svelte';
  import { locale } from '../../../lib/kiosk-i18n';
  import { relTime } from '../../../lib/relTime';
  import { normalizeQuery, SEARCH_MAX_LEN, type SearchResult } from '../../../lib/forum/searchQuery'; // pure module — never import searchStore (driver) into an island

  let { initialQuery = '', initialResults = null } = $props<{
    initialQuery?: string;
    initialResults?: SearchResult | null;
  }>();

  let query = $state(initialQuery);
  let results = $state<SearchResult | null>(initialResults);
  let loading = $state(false);
  let failed = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);

  const normalized = $derived(normalizeQuery(query));
  const posts = $derived(results && results.q === normalized ? results.posts : []);
  const comments = $derived(results && results.q === normalized ? results.comments : []);
  const total = $derived(posts.length + comments.length);

  // ─── Fetch (debounced, last request wins) ─────────────────────────
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  async function run(q: string) {
    const my = ++seq;
    loading = true;
    failed = false;
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (my !== seq) return;
      if (!r.ok) {
        failed = true;
        return;
      }
      results = await r.json();
    } catch {
      if (my === seq) failed = true;
    } finally {
      if (my === seq) loading = false;
    }
  }
  $effect(() => {
    const q = normalized;
    clearTimeout(timer);
    if (!q) {
      results = null;
      loading = false;
      failed = false;
      return;
    }
    if (results && results.q === q) return; // SSR answer or same query again
    timer = setTimeout(() => run(q), 250);
    return () => clearTimeout(timer);
  });

  // ─── URL sync (?q=) — keeps Astro's ClientRouter state (root CLAUDE.md) ─
  onMount(() => {
    if (!query) inputEl?.focus();
  });
  $effect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (normalized) url.searchParams.set('q', normalized);
    else url.searchParams.delete('q');
    window.history.replaceState(window.history.state, '', url.toString());
  });

  // ─── Highlight (XSS-safe) ────────────────────────────────────────
  // No `{@html}` — split into prefix / match / suffix segments and let
  // Svelte auto-escape each piece individually.
  function splitOnFirstMatch(
    text: string | undefined | null,
    q: string
  ): { prefix: string; match: string; suffix: string } | null {
    if (!text || !q) return null;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return null;
    return {
      prefix: text.slice(0, idx),
      match: text.slice(idx, idx + q.length),
      suffix: text.slice(idx + q.length)
    };
  }

  const placeholder = $derived(
    $locale === 'de'
      ? 'Worüber suchst du? (Titel, Text, Tag)'
      : 'What are you looking for? (title, text, tag)'
  );

  const kickerCopy = $derived.by(() => {
    const de = $locale === 'de';
    if (!normalized) return de ? 'FORUM · BEITRÄGE + KOMMENTARE' : 'FORUM · POSTS + COMMENTS';
    if (loading) return de ? 'SUCHE …' : 'SEARCHING …';
    if (failed) return de ? 'SUCHE NICHT ERREICHBAR' : 'SEARCH UNAVAILABLE';
    return de
      ? `${total} TREFFER · BEITRÄGE + KOMMENTARE`
      : `${total} RESULTS · POSTS + COMMENTS`;
  });
</script>

<!-- A <div>, not <main>: KioskLayout already provides the page's main landmark. -->
<div class="max-w-3xl mx-auto pb-10" data-search-page>
  <!-- ── Search bar block (matches ForumSearchMobile L198–223) ──── -->
  <section class="px-[18px] py-2.5 bg-paper-warm border-b border-dashed border-rule">
    <div
      class="flex items-center gap-2 bg-paper border-[1.5px] border-ink rounded-full px-3.5 py-2"
    >
      <span
        class="font-dmmono text-[14px] text-ink-mute pointer-events-none shrink-0"
        aria-hidden="true">⌕</span>
      <!-- type="text", not "search": Chrome draws its own clear button on a
           search input, doubling ours (seen on prod 2026-09-24). -->
      <input
        bind:this={inputEl}
        type="text"
        inputmode="search"
        enterkeyhint="search"
        maxlength={SEARCH_MAX_LEN}
        bind:value={query}
        placeholder={placeholder}
        autocomplete="off"
        class="flex-1 min-w-0 bg-transparent border-none outline-none font-bricolage text-[14px] font-semibold text-ink placeholder:text-ink-mute placeholder:font-normal"
      />
      {#if query}
        <button
          type="button"
          onclick={() => (query = '')}
          aria-label={$locale === 'de' ? 'Suche leeren' : 'Clear search'}
          class="shrink-0 w-4 h-4 rounded-full bg-ink-mute text-paper text-[9px] font-bold flex items-center justify-center hover:bg-ink transition-colors"
        >×</button>
      {/if}
    </div>
    <p class="mt-1.5 font-dmmono text-[9.5px] uppercase tracking-[0.05em] text-wine">
      {kickerCopy}
    </p>
  </section>

  <!-- ── Results ─────────────────────────────────────────────────── -->
  {#if !normalized}
    <!-- Idle state — show no result list, just the kicker above. -->
    <div class="px-[18px] py-10 text-center">
      <p class="font-bricolage text-ink-mute">
        {$locale === 'de'
          ? 'Tippe einen Suchbegriff oben ein.'
          : 'Type a search term above.'}
      </p>
    </div>
  {:else if failed}
    <div
      class="mx-[18px] my-6 px-6 py-10 bg-paper-warm border-[1.5px] border-dashed border-rule rounded-xl text-center"
    >
      <p class="font-bricolage text-2xl text-ink mb-2">
        {$locale === 'de' ? 'Die Suche ist gerade nicht erreichbar.' : 'Search is unavailable right now.'}
      </p>
      <p class="font-bricolage text-ink-soft">
        {$locale === 'de' ? 'Versuch es gleich noch einmal.' : 'Try again in a moment.'}
      </p>
    </div>
  {:else if !loading && total === 0}
    <div
      class="mx-[18px] my-6 px-6 py-10 bg-paper-warm border-[1.5px] border-dashed border-rule rounded-xl text-center"
    >
      <p class="font-bricolage text-2xl text-ink mb-2">
        {$locale === 'de' ? 'Nichts gefunden.' : 'Nothing found.'}
      </p>
      <p class="font-bricolage text-ink-soft">
        {$locale === 'de'
          ? 'Probier andere Wörter oder einen Tag (z. B. spielplatz).'
          : 'Try other words or a tag (e.g. spielplatz).'}
      </p>
    </div>
  {:else}
    <div class="px-[18px] py-2.5 flex flex-col gap-2.5">
      <!-- Post matches (all three kinds) -->
      {#each posts as post (post._id)}
        {@const titleSplit = splitOnFirstMatch(post.title, normalized)}
        {@const bodySplit = splitOnFirstMatch(post.excerpt, normalized)}
        <a
          href={post.href}
          class="block focus:outline-none focus:ring-2 focus:ring-ink rounded-xl"
        >
          <article
            class="bg-paper border-[1.5px] border-ink rounded-xl px-3.5 py-3"
          >
            <div class="flex items-center gap-1.5 mb-1.5">
              <PostTypeChip kind={post.kind} size="sm" />
              <span class="font-dmmono text-[9.5px] text-ink-mute">
                · {relTime(post.date, $locale)}
              </span>
            </div>
            <h3
              class="font-bricolage font-extrabold text-[15px] tracking-[-0.015em] leading-[1.2] mb-1 m-0 text-ink"
            >
              {#if titleSplit}{titleSplit.prefix}<mark
                  class="bg-ochre text-ink px-0.5"
                  >{titleSplit.match}</mark>{titleSplit.suffix}{:else}{post.title}{/if}
            </h3>
            {#if post.excerpt}
              <p
                class="font-bricolage text-[12.5px] leading-[1.45] text-ink-soft m-0"
              >
                {#if bodySplit}{bodySplit.prefix}<mark
                    class="bg-ochre text-ink px-0.5"
                    >{bodySplit.match}</mark>{bodySplit.suffix}{:else}{post.excerpt}{/if}
              </p>
            {/if}
          </article>
        </a>
      {/each}

      <!-- Comment matches (extends design — ↪ KOMMENTAR kicker variant) -->
      {#each comments as comment (comment._id)}
        {@const bodySplit = splitOnFirstMatch(comment.excerpt, normalized)}
        <a
          href={comment.href}
          class="block focus:outline-none focus:ring-2 focus:ring-ink rounded-xl"
        >
          <article
            class="bg-paper border-[1.5px] border-ink rounded-xl px-3.5 py-3"
          >
            <div class="flex items-center gap-2 mb-0.5">
              <span
                class="font-dmmono text-[9.5px] uppercase tracking-[0.12em] text-wine"
              >
                ↪ {$locale === 'de' ? 'KOMMENTAR' : 'COMMENT'}
              </span>
              <span class="font-dmmono text-[9.5px] text-ink-mute">
                · {relTime(comment.date, $locale)}
              </span>
            </div>
            <p
              class="font-dmmono text-[9.5px] text-ink-mute tracking-[0.05em] truncate mb-1.5"
            >
              ↪ {comment.parentTitle}
            </p>
            <p
              class="font-bricolage text-[12.5px] leading-[1.45] text-ink-soft m-0"
            >
              {#if bodySplit}{bodySplit.prefix}<mark
                  class="bg-ochre text-ink px-0.5"
                  >{bodySplit.match}</mark>{bodySplit.suffix}{:else}{comment.excerpt}{/if}
            </p>
          </article>
        </a>
      {/each}
    </div>
  {/if}
</div>
