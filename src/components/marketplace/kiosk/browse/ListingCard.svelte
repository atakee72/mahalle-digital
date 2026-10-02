<script lang="ts">
  import { onMount } from 'svelte';
  import { locale, t } from '../../../../lib/kiosk-i18n';
  import { resolveCategory } from '../../../../lib/marketplaceResolvers';
  import { formatRelativeTime } from '../../../../lib/marketplaceFormat';
  import type { Listing } from '../../../../types/listing';

  import CategoryChip from '../primitives/CategoryChip.svelte';
  import DeliveryPill from '../primitives/DeliveryPill.svelte';
  import PriceTag from '../primitives/PriceTag.svelte';
  import ListingImagePlaceholder from '../primitives/ListingImagePlaceholder.svelte';
  import MarketStrap from '../primitives/MarketStrap.svelte';
  import KioskAvatar from '../../../forum/kiosk/KioskAvatar.svelte';
  import StatusBadge from '../../../forum/kiosk/StatusBadge.svelte';
  import NewMark from '../../../forum/kiosk/NewMark.svelte';

  let {
    listing,
    currentUserId = null,
    inOwnerView = false,
  }: {
    listing: Listing;
    currentUserId?: string | null;
    /** True when the card is rendered inside the author's „Meine Anzeigen"
        view (?view=mine). Drives the past-21d grayed + warning-chip look —
        public feed never sees that state because the server filter excludes
        past-21d listings from non-owner branches entirely. */
    inOwnerView?: boolean;
  } = $props();

  // ── Derived strap state ──────────────────────────────────────────
  const now = new Date();
  // Prefer the server-computed `isBumped` virtual (safe for non-owners per A5).
  // Owners also receive `lastBumpedAt` so they could re-derive locally; the
  // virtual is the canonical signal regardless.
  const bumped = $derived(
    listing.isBumped ??
    (listing.lastBumpedAt
      ? now.getTime() - new Date(listing.lastBumpedAt).getTime() < 24 * 60 * 60 * 1000
      : false)
  );

  // ── Bump pop animation ──────────────────────────────────────────
  // Fires only on the transition from not-bumped → bumped (not on initial
  // render of already-bumped cards). prevBumped is sync'd to the initial
  // bumped state in onMount so the effect doesn't false-trigger on mount.
  let prevBumped = $state(false);
  let popClass = $state('');

  onMount(() => {
    prevBumped = bumped;
  });

  $effect(() => {
    if (bumped && !prevBumped) {
      popClass = 'market-bump';
      setTimeout(() => { popClass = ''; }, 400);
    }
    prevBumped = bumped;
  });
  // A5 superseded May 2026: stale/altpapier is no longer a public concept.
  // The server-side filter (buildListingsFilter) excludes past-21d listings
  // from non-owner branches, so a public card here is ALWAYS within the
  // freshness clock. Owners viewing their own „Meine Anzeigen" see past-21d
  // listings as grayed + warning chip via the isHiddenFromPublic path below.
  const reserved = $derived(listing.status === 'reserved');
  const sold = $derived(listing.status === 'sold');
  const draft = $derived(listing.status === 'draft');

  // Owner-facing: this listing is past 21d → public can't see it; the author
  // needs to bump (or delete). Server-computed `isPubliclyHidden` virtual.
  const isHiddenFromPublic = $derived(
    inOwnerView && listing.isPubliclyHidden === true,
  );

  const resolvedCat = $derived(resolveCategory(listing.category));

  // Category color for riso print shadow and thumb tint.
  const catShadowToken = $derived(resolvedCat.token ?? '--k-ink-mute');

  // Relative timestamp.
  const relTime = $derived(formatRelativeTime(listing.createdAt, $locale));

  // Photo count.
  const photoCount = $derived(listing.images?.length ?? 0);

  // ── Moderation / author visibility ───────────────────────────────────
  const isAuthor = $derived(
    !!currentUserId && String(listing.sellerId) === currentUserId
  );

  const inferredBadge = $derived.by(() => {
    if (listing.moderationStatus === 'rejected') return 'rejected' as const;
    if (listing.isUserReported && listing.moderationStatus === 'pending') return 'reported' as const;
    if (listing.moderationStatus === 'pending') return 'pending' as const;
    if (listing.hasWarningLabel) return 'warning' as const;
    return null;
  });

  const ghostClass = $derived.by(() => {
    if (!isAuthor || !inferredBadge) return '';
    return {
      pending:  'outline outline-2 outline-dashed outline-warn outline-offset-[-2px] rounded-md',
      reported: 'outline outline-2 outline-dashed outline-plum outline-offset-[-2px] rounded-md',
      rejected: 'outline outline-2 outline-dashed outline-danger outline-offset-[-2px] rounded-md',
      warning:  '',
    }[inferredBadge] ?? '';
  });

  const ghostOpacity = $derived(isAuthor && inferredBadge ? 'opacity-70' : '');
</script>

<article
  class="market-card {popClass} {isHiddenFromPublic ? 'market-stale' : 'market-fresh'} {ghostClass}"
  style="
    background: var(--k-paper-warm);
    border: var(--k-border-ink);
    border-radius: var(--k-radius-md);
    box-shadow: 2px 2px 0 var({catShadowToken});
    overflow: hidden;
    display: flex;
    flex-direction: column;
    position: relative;
  "
>
  <!-- Image area with strap stack + photo-count badge -->
  <div style="padding: 8px; position: relative;">
    <ListingImagePlaceholder
      category={listing.category}
      src={listing.images?.[0] ?? null}
      alt={listing.title}
    />

    <!-- Top-left strap stack: entwurf → bump → reserviert.
         altpapier + altbestand were removed in May 2026 — past-21d listings
         are hidden from public entirely; the owner sees a grayed card +
         warning chip in their „Meine Anzeigen" view (see isHiddenFromPublic
         branch below). The strap kinds + CSS stay in MarketStrap.svelte
         for any future direct-DB-edit edge case. -->
    <div
      style="
        position: absolute; top: 14px; left: 14px;
        display: flex; flex-direction: column; gap: 4px;
        align-items: flex-start;
        z-index: 1;
      "
    >
      {#if draft}
        <MarketStrap kind="entwurf" small={true} />
      {/if}
      {#if bumped}
        <MarketStrap kind="bump" small={true} />
      {/if}
      {#if sold}
        <MarketStrap kind="verkauft" small={true} />
      {:else if reserved}
        <MarketStrap kind="reserviert" small={true} />
      {/if}
      <!-- Author-only moderation status badge in strap stack -->
      {#if isAuthor && inferredBadge}
        <StatusBadge state={inferredBadge} size="sm" />
      {/if}
    </div>

    <!-- Non-author GEMELDET chip (anti-stigma marker) -->
    {#if !isAuthor && listing.moderationStatus === 'pending' && listing.isUserReported}
      <span
        class="reported-chip font-dmmono"
        style="
          position: absolute; top: 14px; right: 14px;
          font-size: 9px; font-weight: 700; letter-spacing: 0.1em;
          color: var(--k-plum, #7c3d8c);
          background: var(--k-paper);
          border: 1.5px solid var(--k-plum, #7c3d8c);
          border-radius: 4px;
          padding: 2px 6px;
          z-index: 1;
        "
      >⚑ {$t['status.reported']}</span>
    {/if}

    <!-- Image count badge — bottom-right -->
    {#if photoCount > 0}
      <span
        style="
          position: absolute; bottom: 14px; right: 14px;
          font-family: var(--k-font-mono); font-size: 10px; font-weight: 600;
          background: var(--k-ink); color: var(--k-paper);
          padding: 2px 6px; border-radius: 4px; letter-spacing: 0.05em;
        "
      >📷 {photoCount}</span>
    {/if}
  </div>

  <!-- Body (opacity reduced for author-moderated cards) -->
  <div
    class={ghostOpacity}
    style="
      padding: 4px 12px 12px;
      display: flex; flex-direction: column; gap: 8px; flex: 1;
    "
  >
    <!-- Owner-only warning chip: this listing is past 21d and hidden from
         the public feed. Only the owner sees this card (it's in their
         „Meine Anzeigen" view). Bump button on the detail page brings it
         back into public view. -->
    {#if isHiddenFromPublic}
      <span
        class="font-dmmono"
        style="
          align-self: flex-start;
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em;
          color: var(--k-ink); background: var(--k-ochre, #e8a53a);
          border: 1.5px solid var(--k-ink);
          border-radius: 4px;
          padding: 2px 7px;
          text-transform: uppercase;
        "
      >⚠ {$t['market.owner.notInPublicFeed']}</span>
    {/if}

    <!-- Category chip + timestamp -->
    <div
      style="
        display: flex; align-items: center; gap: 6px;
        justify-content: space-between;
      "
    >
      <CategoryChip id={listing.category} mini={true} />
      <span style="display: inline-flex; align-items: center; gap: 6px;">
        <NewMark section="markt" created={listing.createdAt} authorId={String(listing.sellerId ?? '')} />
        <span
          style="
            font-family: var(--k-font-mono); font-size: 10px;
            color: var(--k-ink-mute);
          "
        >{relTime}</span>
      </span>
    </div>

    <!-- Title -->
    <h3
      style="
        font-size: 15px; font-weight: 700; letter-spacing: -0.012em;
        line-height: 1.25; margin: 0; color: var(--k-ink);
      "
    >{listing.title}</h3>

    <!-- Price + delivery, pushed to bottom -->
    <div
      style="
        margin-top: auto;
        display: flex; align-items: flex-end;
        justify-content: space-between; gap: 8px;
      "
    >
      <PriceTag {listing} size="sm" />
      {#if listing.delivery}
        <DeliveryPill kind={listing.delivery} />
      {/if}
    </div>

    <!-- Seller strip -->
    <div
      style="
        display: flex; align-items: center; gap: 6px;
        padding-top: 6px;
        border-top: 1px dashed var(--k-rule);
      "
    >
      <KioskAvatar
        name={listing.sellerName ?? '?'}
        image={listing.sellerImage ?? null}
        size="sm"
      />
      <span
        style="
          font-family: var(--k-font-mono); font-size: 10px;
          color: var(--k-ink-soft);
        "
      >{listing.sellerName ?? '—'}</span>
      <span
        style="
          margin-left: auto;
          font-family: var(--k-font-mono); font-size: 10px;
          color: var(--k-ink-mute);
        "
      >★ {listing.savedBy?.length ?? 0}</span>
    </div>
  </div>
</article>
