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
  }: { article: NewsVM; onSave?: (id: string) => void; canSave?: boolean } = $props();

  const title = $derived($locale === 'de' ? article.title : (article.titleEN || article.title));
  const noImage = $derived(!article.imageUrl);
  const decay = $derived(article.archived ? READ_DECAY.archived : article.read ? READ_DECAY.seen : READ_DECAY.fresh);
  const status = $derived(article.moderationStatus);
</script>

<article
  class={`news-card grid items-start grid-cols-1 [--news-img-ratio:16/9] sm:[--news-img-ratio:4/3] ${noImage ? '' : 'sm:grid-cols-[1fr_220px]'}`}
  data-read-state={article.archived ? 'archived' : article.read ? 'seen' : 'fresh'}
  data-kiez={article.kiez ? 'true' : undefined}
  style={`background:var(--k-paper); border:var(--k-border-hair); border-radius:var(--k-radius-md); padding:18px; gap:22px; opacity:${decay};`
    + (article.kiez ? ' --k-paper:#1b1a17; --k-paper-warm:#1b1a17; --k-ink:#f5efe0; --k-ink-soft:#ebe1c7; --k-ink-mute:#c9bea3; --k-border-hair:1px solid #f5efe0;' : '')}
>
  <div>
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
        class="font-bricolage break-words hyphens-auto"
        style="font-weight:700; font-size:22px; line-height:1.15; letter-spacing:-0.02em;
               margin:0 0 6px; color:var(--k-ink);"
      >{title}</h3>
    </a>

    <p
      class="font-instrument italic"
      style="font-size:14px; line-height:1.4; color:var(--k-ink-soft); margin:0 0 10px; max-width:70ch;"
    >{article.dek}</p>

    {#if status === 'rejected' && article.warningText}
      <p class="font-instrument italic" style="font-size:12px; color:var(--k-danger); margin:0 0 8px; padding-left:10px; border-left:2px solid var(--k-danger);">{article.warningText}</p>
      <p class="font-dmmono" style="font-size:9px; color:var(--k-ink-mute); margin:0 0 8px;">{$t['news.status.rejectedNote']}</p>
    {:else if status === 'pending'}
      <p class="font-dmmono" style="font-size:9px; color:var(--k-ink-mute); margin:0 0 8px;">{$t['news.status.pendingNote']}</p>
    {/if}

    <p
      class="font-bricolage"
      style="font-size:13.5px; line-height:1.55; color:var(--k-ink); margin:0 0 12px; max-width:70ch;"
    >{article.summary}</p>

    <div class="flex items-center" style="gap:12px;">
      <ArticleMeta quelle={article.quelle} publishedAt={article.publishedAt} submitterName={article.submitterName} />
      <div class="flex-1"></div>
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

  {#if !noImage}
    <div class="order-first sm:order-none"><ArticleImage imageUrl={article.imageUrl} quelle={article.quelle} sektion={article.sektion} ratio="4/3" alt={title} /></div>
  {/if}
</article>
