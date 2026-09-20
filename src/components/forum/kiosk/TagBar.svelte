<script lang="ts">
  // Single-row filter bar — Editorial Kiosk canvas:
  //   Alle | Diskussion | Ankündigung | Empfehlung │ Gespeichert | Meine
  //                                               TAGS  #kita #verkehr …
  //   Phones (< md): [ Alle | Diskussion | … scrolls … ] [# Tags ▾]
  //                  tag row only after a tap on the chip
  //
  // Two color tones:
  //   - tone="paper" (default) — ink text on paper bg, ink fill when active
  //   - tone="ink"             — paper text on ink bg, paper fill when active
  //                              (used inside the pinned-block above the hero)
  //
  // Phase 4a: presentational + emits filter changes upward. The actual
  // filter logic (which items to show) lives in ForumIndexInner. Saved /
  // Mine + multi-collection feed land in Phase 4b.

  import { t } from '../../../lib/kiosk-i18n';
  import { scrollFade } from '../../../lib/scrollFade';
  import { tagsChipLabel } from '../../../lib/forum/mobileChrome';

  export type Filter =
    | 'all'
    | 'discussion'
    | 'announcement'
    | 'recommendation'
    | 'saved'
    | 'mine';

  let {
    activeFilter = 'all',
    activeTag = null,
    tags = [],
    tone = 'paper',
    onFilterChange,
    onTagChange
  } = $props<{
    activeFilter?: Filter;
    activeTag?: string | null;
    tags?: string[];
    tone?: 'paper' | 'ink';
    onFilterChange?: (f: Filter) => void;
    onTagChange?: (tag: string | null) => void;
  }>();

  // Phones (< md): the tag row is folded behind a "# Tags" chip at the end
  // of the filter row (2026-09-20 — brings the first post up by one row).
  // Per-visit view state only. From md up the row is always visible and
  // the chip is display:none, so this flag has no effect there.
  let tagsOpen = $state(false);

  // Pill chrome — outlined rounded-full, two color states per tone.
  function pillClass(active: boolean): string {
    if (tone === 'ink') {
      return active
        ? 'bg-paper text-ink border-2 border-paper'
        : 'bg-transparent text-paper border-2 border-paper/40 hover:border-paper hover:text-paper';
    }
    return active
      ? 'bg-ink text-paper border-2 border-ink'
      : 'bg-transparent text-ink border-2 border-ink/30 hover:border-ink hover:bg-paper-warm';
  }

  const tagsLabelClass = $derived(
    tone === 'ink'
      ? 'font-dmmono text-[10px] uppercase tracking-[0.18em] text-paper/60'
      : 'font-dmmono text-[10px] uppercase tracking-[0.18em] text-ink-mute'
  );

  const sepClass = $derived(
    tone === 'ink' ? 'h-5 w-px bg-paper/30' : 'h-5 w-px bg-ink/20'
  );

  function setFilter(f: Filter) {
    onFilterChange?.(f);
  }
  function toggleTag(tag: string) {
    onTagChange?.(activeTag === tag ? null : tag);
  }

  const filters: { key: Filter; labelKey: string }[] = [
    { key: 'all',            labelKey: 'filter.all' },
    { key: 'discussion',     labelKey: 'filter.discussion' },
    { key: 'announcement',   labelKey: 'filter.announcement' },
    { key: 'recommendation', labelKey: 'filter.recommendation' }
  ];
  const personalFilters: { key: Filter; labelKey: string }[] = [
    { key: 'saved', labelKey: 'filter.saved' },
    { key: 'mine',  labelKey: 'filter.mine' }
  ];
</script>

<!--
  Mobile (< lg): two horizontally-scrollable rows — filters on top,
  tags below. `lg:contents` dissolves each row wrapper on desktop so
  the children re-flow into the original single `flex flex-wrap`
  parent (preserves the design's inline TAGS-after-filters look).
  Below md the tag row is folded behind the "# Tags" chip (tagsOpen).
-->
<div class="lg:flex lg:flex-wrap lg:items-center lg:gap-2">
  <!-- Row 1: filters (type + personal) in a scroller; on phones the
       "# Tags" chip sits OUTSIDE the scroller so it is always in view
       (the pills alone are wider than a 390px screen). Both wrappers
       dissolve at lg. -->
  <div class="flex items-center gap-2 lg:contents">
  <div
    use:scrollFade
    class="kiosk-scroll-fade flex-1 min-w-0 flex items-center gap-2 overflow-x-auto no-scrollbar lg:contents"
  >
    {#each filters as f (f.key)}
      <button
        type="button"
        data-tour={`forum-filter-${f.key}`}
        onclick={() => setFilter(f.key)}
        class={`shrink-0 px-4 py-1 rounded-full font-bricolage font-medium text-sm transition-colors duration-150 ${pillClass(activeFilter === f.key)}`}
        aria-pressed={activeFilter === f.key}
      >{$t[f.labelKey]}</button>
    {/each}

    <span class={`shrink-0 ${sepClass}`} aria-hidden="true"></span>

    {#each personalFilters as f (f.key)}
      <button
        type="button"
        data-tour={`forum-filter-${f.key}`}
        onclick={() => setFilter(f.key)}
        class={`shrink-0 px-4 py-1 rounded-full font-bricolage font-medium text-sm transition-colors duration-150 ${pillClass(activeFilter === f.key)}`}
        aria-pressed={activeFilter === f.key}
      >{$t[f.labelKey]}</button>
    {/each}
  </div>
    {#if tags.length}
      <!-- data-tour: on phones the tour's "Tags" stop lands here (first
           visible match); from md up this button is display:none and the
           stop lands on the first tag, as before. -->
      <button
        type="button"
        data-tags-chip
        data-tour="forum-tag"
        aria-expanded={tagsOpen}
        aria-controls="forum-tag-row"
        onclick={() => (tagsOpen = !tagsOpen)}
        class={`md:hidden shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full font-bricolage font-medium text-sm transition-colors duration-150 ${pillClass(!!activeTag)}`}
      >
        <span class="truncate max-w-[7rem]">{tagsChipLabel(activeTag, $t['filter.tagsChip'])}</span>
        <span aria-hidden="true" class="text-[10px]">{tagsOpen ? '▴' : '▾'}</span>
      </button>
    {/if}
  </div>

  <!-- Row 2: tags. -->
  {#if tags.length}
    <!-- 'hidden md:flex' must stay a literal string — Tailwind only
         generates classes it can read in the source. -->
    <div
      id="forum-tag-row"
      use:scrollFade
      class={`kiosk-scroll-fade items-center gap-2 overflow-x-auto no-scrollbar mt-2 lg:mt-0 lg:contents ${tagsOpen ? 'flex' : 'hidden md:flex'}`}
    >
      <span class={`shrink-0 lg:ml-2 ${tagsLabelClass}`}>{$t['filter.tagsLabel']}</span>
      {#each tags as tag, i (tag)}
        <button
          type="button"
          data-tour={i === 0 ? 'forum-tag' : undefined}
          onclick={() => toggleTag(tag)}
          class={`shrink-0 px-3 py-1 rounded-full font-bricolage font-medium text-sm transition-colors duration-150 ${pillClass(activeTag === tag)}`}
          aria-pressed={activeTag === tag}
        >#{tag}</button>
      {/each}
    </div>
  {/if}
</div>
