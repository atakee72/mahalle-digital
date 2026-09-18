<script lang="ts">
  /**
   * „Die Beilage" index — orchestrator island. Masthead → rubric row
   * (tag filter + live search) → main grid (lead card + newspaper columns
   * + pagination, sidebar modules) → states 01 (no posts at all) / 02
   * (filters yield zero results). Transcribed from
   * design/handoffs/design_handoff_blog/jsx/kiosk-blog.jsx `BlogIndexDesktop`
   * + kiosk-blog-mobile.jsx `BlogMobileIndex` + kiosk-blog-states.jsx.
   *
   * Zero backend: all filtering/sorting/pagination is client-side over the
   * `posts` prop (SSR-fetched by the page from the `blog` content
   * collection). Filters compose as AND (tag ∧ month ∧ search).
   */
  import { locale, t, tStr } from '../../../lib/kiosk-i18n';
  import {
    type BeilagePost,
    fmtDateKicker,
    fmtMonthLabel,
    monthKey,
    monthGroups,
    tagCounts, isSimultaneous } from '../../../lib/blog/beilage';
  import { scrollFade } from '../../../lib/scrollFade';
  import BlMasthead from './BlMasthead.svelte';
  import BlRubrikChip from './BlRubrikChip.svelte';
  import BlPostMeta from './BlPostMeta.svelte';
  import BlLayoutBadge from './BlLayoutBadge.svelte';
  import { initialsOf } from '../../../lib/initials';

  let { posts }: { posts: BeilagePost[] } = $props();

  // ── State ────────────────────────────────────────────────────────
  let query = $state('');
  let activeTag = $state<string | null>(null);
  let activeMonth = $state<string | null>(null);
  let page = $state(0);
  let pageSize = $state(12);
  let showAllTags = $state(false);

  // ── Derived ──────────────────────────────────────────────────────
  const filtered = $derived(posts.filter((p) => {
    if (activeTag && !p.tags.includes(activeTag)) return false;
    if (activeMonth && monthKey(p.pubDateISO) !== activeMonth) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      return p.title.toLowerCase().includes(q)
        || p.description.toLowerCase().includes(q)
        || p.tags.some((tag) => tag.toLowerCase().includes(q));
    }
    return true;
  }));
  const isFiltered = $derived(!!query.trim() || !!activeTag || !!activeMonth);
  const totalPages = $derived(Math.max(1, Math.ceil(filtered.length / pageSize)));
  const pageItems = $derived(filtered.slice(page * pageSize, (page + 1) * pageSize));
  // No lead card for a post that was published together with others (see isSimultaneous).
  const showLead = $derived(
    !isFiltered && page === 0 && pageItems.length > 0 && !isSimultaneous(pageItems[0].id, posts)
  );
  const lead = $derived(showLead ? pageItems[0] : null);
  const columnItems = $derived(showLead ? pageItems.slice(1) : pageItems);
  const counts = $derived(tagCounts(posts));
  const months = $derived(monthGroups(posts));

  const visibleTags = $derived(showAllTags ? counts : counts.slice(0, 6));
  const col1 = $derived(columnItems.filter((_, i) => i % 2 === 0));
  const col2 = $derived(columnItems.filter((_, i) => i % 2 === 1));
  const oldestISO = $derived(posts[posts.length - 1]?.pubDateISO ?? null);
  // „zuletzt" is the newest TRUE publication date — not posts[0], which a post with an order-only sort date can precede.
  const latestISO = $derived(posts.reduce<string | null>((m, p) => (m === null || p.pubDateISO > m ? p.pubDateISO : m), null));
  const callHref = $derived(
    `/topics/create?prefill_title=${encodeURIComponent($t['blog.call.prefillTitle'])}&prefill_tags=blogidee`
  );

  // State-02 headline subject: whatever filters produced the empty result.
  // A tag/month filter can zero out without any search query — quoting just
  // `query` would render empty curly quotes „“ in that case.
  const activeMonthLabel = $derived.by(() => {
    if (!activeMonth) return null;
    const g = months.find((m) => m.key === activeMonth);
    return g ? fmtMonthLabel(g.iso, $locale) : null;
  });
  const emptySubject = $derived(
    [query.trim() || null, activeTag ? `#${activeTag}` : null, activeMonthLabel]
      .filter(Boolean)
      .join(' · ')
  );

  // ── Handlers (page resets live here — rune-safe, no effect loop) ──
  function toggleTag(tag: string) {
    activeTag = activeTag === tag ? null : tag;
    page = 0;
  }
  function clearTag() {
    activeTag = null;
    page = 0;
  }
  function toggleMonth(key: string) {
    activeMonth = activeMonth === key ? null : key;
    page = 0;
  }
  function setPageSize(n: number) {
    pageSize = n;
    page = 0;
  }
  function clearQuery() {
    query = '';
    page = 0;
  }
  function onSearchInput() {
    page = 0;
  }
  function goToPage(p: number) {
    page = Math.max(0, Math.min(totalPages - 1, p));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

{#snippet searchBox()}
  <div>
    <!-- <label>, not <div>: a tap anywhere on the bar (the 9px padding band
         included) focuses the input. min-h 44px below lg keeps the whole bar
         a legal touch target; desktop keeps its compact 41px look. -->
    <label
      class="flex items-center min-h-[44px] lg:min-h-0 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink"
      style="gap: 8px; background: var(--k-paper-soft); border: {query ? '1.5px solid var(--k-ink)' : '1px solid var(--k-rule)'}; border-radius: var(--k-radius-md); padding: 9px 14px;"
    >
      <span style="font-size: 14px; opacity: 0.5;">⌕</span>
      <input
        type="text"
        bind:value={query}
        oninput={onSearchInput}
        placeholder={$t['blog.search.placeholder']}
        class="font-bricolage flex-1 bg-transparent"
        style="font-size: 13px; color: var(--k-ink); border: none; outline: none; min-width: 0;"
      />
      {#if query}
        <button
          type="button"
          onclick={clearQuery}
          class="font-dmmono"
          style="font-size: 10px; color: var(--k-ink-mute); background: none; border: none; cursor: pointer; padding: 4px;"
          aria-label={$locale === 'de' ? 'Suche leeren' : 'Clear search'}
        >✕</button>
      {/if}
    </label>
    {#if query}
      <div class="font-dmmono" style="font-size: 10px; color: var(--k-rust); margin-top: 5px;">
        {tStr($t['blog.search.hits'], { n: filtered.length })}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet navBtn(disabled: boolean, ch: string, onclick: () => void)}
  <!-- kiosk-tap-box (not kiosk-tap): the arrows sit 10px apart, so an
       invisible extender would overlap its neighbour. The button grows to
       44px below lg, the painted 30px pill lives in the inner span. -->
  <button
    type="button"
    {disabled}
    {onclick}
    class="font-dmmono kiosk-tap-box flex items-center justify-center"
    style="background: none; border: none; padding: 0; cursor: {disabled ? 'default' : 'pointer'};"
  >
    <span
      class="flex items-center justify-center"
      style="
        width: 30px; height: 30px;
        border: 1.5px solid {disabled ? 'var(--k-rule)' : 'var(--k-ink)'};
        border-radius: var(--k-radius-sm);
        color: {disabled ? 'var(--k-rule)' : 'var(--k-ink)'};
        font-size: 12px;
      "
    >{ch}</span>
  </button>
{/snippet}

{#snippet colCard(post: BeilagePost, thumb: boolean)}
  <a
    href={`/blog/${post.id}`}
    class="block bl-card-in"
    style="text-decoration: none; color: inherit; border-bottom: 1px dashed var(--k-rule); padding-bottom: 16px;"
  >
    <!-- Photo strip: normally only the first card of a column. Posts published
         in the same second ALL get one, same height, and an initials plate when
         there is no cover — equal treatment, and nobody is singled out by a
         missing photo. Taller (150) than the ordinary strip (110): at 110 a
         portrait is cut at the nose. -->
    {#if isSimultaneous(post.id, posts)}
      <div style="border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-md); overflow: hidden; margin-bottom: 10px;">
        {#if post.cover}
          <img src={post.cover} alt={post.coverAlt ?? ''} class="w-full object-cover" style="height: 150px; object-position: {post.coverPosition ?? 'center'};" loading="lazy" />
        {:else}
          <div
            class="w-full flex items-center justify-center font-bricolage"
            style="height: 150px; background: var(--k-paper-soft); font-size: 44px; font-weight: 800; letter-spacing: -0.03em; color: var(--k-ink-mute);"
            aria-hidden="true"
          >{initialsOf(post.author && post.author !== 'Mahalle Team' ? post.author : 'Mahalle')}</div>
        {/if}
      </div>
    {:else if thumb && post.cover}
      <div style="border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-md); overflow: hidden; margin-bottom: 10px;">
        <img src={post.cover} alt={post.coverAlt ?? ''} class="w-full object-cover" style="height: 110px; object-position: {post.coverPosition ?? 'center'};" loading="lazy" />
      </div>
    {/if}
    <div class="flex items-center" style="gap: 8px;">
      <span class="font-dmmono" style="font-size: 9.5px; letter-spacing: 0.12em; color: var(--k-rust);">{fmtDateKicker(post.pubDateISO, $locale)}</span>
      <BlLayoutBadge layout={post.layout} />
    </div>
    <h3 class="font-bricolage" style="font-size: 18px; font-weight: 700; letter-spacing: -0.015em; line-height: 1.15; margin: 5px 0 6px;">{post.title}</h3>
    <div style="font-size: 12.5px; line-height: 1.45; color: var(--k-ink-soft); margin-bottom: 8px;">{post.description}</div>
    <BlPostMeta post={post} />
  </a>
{/snippet}

{#snippet cloudModule()}
  <div data-tour="blog-rubriken" style="border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-lg); background: var(--k-paper-warm); box-shadow: 2px 2px 0 var(--k-ink); padding: 16px 18px;">
    <div class="font-dmmono" style="font-size: 10px; letter-spacing: 0.16em; color: var(--k-rust); border-bottom: 1px solid var(--k-ink); padding-bottom: 7px; margin-bottom: 12px;">
      {$t['blog.rubrics']} · {counts.length}
    </div>
    <div class="flex flex-wrap" style="gap: 6px;">
      {#each counts as [tag, n] (tag)}
        <BlRubrikChip {tag} {n} small active={activeTag === tag} onclick={() => toggleTag(tag)} />
      {/each}
    </div>
  </div>
{/snippet}

{#snippet archivModule()}
  <div style="border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-lg); background: var(--k-paper-warm); box-shadow: 2px 2px 0 var(--k-ink); padding: 16px 18px;">
    <div class="flex justify-between items-baseline" style="border-bottom: 1px solid var(--k-ink); padding-bottom: 7px; margin-bottom: 6px;">
      <span class="font-dmmono" style="font-size: 10px; letter-spacing: 0.16em; color: var(--k-rust);">{$t['blog.archive.title']}</span>
      <span class="font-dmmono" style="font-size: 8.5px; color: var(--k-ink-mute);">{$t['blog.archive.note']}</span>
    </div>
    {#each months as g (g.key)}
      <button
        type="button"
        onclick={() => toggleMonth(g.key)}
        class="w-full text-left flex items-center min-h-[44px] lg:min-h-0"
        style="gap: 10px; padding: 7px 0; border-bottom: 1px dashed var(--k-rule); background: {activeMonth === g.key ? 'var(--k-rust-tint)' : 'transparent'}; border-left: none; border-right: none; border-top: none; cursor: pointer;"
      >
        <span class="font-dmmono" style="font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: {activeMonth === g.key ? 'var(--k-rust-deep)' : 'var(--k-ink)'};">
          {fmtMonthLabel(g.iso, $locale)}
        </span>
        <div class="flex-1 flex" style="gap: 3px;">
          {#each Array(g.count) as _, i (i)}
            <span style="width: 14px; height: 7px; background: var(--k-rust); opacity: 0.75; border-radius: 2px;"></span>
          {/each}
        </div>
        <span class="font-dmmono" style="font-size: 10px; color: var(--k-ink-mute);">
          {g.count} {g.count === 1 ? $t['blog.archive.entry'] : $t['blog.archive.entries']}
        </span>
      </button>
    {/each}
  </div>
{/snippet}

{#snippet aboutCard()}
  <div style="border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-lg); background: var(--k-paper); box-shadow: 2px 2px 0 var(--k-ink); padding: 16px 18px;">
    <div class="font-dmmono" style="font-size: 10px; letter-spacing: 0.16em; color: var(--k-rust); border-bottom: 1px solid var(--k-ink); padding-bottom: 7px; margin-bottom: 10px;">
      {$t['blog.about.title']}
    </div>
    <div style="font-size: 12.5px; line-height: 1.55; color: var(--k-ink-soft);">
      {$t['blog.about.pre']}<b>{$t['blog.about.bold']}</b>{$t['blog.about.post']}
    </div>
    {#if oldestISO}
      <div class="font-dmmono" style="font-size: 9.5px; letter-spacing: 0.1em; color: var(--k-ink-mute); margin-top: 10px;">
        {tStr($t['blog.about.since'], { month: fmtMonthLabel(oldestISO, $locale), n: posts.length })}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet aufrufCard()}
  <div style="border: 2px solid var(--k-ink); border-radius: var(--k-radius-lg); background: var(--k-rust-tint); box-shadow: 3px 3px 0 var(--k-rust-deep); padding: 18px 18px 16px; position: relative;">
    <div class="font-dmmono" style="font-size: 9.5px; letter-spacing: 0.18em; color: var(--k-rust-deep);">{$t['blog.call.kicker']}</div>
    <div class="font-bricolage" style="font-size: 21px; font-weight: 800; letter-spacing: -0.02em; margin: 6px 0 6px;">
      {$t['blog.call.title']}<span style="color: var(--k-rust);">.</span>
    </div>
    <div style="font-size: 12.5px; line-height: 1.5; color: var(--k-ink-soft);">{$t['blog.call.body']}</div>
    <a
      href={callHref}
      class="font-bricolage inline-flex items-center"
      style="margin-top: 12px; min-height: 44px; padding: 8px 16px; background: var(--k-ink); color: var(--k-paper); border-radius: var(--k-radius-pill); font-size: 13px; font-weight: 700; box-shadow: 2px 2px 0 var(--k-rust); text-decoration: none;"
    >{$t['blog.call.cta']} →</a>
    <div class="font-dmmono" style="font-size: 9px; line-height: 1.5; color: var(--k-ink-mute); margin-top: 8px;">{$t['blog.call.note']}</div>
  </div>
{/snippet}

{#if posts.length === 0}
  <BlMasthead count={0} latestISO={null} />
  <div class="flex justify-center px-6" style="padding: 40px 24px 60px;">
    <div class="text-center bl-card-in" style="border: 1.5px dashed var(--k-rule); border-radius: var(--k-radius-md); padding: 26px 20px; max-width: 420px;">
      <div style="font-size: 30px;">⏳</div>
      <div class="font-bricolage" style="font-size: 17px; font-weight: 800; margin: 6px 0 4px;">{$t['blog.empty.title']}</div>
      <div style="font-size: 12.5px; color: var(--k-ink-soft);">{$t['blog.empty.body']}</div>
    </div>
  </div>
{:else}
  <BlMasthead count={posts.length} latestISO={latestISO} />

  <div class="px-6 lg:px-12 py-3 border-b border-dashed" style="border-color: var(--k-rule);">
    <!-- Desktop rubric row -->
    <div class="hidden lg:flex items-center flex-wrap" style="gap: 8px;">
      <span class="font-dmmono shrink-0" style="font-size: 10px; letter-spacing: 0.14em; color: var(--k-ink-mute);">{$t['blog.rubrics']}</span>
      <BlRubrikChip tag={$t['blog.rubric.all']} active={!activeTag} onclick={clearTag} />
      {#each visibleTags as [tag, n] (tag)}
        <BlRubrikChip {tag} {n} active={activeTag === tag} onclick={() => toggleTag(tag)} />
      {/each}
      {#if !showAllTags && counts.length > 6}
        <button
          type="button"
          onclick={() => (showAllTags = true)}
          class="font-dmmono"
          style="font-size: 10px; color: var(--k-rust); background: none; border: none; cursor: pointer;"
        >+{counts.length - 6}</button>
      {/if}
      <div class="ml-auto" style="width: 300px;">
        {@render searchBox()}
      </div>
    </div>

    <!-- Mobile rubric row: horizontal-scroll chips + full-width search -->
    <div class="lg:hidden">
      <div data-tour="blog-rubriken" use:scrollFade class="kiosk-scroll-fade no-scrollbar flex overflow-x-auto" style="gap: 8px; padding-bottom: 2px;">
        <div class="shrink-0"><BlRubrikChip tag={$t['blog.rubric.all']} active={!activeTag} onclick={clearTag} /></div>
        {#each counts as [tag, n] (tag)}
          <div class="shrink-0"><BlRubrikChip {tag} {n} active={activeTag === tag} onclick={() => toggleTag(tag)} /></div>
        {/each}
      </div>
      <div style="margin-top: 8px;">
        {@render searchBox()}
      </div>
    </div>
  </div>

  <div class="lg:grid gap-8 px-6 lg:px-12 py-6" style="grid-template-columns: 1fr 300px;">
    <div>
      {#if filtered.length === 0}
        <div class="text-center" style="padding: 40px 20px;">
          <div class="font-bricolage" style="font-size: 22px; font-weight: 800;">
            {$t['blog.search.none.pre']}<span class="font-instrument italic" style="color: var(--k-rust);">{emptySubject}</span>{$t['blog.search.none.post']}
          </div>
          <div style="font-size: 13px; color: var(--k-ink-soft); margin: 6px 0 14px;">{tStr($t['blog.search.none.body'], { n: posts.length })}</div>
          <div class="flex justify-center flex-wrap" style="gap: 6px;">
            {#each counts.slice(0, 4) as [tag, n] (tag)}
              <BlRubrikChip {tag} {n} small onclick={() => toggleTag(tag)} />
            {/each}
          </div>
        </div>
      {:else}
        {#if lead}
          <!-- Stretched-link card: the <a> covers the whole card (z-1) so
               body clicks navigate; only the interactive tag-chip row is
               raised above it (z-2) so chips filter instead of navigating. -->
          <div class="relative bl-card-in">
            <a href={`/blog/${lead.id}`} class="absolute inset-0" style="z-index: 1;" aria-label={lead.title}></a>
            <div class="grid grid-cols-1 md:grid-cols-[1.05fr_1fr]" style="gap: 24px;">
              <div>
                <span
                  class="font-dmmono inline-block"
                  style="font-size: 10px; letter-spacing: 0.14em; background: var(--k-rust); color: var(--k-paper); padding: 3px 10px; border-radius: 4px; border: 1px solid var(--k-ink);"
                >{$t['blog.lead.strap']}</span>
                <h2 class="font-bricolage text-[21px] md:text-[33px]" style="font-weight: 800; letter-spacing: -0.025em; line-height: 1.04; margin: 12px 0 8px;">{lead.title}</h2>
                <div class="font-instrument italic" style="font-size: 16.5px; line-height: 1.45; color: var(--k-ink-soft); margin-bottom: 10px;">{lead.description}</div>
                <BlPostMeta post={lead} />
                <div class="relative flex flex-wrap" style="z-index: 2; gap: 5px; margin-top: 10px;">
                  {#each lead.tags as tag (tag)}
                    <BlRubrikChip {tag} small active={activeTag === tag} onclick={() => toggleTag(tag)} />
                  {/each}
                </div>
              </div>
              <div style="border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-lg); overflow: hidden; box-shadow: 2px 2px 0 var(--k-ink); align-self: start;">
                {#if lead.cover}
                  <img src={lead.cover} alt={lead.coverAlt ?? ''} class="w-full object-cover" style="height: 220px; object-position: {lead.coverPosition ?? 'center'};" />
                {:else}
                  <div class="w-full" style="height: 220px; background: var(--k-paper-warm);"></div>
                {/if}
              </div>
            </div>
          </div>
        {/if}

        <div style="border-bottom: 2px solid var(--k-ink); margin: 22px 0 0;"></div>
        <div style="border-bottom: 1px solid var(--k-ink); margin: 2px 0 20px;"></div>

        <!-- Phones: ONE list in the true order. The two newspaper columns are
             filled alternately (col1 = items 0,2,4 · col2 = 1,3,5), which reads
             correctly side by side but, stacked, showed 0,2,4,1,3,5 — found
             2026-09-18 when four guest posts had to appear alphabetically. -->
        <div class="flex flex-col md:hidden" style="gap: 18px;">
          {#each columnItems as p, i (p.id)}
            {@render colCard(p, i === 0)}
          {/each}
        </div>
        <div class="hidden md:grid md:grid-cols-[1fr_1px_1fr]" style="gap: 22px;">
          <div class="flex flex-col" style="gap: 18px;">
            {#each col1 as p, i (p.id)}
              {@render colCard(p, i === 0)}
            {/each}
          </div>
          <div style="background: var(--k-rule);"></div>
          <div class="flex flex-col" style="gap: 18px;">
            {#each col2 as p, i (p.id)}
              {@render colCard(p, i === 0)}
            {/each}
          </div>
        </div>

        <!-- Two groups, not one flat row: at 44px tap targets the controls no
             longer fit one line on a phone, and a flat row wrapped mid-arrow
             („«" alone at the right edge). Grouped, they wrap as units. -->
        <div class="flex items-center flex-wrap" style="gap: 10px; padding-top: 16px;">
          <div class="flex items-center flex-wrap" style="gap: 10px;">
          <span class="font-dmmono" style="font-size: 10px; letter-spacing: 0.12em; color: var(--k-ink-mute);">{$t['blog.pag.perPage']}</span>
          {#each [12, 24, 48] as n}
            <button
              type="button"
              onclick={() => setPageSize(n)}
              class="font-dmmono kiosk-tap-box flex items-center justify-center"
              style="background: none; border: none; padding: 0; cursor: pointer;"
            ><span
                class="rounded-full"
                style="font-size: 11px; padding: 3px 9px; border: 1.5px solid {pageSize === n ? 'var(--k-rust)' : 'var(--k-rule)'}; background: {pageSize === n ? 'var(--k-rust)' : 'transparent'}; color: {pageSize === n ? 'var(--k-paper)' : 'var(--k-ink-mute)'};"
              >{n}</span></button>
          {/each}
          </div>
          <div class="flex-1"></div>
          <div class="flex items-center" style="gap: 10px;">
            {@render navBtn(page === 0, '«', () => goToPage(0))}
            {@render navBtn(page === 0, '‹', () => goToPage(page - 1))}
            <span class="font-dmmono" style="font-size: 11px; color: var(--k-ink);">{$t['blog.pag.page']} <b>{page + 1}</b> / {totalPages}</span>
            {@render navBtn(page >= totalPages - 1, '›', () => goToPage(page + 1))}
            {@render navBtn(page >= totalPages - 1, '»', () => goToPage(totalPages - 1))}
          </div>
        </div>
      {/if}
    </div>

    <div class="hidden lg:flex flex-col" style="gap: 18px;">
      {@render cloudModule()}
      <div data-tour="blog-archiv">{@render archivModule()}</div>
      {@render aboutCard()}
      <div data-tour="blog-aufruf">{@render aufrufCard()}</div>
    </div>
  </div>

  <div class="lg:hidden flex flex-col px-6" style="gap: 18px; padding-bottom: 32px;">
    <div data-tour="blog-archiv">{@render archivModule()}</div>
    {@render aboutCard()}
    <div data-tour="blog-aufruf">{@render aufrufCard()}</div>
  </div>
{/if}
