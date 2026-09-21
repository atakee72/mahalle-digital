<script lang="ts">
  import type { Listing } from '../../../../types/listing';
  import { showSuccess, showToast, showError, confirmAction } from '../../../../utils/toast';
  import { resolveCategory } from '../../../../lib/marketplaceResolvers';
  import { linkifySegments, displayUrl } from '../../../../lib/linkify';
  import { bumpListing } from '../../../../hooks/api/useBumpListingMutation';
  import { setListingStatus } from '../../../../hooks/api/useListingStatusMutation';

  import DetailGallery from './DetailGallery.svelte';
  import SpecStrip from './SpecStrip.svelte';
  import ContactForm from './ContactForm.svelte';
  import SellerCard from './SellerCard.svelte';
  import CategoryChip from '../primitives/CategoryChip.svelte';
  import PriceTag from '../primitives/PriceTag.svelte';
  import DeliveryPill from '../primitives/DeliveryPill.svelte';
  import OwnStatusBanner from '../../../forum/kiosk/states/OwnStatusBanner.svelte';
  import OwnerActions from './OwnerActions.svelte';
  import BackfillBanner from '../states/BackfillBanner.svelte';
  import ListingRejectedPanel from '../states/ListingRejectedPanel.svelte';
  import KioskReportModal from '../../../forum/kiosk/KioskReportModal.svelte';
  import { t } from '../../../../lib/kiosk-i18n';
  import TranslateControl from '../../../forum/kiosk/TranslateControl.svelte';

  // ─── Props ─────────────────────────────────────────────────────────────────

  let {
    initialListing,
    currentUserId,
    isOwner,
  }: {
    initialListing: Listing;
    currentUserId: string | null;
    isOwner: boolean;
  } = $props();

  // svelte-ignore state_referenced_locally
  let listing = $state(initialListing);
  let reportOpen = $state(false);

  // ─── Translation (Task 6, content-translation) ─────────────────────────────
  // Host swaps displayed strings only — TranslateControl owns its own
  // button/label/error rendering.
  let translation = $state<{ title: string | null; body: string } | null>(null);

  // ─── Moderation state derivation ───────────────────────────────────────────

  type OwnState = 'pending' | 'rejected' | 'reported' | 'warning' | null;

  const ownModerationState = $derived.by((): OwnState => {
    if (!isOwner) return null;
    if (listing.moderationStatus === 'rejected') return 'rejected';
    if (listing.hasWarningLabel) return 'warning';
    if (listing.isUserReported && listing.moderationStatus === 'pending') return 'reported';
    if (listing.moderationStatus === 'pending') return 'pending';
    return null;
  });

  // Non-owner: community-reported pending → small GEMELDET chip (no banner)
  const showGemeldetChip = $derived(
    !isOwner &&
    listing.moderationStatus === 'pending' &&
    listing.isUserReported === true,
  );

  // Ghosting outline per state (owner-only)
  const ghostOutlineClass = $derived.by((): string => {
    if (!isOwner || !ownModerationState || ownModerationState === 'warning') return '';
    if (ownModerationState === 'pending') return 'outline outline-2 outline-dashed outline-warn outline-offset-[-2px] rounded-md';
    if (ownModerationState === 'reported') return 'outline outline-2 outline-dashed outline-plum outline-offset-[-2px] rounded-md';
    if (ownModerationState === 'rejected') return 'outline outline-2 outline-dashed outline-danger outline-offset-[-2px] rounded-md';
    return '';
  });

  // Map ownModerationState → OwnStatusBanner state prop (warning maps to pending visually)
  type BannerState = 'pending' | 'rejected' | 'reported';
  const bannerState = $derived.by((): BannerState | null => {
    if (ownModerationState === 'warning' || ownModerationState === 'pending') return 'pending';
    if (ownModerationState === 'rejected') return 'rejected';
    if (ownModerationState === 'reported') return 'reported';
    return null;
  });

  // ─── Save state ────────────────────────────────────────────────────────────

  const isSaved = $derived(
    currentUserId != null &&
    Array.isArray(listing.savedBy) &&
    listing.savedBy.map(String).includes(String(currentUserId)),
  );

  // ─── Action handlers ───────────────────────────────────────────────────────

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: listing.title, url });
      } catch {
        // User cancelled or share failed — silently ignore
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        showSuccess('Link kopiert!');
      } catch {
        showToast('Link konnte nicht kopiert werden.', { type: 'error' });
      }
    }
  }

  function scrollToContact() {
    const el = document.getElementById('market-contact-form');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ─── Body text ─────────────────────────────────────────────────────────────

  const bodyText = $derived(
    typeof listing.description === 'string'
      ? listing.description
      : (listing.descriptionPlainText ?? ''),
  );

  const displayDescription = $derived(translation?.body ?? bodyText);
  const displayTitle = $derived(translation?.title ?? listing.title);

  // ─── Price+delivery row visibility ────────────────────────────────────────

  const showDelivery = $derived(listing.delivery != null);

  // ─── Owner backfill detection ─────────────────────────────────────────────

  const categoryResolution = $derived(resolveCategory(listing.category));
  const needsBackfill = $derived(
    isOwner && (
      categoryResolution.legacy ||
      listing.delivery == null
    ),
  );

  // ─── Owner action handlers ────────────────────────────────────────────────

  async function handleBump() {
    const result = await bumpListing(String(listing._id));
    if (!result.ok) {
      if (result.error === 'bump_rate_limited' && result.retryAt) {
        const dt = new Date(result.retryAt);
        showToast(
          `Du kannst diese Anzeige erst ab ${dt.toLocaleDateString('de')} wieder hochholen.`,
          { type: 'warning', duration: 6000 },
        );
      } else if (result.error === 'bump_blocked_by_status') {
        showError('Reservierte oder verkaufte Anzeigen können nicht hochgeholt werden.');
      } else {
        showError(`Hochholen fehlgeschlagen: ${result.error}`);
      }
      return;
    }
    showSuccess('Anzeige hochgeholt!');
    listing = { ...listing, lastBumpedAt: result.lastBumpedAt!, isBumped: true };
  }

  async function handleStatusChange(status: 'available' | 'reserved' | 'sold') {
    const result = await setListingStatus(String(listing._id), status);
    if (!result.ok) {
      showError(`Status-Wechsel fehlgeschlagen: ${result.error}`);
      return;
    }
    const successMsg =
      status === 'reserved' ? 'Als reserviert markiert.' :
      status === 'sold'     ? 'Als verkauft markiert.'   :
                              'Reservierung aufgehoben.';
    showSuccess(successMsg);
    listing = {
      ...listing,
      status,
      reservedAt: status === 'reserved' ? new Date().toISOString() : null,
    };
  }

  async function handleDelete() {
    const ok = await confirmAction($t['market.owner.deleteConfirm'], {
      title: $t['market.owner.deleteConfirm.title'],
      confirmLabel: $t['market.owner.deleteConfirm.cta'],
      variant: 'danger',
    });
    if (!ok) return;
    const res = await fetch(`/api/listings/delete/${listing._id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      showError('Löschen fehlgeschlagen.');
      return;
    }
    window.location.href = '/marketplace?just_deleted=1';
  }
</script>

<!-- ─── Wrapper article (ghosting applied here) ───────────────────────────── -->
<article class="market-detail-inner {ghostOutlineClass}">

  <!-- ─── Responsive two-column grid ─────────────────────────────────────── -->
  <div
    style="
      display: grid;
      gap: 32px;
      align-items: start;
    "
    class="market-detail-grid"
  >

    <!-- ══════════ LEFT COLUMN — main content ══════════ -->
    <div style="display: flex; flex-direction: column; gap: 20px;">

      <!-- Translation, directly under the SSR description ────────────────
           The description body itself is rendered by the Astro SSR shell
           ABOVE this island (SEO/a11y — the sole permanent copy, see the
           kiosk CLAUDE.md "two render sites" note); it is deliberately not
           repeated here. Control + translated copy therefore live at the
           very top of the island so they sit next to that original: the
           page reads original → translate toggle → translation. Rendering
           them further down (they used to follow the gallery + metadata)
           stranded a translation screens away from the text it translates.
           The translated block is client-only and additive — it exists only
           once a translation has been fetched, so nothing duplicates the
           original in the default state. Hidden for an owner's rejected
           listing, which shows ListingRejectedPanel instead of the
           description + actions. -->
      {#if !(isOwner && listing.moderationStatus === 'rejected')}
        <TranslateControl
          contentType="listing"
          contentId={String(listing._id)}
          accent="var(--k-wine, #b23a5b)"
          onTranslated={(t) => (translation = t)}
        />
        {#if translation}
          <div style="padding-top: 4px;">
            {#if displayTitle !== listing.title}
              <p
                style="
                  font-family: var(--k-font-display, sans-serif); font-weight: 700;
                  font-size: 18px; color: var(--k-ink, #1b1a17); margin: 0 0 4px;
                "
              >{displayTitle}</p>
            {/if}
            <p
              style="
                font-family: var(--k-font-serif, Georgia, serif);
                font-style: italic;
                font-size: 16px;
                line-height: 1.6;
                color: var(--k-ink-soft, #4a4740);
                margin: 0;
              "
            >{#each linkifySegments(displayDescription) as seg}{#if seg.type === 'link'}<a href={seg.value} title={seg.value} target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 decoration-[1.5px] break-words hover:text-wine">{displayUrl(seg.value)}<span aria-hidden="true" class="text-[0.8em] ml-0.5">↗</span></a>{:else}{seg.value}{/if}{/each}</p>
          </div>
        {/if}
      {/if}

      <!-- Gallery -->
      <DetailGallery {listing} />

      <!-- OwnStatusBanner (owner-only, above description) -->
      {#if isOwner && bannerState}
        <OwnStatusBanner
          state={bannerState}
          reason={listing.rejectionReason}
        />
      {/if}

      <!-- BackfillBanner (owner-only, legacy listings) -->
      {#if needsBackfill}
        <BackfillBanner {listing} />
      {/if}

      <!-- Metadata block (kicker + H1 are rendered by the Astro SSR shell above;
           removed here to avoid the duplicate that was hurting the page UX and
           creating a duplicate-H1 a11y bug). -->
      <header>
        <!-- Category chip + GEMELDET chip row -->
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;">
          <CategoryChip id={listing.category} active={true} />

          {#if showGemeldetChip}
            <span
              style="
                font-family: var(--k-font-mono); font-size: 10px; font-weight: 700;
                color: var(--k-plum, #7c3d8c); letter-spacing: 0.1em;
                border: 1.5px solid var(--k-plum, #7c3d8c);
                border-radius: 4px; padding: 2px 6px;
              "
            >⚑ GEMELDET</span>
          {/if}
        </div>

        <!-- Price + delivery row -->
        <div style="display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap;">
          <PriceTag {listing} size="lg" />
          {#if showDelivery}
            <DeliveryPill kind={listing.delivery} />
          {/if}
        </div>
      </header>

      <!-- Owner-only: rejected panel replaces description+actions -->
      {#if isOwner && listing.moderationStatus === 'rejected'}
        <ListingRejectedPanel
          {listing}
          onAppeal={() => { window.location.href = `/marketplace/edit/${listing._id}`; }}
          onDelete={handleDelete}
        />
      {:else}
        <!-- SpecStrip (only when any spec is filled) -->
        <SpecStrip {listing} />
      {/if}
      <!-- end rejected/normal branch -->

      <!-- Action toolbar: merken / share / melden (always shown unless rejected) -->
      {#if listing.moderationStatus !== 'rejected' || !isOwner}
      <div
        style="
          display: flex; align-items: center; gap: 10px;
          padding-top: 4px;
        "
      >
        <!-- Save / merken -->
        <button
          title="Bald verfügbar"
          disabled
          style="
            font-family: var(--k-font-mono); font-size: 11px; font-weight: 600;
            letter-spacing: 0.06em;
            color: var(--k-ink-mute);
            background: none;
            border: 1.5px solid var(--k-rule);
            border-radius: var(--k-radius-sm, 4px);
            padding: 5px 10px;
            cursor: not-allowed;
            opacity: 0.6;
          "
        >{isSaved ? '🔖 GEMERKT' : '🔖 MERKEN'}</button>

        <!-- Share -->
        <button
          onclick={handleShare}
          style="
            font-family: var(--k-font-mono); font-size: 11px; font-weight: 600;
            letter-spacing: 0.06em;
            color: var(--k-ink);
            background: none;
            border: 1.5px solid var(--k-rule);
            border-radius: var(--k-radius-sm, 4px);
            padding: 5px 10px;
            cursor: pointer;
          "
        >↗ TEILEN</button>

        <!-- Report / melden — non-owner authenticated viewers only -->
        {#if currentUserId && !isOwner}
          <button
            type="button"
            title="Anzeige melden"
            onclick={() => (reportOpen = true)}
            style="
              font-family: var(--k-font-mono); font-size: 11px; font-weight: 600;
              letter-spacing: 0.06em;
              color: var(--k-ink-mute);
              background: none;
              border: 1.5px solid var(--k-rule);
              border-radius: var(--k-radius-sm, 4px);
              padding: 5px 10px;
              cursor: pointer;
            "
          >⚑ MELDEN</button>
        {/if}
      </div>
      {/if}
      <!-- end action toolbar -->

    </div>
    <!-- END left column -->

    <!-- ══════════ RIGHT SIDEBAR ══════════ -->
    <aside style="display: flex; flex-direction: column; gap: 16px;">

      {#if isOwner}
        <OwnerActions
          {listing}
          currentUserId={currentUserId!}
          onBump={handleBump}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
        />
      {:else}
        <!-- Contact form (anchor target for mobile CTA scroll) -->
        <div id="market-contact-form">
          <ContactForm {listing} />
        </div>
      {/if}

      <!-- Seller card -->
      <SellerCard
        sellerId={String(listing.sellerId)}
        sellerName={listing.sellerName}
        sellerHandle={listing.sellerHandle}
        sellerImage={listing.sellerImage}
        listingCount={0}
        isVerified={listing.sellerVerified === true}
        onReport={isOwner ? undefined : () => (reportOpen = true)}
      />

      <!-- Similar listings placeholder — out of v1 scope -->
      <div
        style="
          background: var(--k-paper-soft, #ede8db);
          border: 1.5px dashed var(--k-rule);
          border-radius: var(--k-radius-md);
          padding: 14px 16px;
          font-family: var(--k-font-mono); font-size: 11px;
          color: var(--k-ink-mute); letter-spacing: 0.04em;
        "
      >◆ Ähnliches im Kiez — kommt bald</div>

    </aside>
    <!-- END sidebar -->

  </div>
  <!-- END grid -->

  <!-- ─── Mobile sticky bottom bar (non-owner only, lg:hidden) ──────────── -->
  {#if !isOwner}
    <!-- `flex items-center gap-2.5` are CLASSES, not inline style, on
         purpose: an inline `display: flex` beats `lg:hidden` (a class can
         never override an inline declaration), so the bar used to stay
         visible on desktop, doubling the sidebar form's own send CTA and
         covering the page. Keep display/gap out of the style attribute. -->
    <div
      class="lg:hidden flex items-center gap-2.5"
      style="
        position: fixed;
        bottom: 64px;
        left: 0;
        right: 0;
        z-index: 30;
        background: var(--k-paper-warm, #f3ead8);
        border-top: 2px solid var(--k-ink);
        padding: 10px 16px;
        box-shadow: 0 -2px 8px rgba(0,0,0,0.08);
      "
    >
      <!-- Primary CTA -->
      <button
        onclick={scrollToContact}
        style="
          flex: 1;
          font-family: var(--k-font-mono); font-size: 13px; font-weight: 700;
          letter-spacing: 0.04em;
          color: var(--k-paper);
          background: var(--k-wine, #b23a5b);
          border: 2px solid var(--k-ink);
          border-radius: var(--k-radius-sm, 4px);
          padding: 10px 16px;
          cursor: pointer;
          box-shadow: 2px 2px 0 var(--k-ink);
        "
      >↑ Nachricht senden</button>

      <!-- Save icon button -->
      <button
        title="Bald verfügbar"
        disabled
        aria-label="Merken"
        style="
          flex-shrink: 0;
          font-size: 18px;
          background: none;
          border: 2px solid var(--k-rule);
          border-radius: var(--k-radius-sm, 4px);
          padding: 8px 12px;
          cursor: not-allowed;
          opacity: 0.5;
          line-height: 1;
        "
      >🔖</button>
    </div>

    <!-- Spacer so content isn't hidden behind sticky bar on mobile -->
    <div class="lg:hidden" style="height: 80px;"></div>
  {/if}

</article>

<!-- KioskReportModal — non-owner authenticated viewers only -->
{#if currentUserId && !isOwner}
  <KioskReportModal
    bind:open={reportOpen}
    contentType="marketplace"
    contentId={String(listing._id)}
    contentTitle={listing.title}
    onClose={() => (reportOpen = false)}
  />
{/if}

<style>
  .market-detail-inner {
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px 16px 32px;
  }

  /* Two-column on desktop, single on mobile */
  .market-detail-grid {
    grid-template-columns: 1fr;
  }

  @media (min-width: 1024px) {
    .market-detail-inner {
      padding: 32px 32px 48px;
    }

    .market-detail-grid {
      grid-template-columns: 60fr 40fr;
    }
  }
</style>
