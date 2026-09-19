<script lang="ts">
  import { locale, t } from '../../../../lib/kiosk-i18n';
  import { shortenUrlsInText } from '../../../../lib/linkify';
  import { resolveCategory } from '../../../../lib/marketplaceResolvers';
  import { formatRelativeTime } from '../../../../lib/marketplaceFormat';
  import { optimizeCloudinary } from '../../../../utils/cloudinary';
  import type { Listing } from '../../../../types/listing';

  import CategoryChip from '../primitives/CategoryChip.svelte';
  import DeliveryPill from '../primitives/DeliveryPill.svelte';
  import PriceTag from '../primitives/PriceTag.svelte';
  import ListingImagePlaceholder from '../primitives/ListingImagePlaceholder.svelte';
  import KioskAvatar from '../../../forum/kiosk/KioskAvatar.svelte';

  let { listing }: { listing: Listing | null } = $props();

  // Bail out early if no listing — template will return nothing.

  const resolvedCat = $derived(listing ? resolveCategory(listing.category) : null);

  // Category color for carved title accent and thumb tint.
  const catColorVar = $derived(
    resolvedCat?.token ? `var(${resolvedCat.token})` : 'var(--k-ink-mute)'
  );

  // Split title on " · " for carved-italic accent on first segment.
  const titleParts = $derived.by(() => {
    if (!listing) return { first: '', rest: '' };
    const idx = listing.title.indexOf(' · ');
    if (idx === -1) return { first: listing.title, rest: '' };
    return { first: listing.title.slice(0, idx), rest: listing.title.slice(idx) };
  });

  // Truncate body to 180 chars.
  const bodyLead = $derived.by(() => {
    if (!listing) return '';
    const src = shortenUrlsInText(listing.descriptionPlainText ?? '');
    return src.length > 180 ? src.slice(0, 180) + '…' : src;
  });

  // Photo count (images is string[] on the Listing type).
  const photoCount = $derived(listing?.images?.length ?? 0);

  // Relative time for the strap.
  const relTime = $derived(
    listing ? formatRelativeTime(listing.createdAt, $locale) : ''
  );

  const strapLabel = $derived(
    $locale === 'de' ? `★ ${$t['market.lead.banner']}` : '★ FRESH IN THE KIEZ TODAY'
  );

  // formatRelativeTime already includes the locale-correct suffix
  // (DE: "vor 2 Std.", EN: "2h ago"). DE appends "eingestellt"; EN passes through.
  const strapTime = $derived(
    $locale === 'de' ? relTime + ' eingestellt' : relTime
  );

  const photoWord = $derived($locale === 'de' ? 'Fotos' : 'photos');
</script>

{#if listing}
  <article
    class="market-lead"
    style="
      background: var(--k-paper-warm);
      border: var(--k-border-ink);
      border-radius: var(--k-radius-lg);
      box-shadow: 4px 4px 0 {catColorVar};
      overflow: hidden;
      position: relative;
    "
  >
    <!-- Top-edge strap: full width, absolute -->
    <div
      class="market-lead-strap"
      style="
        position: absolute; top: 0; left: 0; right: 0;
        background: var(--k-ink); color: var(--k-paper);
        font-family: var(--k-font-mono); font-weight: 600;
        letter-spacing: 0.14em; text-transform: uppercase;
        display: flex; justify-content: space-between; align-items: center; gap: 8px;
        z-index: 2;
      "
    >
      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{strapLabel}</span>
      <span style="color: var(--k-ochre); white-space: nowrap; flex-shrink: 0;">● {strapTime}</span>
    </div>

    <!-- Image side -->
    <div class="market-lead-img">
      <ListingImagePlaceholder
        lead={true}
        category={listing.category}
        src={listing.images?.[0] ?? null}
        alt={listing.title}
      />

      <!-- 5-thumb strip + photo count -->
      <div style="display: flex; gap: 4px; margin-top: 8px; align-items: center;">
        {#each { length: Math.min(photoCount, 5) } as _, i}
          {@const thumbUrl = listing.images?.[i]}
          <div
            style="
              width: 38px; height: 30px;
              border: {i === 0 ? '2px solid var(--k-ink)' : '1px solid var(--k-rule)'};
              border-radius: 4px;
              background: {thumbUrl ? `center/cover url('${optimizeCloudinary(thumbUrl)}'), ${catColorVar}` : (i === 0 ? catColorVar : 'var(--k-paper-soft)')};
              opacity: {thumbUrl ? 1 : (i === 0 ? 0.55 : 0.5)};
              flex-shrink: 0;
            "
          ></div>
        {/each}
        {#if photoCount > 0}
          <span
            style="
              font-family: var(--k-font-mono); font-size: 10px;
              color: var(--k-ink-mute); margin-left: 6px; align-self: center;
            "
          >
            {photoCount} {photoWord}
          </span>
        {/if}
      </div>
    </div>

    <!-- Content side -->
    <div class="market-lead-content">
      <CategoryChip id={listing.category} active={true} />

      <!-- Headline with carved-italic first segment -->
      <h2
        class="market-lead-title"
        style="
          font-weight: 800; letter-spacing: -0.022em;
          line-height: 1.1; margin: 0; color: var(--k-ink);
          overflow-wrap: break-word; word-break: break-word;
        "
      >
        <span
          style="
            font-family: var(--k-font-serif); font-style: italic;
            font-weight: 400; color: {catColorVar};
          "
        >{titleParts.first}</span>
        {#if titleParts.rest}
          <span style="color: var(--k-ink-soft); font-weight: 600;">{titleParts.rest}</span>
        {/if}
      </h2>

      <!-- Italic body lead-in, truncated to 180 chars -->
      <p
        style="
          font-family: var(--k-font-serif); font-style: italic;
          font-size: 15px; line-height: 1.45; color: var(--k-ink-soft); margin: 0;
        "
      >
        {bodyLead}
      </p>

      <!-- Divider + price + delivery -->
      <div
        style="
          display: flex; align-items: center; justify-content: space-between;
          margin-top: auto; padding-top: 12px;
          border-top: 1px dashed var(--k-rule);
        "
      >
        <PriceTag {listing} size="lg" />
        <DeliveryPill kind={listing.delivery} />
      </div>

      <!-- Seller mini-strip -->
      <div
        style="
          display: flex; align-items: center; gap: 8px;
          font-family: var(--k-font-mono); font-size: 10.5px;
          color: var(--k-ink-mute);
        "
      >
        <KioskAvatar
          name={listing.sellerName ?? '?'}
          image={listing.sellerImage ?? null}
          size="sm"
        />
        <span>
          <b style="color: var(--k-ink);">{listing.sellerName ?? '—'}</b>
        </span>
        <span style="margin-left: auto;">
          ★ {listing.savedBy?.length ?? 0} · 👁 {listing.views ?? 0}
        </span>
      </div>
    </div>
  </article>
{/if}

<style>
  /* Mobile-first: single-column stack, tight margins, horizontal dashed divider. */
  .market-lead {
    /* 16px side margin = the page inset every section uses on phones (forum, calendar, news: 16).
       Was 12px while this page's heading sat at 20px — heading and cards did not share an edge (2026-09-19). */
    margin: 14px 16px;
    display: grid;
    grid-template-columns: 1fr;
    row-gap: 0;
  }
  .market-lead-strap {
    padding: 6px 12px;
    font-size: 9.5px;
  }
  .market-lead-img {
    padding: 38px 14px 12px;
    border-bottom: 1px dashed var(--k-rule);
  }
  .market-lead-content {
    padding: 14px 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .market-lead-title {
    font-size: 22px;
  }

  /* Desktop: 2-column editorial layout per original design. */
  @media (min-width: 1024px) {
    .market-lead {
      margin: 18px 36px;
      grid-template-columns: 1.35fr 1fr;
      column-gap: 28px;
    }
    .market-lead-strap {
      padding: 6px 18px;
      font-size: 10px;
    }
    .market-lead-img {
      padding: 44px 0 18px 22px;
      border-bottom: 0;
      border-right: 1px dashed var(--k-rule);
      padding-right: 14px;
      margin-right: -14px;
    }
    .market-lead-content {
      padding: 44px 22px 18px 4px;
    }
    .market-lead-title {
      font-size: 26px;
    }
  }
</style>
