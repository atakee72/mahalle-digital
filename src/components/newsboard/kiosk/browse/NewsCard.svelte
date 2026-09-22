<script lang="ts">
  import { t, locale } from '../../../../lib/kiosk-i18n';
  import { READ_DECAY, type NewsVM } from '../../../../lib/newsboard/newsTaxonomy';
  import SektionTag from '../primitives/SektionTag.svelte';
  import HeatChip from '../primitives/HeatChip.svelte';
  import ReadDot from '../primitives/ReadDot.svelte';
  import SaveToggle from '../primitives/SaveToggle.svelte';
  import ArticleImage from '../primitives/ArticleImage.svelte';
  import ArticleMeta from '../primitives/ArticleMeta.svelte';

  let {
    article,
    onSave = (_id: string) => {},
    canSave = false,
    size = 'single',
  }: { article: NewsVM; onSave?: (id: string) => void; canSave?: boolean; size?: 'single' | 'double' } = $props();

  // Bento (2026-09-22): today's top two scores print double-width (md:col-span-2,
  // set here so the grid cell and the card are one element).
  const double = $derived(size === 'double');
  const hasImage = $derived(!!article.imageUrl);
  const summaryLines = $derived(hasImage ? (double ? 4 : 3) : (double ? 8 : 6));
  const clamp = (n: number) => `display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:${n}; overflow:hidden;`;

  const title = $derived($locale === 'de' ? article.title : (article.titleEN || article.title));
  const decay = $derived(article.archived ? READ_DECAY.archived : article.read ? READ_DECAY.seen : READ_DECAY.fresh);
  const status = $derived(article.moderationStatus);
</script>

<!-- Vertical card (2026-09-22 grid): image on top, text block, meta row pinned
     to the bottom (flex-col + h-full) so cards in one grid row align. No image
     → no image box at all; the summary gets twice the lines instead (user,
     2026-09-22 13:21). -->
<article
  class={`news-card flex flex-col h-full [--news-img-ratio:16/9] ${double ? 'md:col-span-2 lg:[--news-img-ratio:21/9]' : ''}`}
  data-size={size}
  data-has-image={hasImage ? 'true' : 'false'}
  data-read-state={article.archived ? 'archived' : article.read ? 'seen' : 'fresh'}
  data-kiez={article.kiez ? 'true' : undefined}
  style={`background:var(--k-paper); border:var(--k-border-hair); border-radius:var(--k-radius-md); padding:14px; gap:14px; opacity:${decay};`
    + (article.kiez ? ' --k-paper:#1b1a17; --k-paper-warm:#1b1a17; --k-ink:#f5efe0; --k-ink-soft:#ebe1c7; --k-ink-mute:#c9bea3; --k-border-hair:1px solid #f5efe0;' : '')}
>
  {#if hasImage}
    <a href={`/newsboard/${article.id}`} class="block" tabindex="-1" aria-hidden="true">
      <ArticleImage imageUrl={article.imageUrl} quelle={article.quelle} sektion={article.sektion} ratio="16/9" alt="" />
    </a>
  {/if}

  <div class="flex flex-col flex-1 min-w-0">
    <div class="flex items-center flex-wrap" style="gap:6px; margin-bottom:8px;">
      {#if article.kiez}<span data-kiez-kicker class="font-dmmono uppercase" style="font-size:9px; font-weight:700; letter-spacing:0.1em; padding:2px 7px; color:var(--k-ink); border:1px solid var(--k-ink); border-radius:3px;">{$t['news.kiez.kicker']}</span>{/if}
      <ReadDot read={article.read} />
      <SektionTag id={article.sektion} mini />
      <HeatChip count={article.forumLinks} mini />
      {#if status === 'pending'}
        <span class="font-dmmono uppercase" style="font-size:9px; font-weight:700; letter-spacing:0.1em; padding:2px 7px; background:var(--k-ochre); color:var(--k-ink); border:1px solid var(--k-ink); border-radius:3px;">◐ {$t['news.status.pending']}</span>
      {:else if status === 'rejected'}
        <span class="font-dmmono uppercase" style="font-size:9px; font-weight:700; letter-spacing:0.1em; padding:2px 7px; background:var(--k-danger); color:var(--k-paper); border:1px solid var(--k-ink); border-radius:3px;">✕ {$t['news.status.rejected']}</span>
      {/if}
    </div>

    <a href={`/newsboard/${article.id}`} class="block no-underline">
      <h3
        class={`font-bricolage break-words hyphens-auto ${double ? 'text-[24px]' : 'text-[22px]'}`}
        style="font-weight:700; line-height:1.15; letter-spacing:-0.02em; text-wrap:balance;
               margin:0 0 6px; color:var(--k-ink);"
      >{title}</h3>
    </a>

    {#if article.dek}
      <p
        class="font-instrument italic"
        style={`font-size:14px; line-height:1.4; color:var(--k-ink-soft); margin:0 0 8px; ${clamp(2)}`}
      >{article.dek}</p>
    {/if}

    {#if status === 'rejected' && article.warningText}
      <p class="font-instrument italic" style="font-size:12px; color:var(--k-danger); margin:0 0 8px; padding-left:10px; border-left:2px solid var(--k-danger);">{article.warningText}</p>
      <p class="font-dmmono" style="font-size:9px; color:var(--k-ink-mute); margin:0 0 8px;">{$t['news.status.rejectedNote']}</p>
    {:else if status === 'pending'}
      <p class="font-dmmono" style="font-size:9px; color:var(--k-ink-mute); margin:0 0 8px;">{$t['news.status.pendingNote']}</p>
    {/if}

    <p
      class="font-bricolage"
      data-summary-lines={summaryLines}
      style={`font-size:13.5px; line-height:1.55; color:var(--k-ink); margin:0 0 12px; ${clamp(summaryLines)}`}
    >{article.summary}</p>

    <!-- meta on its own line, actions under it: one rhythm for every card
         width (a single-row meta wrapped raggedly in the 3-column cells) -->
    <div class="mt-auto flex flex-col" style="gap:10px;">
      <ArticleMeta quelle={article.quelle} publishedAt={article.publishedAt} submitterName={article.submitterName} />
      <div class="flex items-center justify-between" style="gap:12px;">
        <a
          href={`/newsboard/${article.id}`}
          class="font-dmmono"
          style="font-size:10px; color:var(--k-ink-soft); text-decoration:underline dashed; text-underline-offset:3px;"
        >{$t['news.readmore']}</a>
        {#if canSave}
          <SaveToggle saved={article.saved} mini onToggle={() => onSave(article.id)} />
        {/if}
      </div>
    </div>
  </div>
</article>
