<script lang="ts">
  /**
   * Article header — implements all 3 postLayout variants (standard / hero /
   * gallery). Task 4 only wires the hero/gallery LAYOUT files around this
   * component (full-bleed backgrounds, gallery grid below) — the header
   * anatomy itself is complete here.
   *
   * `standard` and `gallery` share the strap → title → standfirst → meta
   * skeleton (gallery drops the framed cover + photo credit, which belong
   * to the numbered image grid Task 4 builds). `hero` is a full-bleed cover
   * with an overlapping ink title band — `.bl-hero-band` is a deliberate
   * hook for Task 6's print CSS, keep the class name exact.
   *
   * Transcribed from
   * design/handoffs/design_handoff_blog/jsx/kiosk-blog-article.jsx
   * `BaStrap` + `BlogArticleStandard` (standard/gallery) + `BlogArticleHero`.
   */
  import { t } from '../../../lib/kiosk-i18n';
  import BlPostMeta from './BlPostMeta.svelte';
  import type { BeilagePost } from '../../../lib/blog/beilage';
  import { onMount } from 'svelte';

  let {
    post,
    rank,
    variant,
  }: {
    post: BeilagePost;
    rank: { no: number; of: number };
    variant: 'standard' | 'hero' | 'gallery';
  } = $props();

  // BlogTranslate.svelte (sibling island) publishes the translated title/standfirst
  // here through a document event — there is no shared store between islands.
  let tr = $state<{ title: string; description: string } | null>(null);
  onMount(() => {
    const onTr = (e: Event) => {
      tr = (e as CustomEvent<{ title: string; description: string } | null>).detail;
    };
    document.addEventListener('bl:translation', onTr);
    return () => document.removeEventListener('bl:translation', onTr);
  });
  const title = $derived(tr?.title ?? post.title);
  const description = $derived(tr?.description ?? post.description);
</script>

{#snippet heroBand()}
  <div
    class="bl-hero-band text-center"
    style="
      background: var(--k-ink);
      color: var(--k-paper);
      border: 2px solid var(--k-ink);
      border-radius: var(--k-radius-lg);
      box-shadow: 3px 3px 0 var(--k-rust);
      padding: 20px 34px;
      max-width: 760px;
    "
  >
    <div class="font-dmmono" style="font-size: 9.5px; letter-spacing: 0.2em; color: var(--k-rust-on-ink);">
      {$t['blog.strap.hero']} · {$t['blog.strap.rubrik']} {post.tags[0]?.toUpperCase()} · № {rank.no} / {rank.of}
    </div>
    <h1 class="font-bricolage text-[26px] lg:text-[38px]" style="font-weight: 800; letter-spacing: -0.025em; line-height: 1.02; margin: 8px 0 0;">{title}</h1>
  </div>
{/snippet}

{#if variant === 'hero'}
  {#if post.cover}
    <div class="relative">
      <img
        src={post.cover}
        alt={post.coverAlt ?? ''}
        width={post.coverWidth}
        height={post.coverHeight}
        class="w-full object-cover h-[260px] lg:h-[420px]"
        style="border-bottom: 2px solid var(--k-ink);"
      />
      <div class="absolute left-0 right-0 flex justify-center" style="bottom: -74px;">
        {@render heroBand()}
      </div>
    </div>
  {:else}
    <!-- coverless hero: no band overlap — render the ink title band in flow -->
    <div class="flex justify-center px-5" style="padding-top: 24px;">
      {@render heroBand()}
    </div>
  {/if}
  <div class="text-center" style="padding-top: {post.cover ? '98px' : '24px'};">
    <div class="font-instrument italic" style="font-size: 19px; line-height: 1.45; color: var(--k-ink-soft); max-width: 780px; margin: 0 auto;">{description}</div>
    <div class="flex justify-center" style="margin-top: 10px;"><BlPostMeta {post} /></div>
    <div style="width: 56px; height: 3px; background: var(--k-rust); margin: 16px auto 0;"></div>
  </div>
{:else}
  <div class="max-w-[940px] mx-auto">
    <span
      class="font-dmmono inline-block"
      style="font-size: 10px; letter-spacing: 0.16em; color: var(--k-rust); border-left: 3px solid var(--k-rust); padding-left: 10px;"
    >{$t['blog.strap.rubrik']} · {post.tags[0]?.toUpperCase()} · <span style="color: var(--k-ink-mute);">№ {rank.no} / {rank.of}</span></span>

    <h1
      class="font-bricolage text-[27px] {variant === 'gallery' ? 'lg:text-[44px]' : 'lg:text-[46px]'}"
      style="font-weight: 800; letter-spacing: -0.03em; line-height: 1; margin: 14px 0 12px;"
    >{title}</h1>

    <div
      class="font-instrument italic"
      style="font-size: {variant === 'gallery' ? '19px' : '20px'}; line-height: 1.45; color: var(--k-ink-soft); max-width: 780px; margin-bottom: 12px;"
    >{description}</div>

    <BlPostMeta {post} />

    {#if variant === 'standard' && post.cover}
      <div style="margin: 18px 0 6px; border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-lg); overflow: hidden; box-shadow: 2px 2px 0 var(--k-ink);">
        <img src={post.cover} alt={post.coverAlt ?? ''} width={post.coverWidth} height={post.coverHeight} class="w-full {post.coverFit === 'full' ? 'h-auto block' : 'object-cover h-[170px] lg:h-[330px]'}" style="object-position: {post.coverPosition ?? 'center'};" />
      </div>
      <div class="font-dmmono" style="font-size: 9.5px; color: var(--k-ink-mute); margin-bottom: 20px;">
        {#if post.coverCredit}
          {#if post.coverCreditUrl}
            FOTO: <a href={post.coverCreditUrl} target="_blank" rel="noopener license" style="text-decoration: underline; text-underline-offset: 2px;">{post.coverCredit.toUpperCase()}</a>
          {:else}
            FOTO: {post.coverCredit.toUpperCase()}
          {/if}
        {:else}
          {$t['blog.photo.credit']}
        {/if}{post.coverAlt ? ' · ' + post.coverAlt.toUpperCase() : ''}
      </div>
    {/if}
  </div>
{/if}
