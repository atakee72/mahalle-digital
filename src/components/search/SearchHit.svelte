<!-- src/components/search/SearchHit.svelte -->
<script lang="ts">
  // One search hit — the same paper card on the results page and, compact,
  // in the masthead modal. Kicker per section in the section's accent;
  // forum posts keep the PostTypeChip, comments the ↪ KOMMENTAR kicker with
  // the parent title. Highlight through splitFirstMatch() — no {@html}.
  // Tailwind only, no <style> (nested island → orphaned styles in prod).
  import PostTypeChip from '../forum/kiosk/PostTypeChip.svelte';
  import { t, locale } from '../../lib/kiosk-i18n';
  import { relTime } from '../../lib/relTime';
  import { splitFirstMatch } from '../../lib/forum/searchQuery';
  import { SECTION_ACCENT, SECTION_LABEL_KEY, eventDayLabel, type SiteHit } from '../../lib/search/siteSearch';

  let { hit, q, compact = false }: { hit: SiteHit; q: string; compact?: boolean } = $props();

  const titleSplit = $derived(splitFirstMatch(hit.title, q));
  const bodySplit = $derived(splitFirstMatch(hit.excerpt, q));
  const accent = $derived(SECTION_ACCENT[hit.section]);
  const isPost = $derived(hit.kind === 'discussion' || hit.kind === 'announcement' || hit.kind === 'recommendation');

  // Kicker text after the section label — one line, mono uppercase.
  const kicker = $derived.by(() => {
    const label = $t[SECTION_LABEL_KEY[hit.section]];
    switch (hit.kind) {
      case 'comment': return `↪ ${$t['search.comment']} · ${relTime(hit.date, $locale)}`;
      case 'event': return `${label} · ${eventDayLabel(hit.date, $locale, hit.allDay === true)}${hit.allDay ? ` · ${$t['search.allday']}` : ''}`;
      case 'sell': return `${label} · ${hit.price ?? '–'} €`;
      case 'exchange': return `${label} · ${$t['market.filter.kind.tausch']}`;
      case 'gift': return `${label} · ${$t['market.filter.kind.verschenken']}`;
      case 'news': return `${label}${hit.sub ? ` · ${hit.sub}` : ''} · ${relTime(hit.date, $locale)}`;
      case 'post': return `${label}${hit.sub ? ` · ${hit.sub}` : ''} · ${relTime(hit.date, $locale)}`;
      default: return relTime(hit.date, $locale); // forum posts: chip carries the kind
    }
  });
</script>

<a
  href={hit.href}
  class="sh block focus:outline-none focus:ring-2 focus:ring-ink rounded-xl"
  data-section={hit.section}
  data-kind={hit.kind}
>
  <article class="bg-paper border-[1.5px] border-ink rounded-xl {compact ? 'px-3 py-2' : 'px-3.5 py-3'}">
    <div class="flex items-center gap-1.5 {compact ? 'mb-0.5' : 'mb-1.5'} min-w-0">
      {#if isPost}
        <PostTypeChip kind={hit.kind as 'discussion' | 'announcement' | 'recommendation'} size="sm" />
        <span class="font-dmmono text-[9.5px] text-ink-mute truncate">· {kicker}</span>
      {:else}
        <span class="font-dmmono text-[9.5px] uppercase tracking-[0.08em] truncate" style="color: {accent}">{kicker}</span>
      {/if}
    </div>
    {#if hit.kind === 'comment'}
      <p class="font-dmmono text-[9.5px] text-ink-mute tracking-[0.05em] truncate {compact ? 'mb-0.5' : 'mb-1.5'}">↪ {hit.title}</p>
    {:else}
      <h3 class="font-bricolage font-extrabold {compact ? 'text-[14px]' : 'text-[15px]'} tracking-[-0.015em] leading-[1.2] m-0 mb-1 text-ink {compact ? 'truncate' : ''}">
        {#if titleSplit}{titleSplit.prefix}<mark class="bg-ochre text-ink px-0.5">{titleSplit.match}</mark>{titleSplit.suffix}{:else}{hit.title}{/if}
      </h3>
    {/if}
    {#if hit.excerpt}
      <p class="font-bricolage text-[12.5px] leading-[1.45] text-ink-soft m-0 {compact ? 'line-clamp-1' : ''}">
        {#if bodySplit}{bodySplit.prefix}<mark class="bg-ochre text-ink px-0.5">{bodySplit.match}</mark>{bodySplit.suffix}{:else}{hit.excerpt}{/if}
      </p>
    {/if}
    {#if !compact && hit.kind === 'event' && hit.sub}
      <p class="font-dmmono text-[10px] text-ink-mute mt-1 m-0 truncate">📍 {hit.sub}</p>
    {/if}
  </article>
</a>
