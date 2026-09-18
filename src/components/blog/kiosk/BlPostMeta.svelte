<script lang="ts">
  // Post meta row — date · team · reading time · EN chip. Shared atom
  // reused by the lead card, column cards, and Task 3/4/5 surfaces.
  import { locale, t } from '../../../lib/kiosk-i18n';
  import { fmtDate, type BeilagePost } from '../../../lib/blog/beilage';

  let { post }: { post: BeilagePost } = $props();
</script>

<div
  class="font-dmmono flex items-center flex-wrap"
  style="gap: 8px; font-size: 10.5px; color: var(--k-ink-mute);"
>
  <span>{fmtDate(post.pubDateISO, $locale)}</span>
  <span>·</span>
  <!-- Guest posts carry their author's name; the schema default 'Mahalle Team' keeps the localized team label. -->
  <span>{post.author && post.author !== 'Mahalle Team' ? post.author : $t['blog.meta.team']}</span>
  <span>·</span>
  <span>{post.minutes} {$t['blog.meta.min']}</span>
  <span
    style="
      padding: 1px 6px;
      border: 1px solid color-mix(in srgb, currentColor 33%, transparent);
      border-radius: 4px;
      font-size: 9px;
    "
    title={$t['blog.meta.en.tooltip']}
  >EN</span>
</div>
