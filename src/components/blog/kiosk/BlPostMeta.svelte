<script lang="ts">
  // Post meta row — date · team · reading time. Shared atom
  // reused by the lead card, column cards, and Task 3/4/5 surfaces.
  import { locale, t } from '../../../lib/kiosk-i18n';
  import { fmtDate, type BeilagePost } from '../../../lib/blog/beilage';

  let { post }: { post: BeilagePost } = $props();
  // A post revised after publication carries `updatedDate` (press convention: the text changed, say when).
  // Only the article page serialises `updatedDateISO`, so the cards never grow this.
  const updated = $derived(post.updatedDateISO && post.updatedDateISO.slice(0, 10) !== post.pubDateISO.slice(0, 10) ? post.updatedDateISO : null);
</script>

<div
  class="font-dmmono flex items-center flex-wrap"
  style="gap: 8px; font-size: 10.5px; color: var(--k-ink-mute);"
>
  <span>{fmtDate(post.pubDateISO, $locale)}</span>
  {#if updated}
    <span>·</span>
    <span data-bl-updated>{$t['blog.meta.updated']} {fmtDate(updated, $locale)}</span>
  {/if}
  <span>·</span>
  <!-- Guest posts carry their author's name; the schema default 'Mahalle Team' keeps the localized team label. -->
  <span>{post.author && post.author !== 'Mahalle Team' ? post.author : $t['blog.meta.team']}</span>
  <span>·</span>
  <span>{post.minutes} {$t['blog.meta.min']}</span>
</div>
