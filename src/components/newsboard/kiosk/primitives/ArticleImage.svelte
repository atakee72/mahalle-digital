<script lang="ts">
  import { t } from '../../../../lib/kiosk-i18n';
  import { QUELLE_META, type QuelleKey } from '../../../../lib/newsboard/newsTaxonomy';
  import { optimizeCloudinary } from '../../../../utils/cloudinary';

  let {
    imageUrl = '',
    quelle,
    ratio = '16/9',
    lead = false,
    alt = '',
  }: {
    imageUrl?: string;
    quelle: QuelleKey;
    ratio?: string;
    lead?: boolean;
    alt?: string;
  } = $props();

  const hasImage = $derived(!!imageUrl);
  const monogram = $derived((QUELLE_META[quelle]?.short ?? '•').toUpperCase().slice(0, 2));
</script>

{#if hasImage}
  <img
    src={optimizeCloudinary(imageUrl)}
    {alt}
    loading="lazy"
    class="w-full object-cover"
    style="aspect-ratio:var(--news-img-ratio, {ratio}); border:var(--k-border-ink); border-radius:var(--k-radius-md);"
  />
{:else}
  <!-- First-class no-image placeholder: dashed border + source monogram -->
  <div
    class="w-full flex flex-col items-center justify-center"
    style="aspect-ratio:var(--news-img-ratio, {ratio}); border-radius:var(--k-radius-md);
           border:var(--news-noimage-border); background:var(--news-noimage-bg);"
  >
    <div
      class="font-instrument italic"
      style="font-size:{lead ? 42 : 26}px; color:var(--k-ink-mute); line-height:1; opacity:0.6;"
    >{monogram}</div>
    <div
      class="font-dmmono uppercase"
      style="font-size:{lead ? 10 : 9}px; color:var(--k-ink-mute); letter-spacing:0.18em; margin-top:8px;"
    >{lead ? $t['news.noimage.lead'] : $t['news.noimage.short']}</div>
  </div>
{/if}
