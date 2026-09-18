<script lang="ts">
  /**
   * „Die Beilage" Rubrik-Seite — /blog/tag/[tag]. SSR (page filters +
   * sorts `posts` server-side; `allTags` is derived from the FULL
   * collection so the ANDERE RUBRIKEN row can offer every other rubric).
   * Unknown/empty tags render state 03 „Leere Rubrik" at HTTP 200 —
   * catches stale links instead of 404ing. Transcribed from
   * design/handoffs/design_handoff_blog/jsx/kiosk-blog-states.jsx
   * `BlogTagDesktop` + kiosk-blog-mobile.jsx `BlogMobileTag` + state 03.
   */
  import { locale, t } from '../../../lib/kiosk-i18n';
  import { type BeilagePost, fmtDateKicker } from '../../../lib/blog/beilage';
  import BlMasthead from './BlMasthead.svelte';
  import BlRubrikChip from './BlRubrikChip.svelte';
  import BlPostMeta from './BlPostMeta.svelte';
  import BlLayoutBadge from './BlLayoutBadge.svelte';
  import { initialsOf } from '../../../lib/initials';

  let { tag, posts, allTags }: { tag: string; posts: BeilagePost[]; allTags: Array<[string, number]> } = $props();

  const otherTags = $derived(allTags.filter(([t]) => t !== tag));
</script>

<BlMasthead compact />

<div
  class="flex items-baseline flex-wrap px-6 lg:px-12 py-3 border-b border-dashed"
  style="gap: 10px 14px; border-color: var(--k-rule);"
>
  <h1 class="font-bricolage text-[24px] lg:text-[40px]" style="font-weight: 800; letter-spacing: -0.03em; margin: 0;">
    {$t['blog.tag.title']} <span class="font-instrument italic font-normal" style="color: var(--k-rust);">#{tag}</span>
  </h1>
  <span class="font-dmmono" style="font-size: 11px; color: var(--k-ink-mute);">{posts.length} {$t['blog.tag.posts']}</span>
  <a
    href="/blog"
    class="font-dmmono inline-flex items-center justify-center rounded-full min-h-[44px] lg:min-h-0 shrink-0"
    style="margin-left: auto; font-size: 11px; color: var(--k-rust-deep); border: 1.5px solid var(--k-rust); padding: 4px 14px;"
  >{$t['blog.tag.clear']}</a>
</div>

{#if posts.length > 0}
  <div class="grid md:grid-cols-2 lg:grid-cols-3 px-6 lg:px-12 py-6" style="gap: 24px;">
    {#each posts as p (p.id)}
      <a href={`/blog/${p.id}`} class="block bl-card-in" style="text-decoration: none; color: inherit;">
        <div style="border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-lg); overflow: hidden; box-shadow: 2px 2px 0 var(--k-ink);">
          {#if p.cover}
            <img src={p.cover} alt={p.coverAlt ?? ''} class="w-full object-cover" style="height: 130px; object-position: {p.coverPosition ?? 'center'};" loading="lazy" />
          {:else}
            <!-- No cover: a deliberate initials plate, not an empty box — an empty
                 box reads as a broken image and singles the author out (2026-09-18:
                 one of four election guest authors had sent no photo). -->
            <div
              class="w-full flex items-center justify-center font-bricolage"
              style="height: 130px; background: var(--k-paper-soft); font-size: 44px; font-weight: 800; letter-spacing: -0.03em; color: var(--k-ink-mute);"
              aria-hidden="true"
            >{initialsOf(p.author && p.author !== 'Mahalle Team' ? p.author : 'Mahalle')}</div>
          {/if}
        </div>
        <div class="flex items-center" style="gap: 8px; margin: 10px 0 0;">
          <span class="font-dmmono" style="font-size: 9.5px; letter-spacing: 0.12em; color: var(--k-rust);">{fmtDateKicker(p.pubDateISO, $locale)}</span>
          <BlLayoutBadge layout={p.layout} />
        </div>
        <h3 class="font-bricolage" style="font-size: 18px; font-weight: 700; letter-spacing: -0.015em; line-height: 1.15; margin: 5px 0 6px;">{p.title}</h3>
        <div style="font-size: 12.5px; line-height: 1.45; color: var(--k-ink-soft); margin-bottom: 8px;">{p.description}</div>
        <BlPostMeta post={p} />
      </a>
    {/each}
  </div>
{:else}
  <div class="flex justify-center px-6" style="padding: 40px 24px 60px;">
    <div class="text-center bl-card-in" style="border: 1.5px dashed var(--k-rule); border-radius: var(--k-radius-md); padding: 22px 20px; max-width: 420px;">
      <div class="font-bricolage" style="font-size: 17px; font-weight: 800;">
        {$t['blog.tag.empty.pre']}<span class="font-instrument italic" style="color: var(--k-rust);">#{tag}</span>{$t['blog.tag.empty.post']}
      </div>
      <div style="font-size: 12.5px; color: var(--k-ink-soft); margin: 5px 0 12px;">{$t['blog.tag.empty.body']}</div>
      <a
        href="/blog"
        class="font-dmmono inline-flex items-center justify-center rounded-full min-h-[44px]"
        style="font-size: 11px; padding: 7px 16px; border: 1.5px solid var(--k-ink); color: var(--k-ink); text-decoration: none;"
      >{$t['blog.readbar.back']}</a>
    </div>
  </div>
{/if}

<div class="flex items-center flex-wrap px-6 lg:px-12" style="gap: 8px; margin: 18px 0 40px; border-top: 1px dashed var(--k-rule); padding-top: 14px;">
  <span class="font-dmmono" style="font-size: 10px; letter-spacing: 0.14em; color: var(--k-ink-mute);">{$t['blog.tag.others']}</span>
  {#each otherTags as [t, n] (t)}
    <BlRubrikChip tag={t} n={n} small href={`/blog/tag/${t}`} />
  {/each}
</div>
