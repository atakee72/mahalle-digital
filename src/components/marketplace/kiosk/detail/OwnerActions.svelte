<script lang="ts">
  import type { Listing } from '../../../../types/listing';
  import { t, locale, tStr } from '../../../../lib/kiosk-i18n';
  import PendingLockBanner from './PendingLockBanner.svelte';

  let {
    listing,
    onBump,
    onStatusChange,
    onDelete,
  }: {
    listing: Listing;
    onBump: () => Promise<void>;
    onStatusChange: (status: 'available' | 'reserved' | 'sold') => Promise<void>;
    onDelete: () => Promise<void>;
  } = $props();

  // ─── Derived state ─────────────────────────────────────────────────────────

  // Only `pending` triggers the PendingLockBanner. Warning-labeled listings
  // (`hasWarningLabel === true`) are approved-with-caveat — the listing is
  // publicly visible (blurred). The action grid renders for them; bump +
  // status mutations work, edit is disabled-with-tooltip below.
  const isPending = $derived(listing.moderationStatus === 'pending');

  const TWENTY_ONE_DAYS = 21 * 24 * 60 * 60 * 1000;

  // Stale (new semantics, May 2026 supersession of A5):
  // — keyed off max(createdAt, lastBumpedAt), the "freshness clock".
  // — When stale, the listing is hidden from the public feed entirely.
  // — Bump resets the clock and brings it back into public view.
  // The bump button's label swaps to "↻ Auffrischen" in this state — same
  // action, clearer intent. Bumping does NOT change createdAt; the next
  // bump-window starts from now.
  //
  // Freshness clock = max(createdAt, lastBumpedAt). When > 21d in the past,
  // the listing is hidden from public (server-side filter) and the bump
  // button shows the ↻ Auffrischen label so the owner knows what to do.
  const freshnessMs = $derived.by(() => {
    const lastBump = listing.lastBumpedAt ? new Date(listing.lastBumpedAt).getTime() : 0;
    const created = new Date(listing.createdAt).getTime();
    return Math.max(lastBump, created);
  });
  const isStale = $derived(Date.now() - freshnessMs >= TWENTY_ONE_DAYS);

  // Bump is meaningful only when the listing is currently hidden from the
  // public feed (past the freshness clock). For fresh listings, bumping is
  // a no-op (listing is already at the top) — so the button is disabled
  // with a tooltip explaining when it'll re-enable.
  //
  // Warning-labeled listings ARE bumpable (server-side allowOnWarningLabel
  // is now true). Bump does NOT change content, just the freshness timestamp.
  const canBump = $derived(
    listing.status === 'available' &&
    listing.moderationStatus === 'approved' &&
    isStale,
  );

  // Tooltip countdown when the bump button is disabled because the listing
  // is still fresh. Days until the freshness clock crosses 21d.
  const daysUntilStale = $derived.by((): number => {
    const remainingMs = TWENTY_ONE_DAYS - (Date.now() - freshnessMs);
    if (remainingMs <= 0) return 0;
    return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  });
  const freshTooltip = $derived(
    tStr($t['market.owner.bump.disabledFresh'], { n: daysUntilStale }),
  );

  // ─── Edit gate ─────────────────────────────────────────────────────────
  // The 4th seat in the multi-gate alignment (page-frontmatter + API
  // endpoint + compose-component + this button). All four must agree on
  // which states block edit. Currently: pending / reserved / sold.
  // `pending` is already short-circuited above (PendingLockBanner replaces
  // the grid), so canEdit only has to filter reserved/sold here.
  const canEdit = $derived(
    listing.status !== 'reserved' && listing.status !== 'sold',
  );
  const editBlockedTooltip = $derived(
    listing.status === 'reserved'
      ? $t['market.owner.edit.blockedReserved']
      : listing.status === 'sold'
      ? $t['market.owner.edit.blockedSold']
      : undefined,
  );

  const showReserveToggle = $derived(
    listing.status === 'available' || listing.status === 'reserved',
  );

  const showSoldButton = $derived(
    listing.status === 'available' || listing.status === 'reserved',
  );

  // Stats: savedBy count + views
  const savedCount = $derived(
    Array.isArray(listing.savedBy) ? listing.savedBy.length : 0,
  );

  // ─── Busy state (prevents double-click) ───────────────────────────────────

  // Last-bump label (derived so it doesn't inline an IIFE in the template)
  const lastBumpLabel = $derived.by((): string | null => {
    if (!listing.lastBumpedAt) return null;
    const days = Math.floor(
      (Date.now() - new Date(listing.lastBumpedAt).getTime()) / (24 * 60 * 60 * 1000),
    );
    return $locale === 'en' ? `last bump: ${days}d ago` : `letzter Bump: vor ${days} Tagen`;
  });

  let busy = $state(false);

  async function handleBump() {
    if (busy || !canBump) return;
    busy = true;
    try { await onBump(); } finally { busy = false; }
  }

  async function handleStatusChange(status: 'available' | 'reserved' | 'sold') {
    if (busy) return;
    busy = true;
    try { await onStatusChange(status); } finally { busy = false; }
  }

  async function handleDelete() {
    if (busy) return;
    busy = true;
    try { await onDelete(); } finally { busy = false; }
  }
</script>

<div class="owner-actions-panel">

  <!-- ─── Header strip ─────────────────────────────────────────────────────── -->
  <div class="owner-header">
    <span class="owner-kicker">
      <!-- wine kicker per page-accent rule -->
      {$t['market.owner.header']}
    </span>
    <span class="owner-stats">
      {savedCount} merkt · {listing.views ?? 0} Aufrufe
    </span>
  </div>

  {#if isPending}
    <!-- Pending only: lock banner replaces the action grid entirely. Warning-
         labeled listings render the action grid below (with edit disabled). -->
    <PendingLockBanner />
  {:else}
    <!-- ─── 2×2 action grid ───────────────────────────────────────────────── -->
    <div class="owner-grid">

      <!-- Bearbeiten — active for approved/warning/rejected listings. Disabled
           with a tooltip for reserved/sold (the page gate would redirect them
           to /marketplace?edit_blocked=1 anyway; this prevents the dead-end UX
           where the button looks clickable but bounces the owner back).
           Pending is short-circuited above by PendingLockBanner. The edit
           endpoint re-runs full moderation on every content change AND writes
           a pre-edit audit snapshot to listingAuditTrail before clearing the
           warning/rejection. -->
      {#if canEdit}
        <a
          href="/marketplace/edit/{listing._id}"
          class="owner-btn owner-btn--primary"
        >{$t['market.owner.edit']}</a>
      {:else}
        <button
          type="button"
          class="owner-btn owner-btn--primary"
          disabled
          aria-disabled="true"
          title={editBlockedTooltip}
        >{$t['market.owner.edit']}</button>
      {/if}

      <!-- Frisch hochholen / Auffrischen — enabled only when listing is
           past 21d freshness clock. Fresh listings: disabled with countdown
           tooltip explaining when bump will re-enable. Bumping resets the
           clock and brings the listing back into public view. -->
      {#if canBump}
        <button
          class="owner-btn owner-btn--outline"
          onclick={handleBump}
          disabled={busy}
          title={$t['market.owner.refresh.tooltip']}
        >↻ {$t['market.owner.refresh.cta']}</button>
      {:else}
        <!-- Disabled: either still fresh (show countdown), or status/
             moderation problem (no tooltip — other buttons cover it). -->
        <button
          class="owner-btn owner-btn--outline"
          disabled
          aria-disabled="true"
          title={isStale ? undefined : freshTooltip}
        >{isStale ? `↻ ${$t['market.owner.refresh.cta']}` : $t['market.owner.bump']}</button>
      {/if}

      <!-- Reserve toggle / sold toggle -->
      {#if showReserveToggle}
        {#if listing.status === 'available'}
          <button
            class="owner-btn owner-btn--outline"
            onclick={() => handleStatusChange('reserved')}
            disabled={busy}
          >{$t['market.owner.markReserved']}</button>
        {:else if listing.status === 'reserved'}
          <button
            class="owner-btn owner-btn--outline"
            onclick={() => handleStatusChange('available')}
            disabled={busy}
          >{$t['market.owner.clearReserved']}</button>
        {/if}
      {/if}

      <!-- Als verkauft markieren -->
      {#if showSoldButton}
        <button
          class="owner-btn owner-btn--outline"
          onclick={() => handleStatusChange('sold')}
          disabled={busy}
        >{$t['market.owner.markSold']}</button>
      {/if}

      <!-- Verkauft rückgängig: sold→available un-mark. Without this a sold
           listing has NO status control (reserve + sold toggles both hide on
           sold), so the owner could never re-list, edit, or delete it. -->
      {#if listing.status === 'sold'}
        <button
          class="owner-btn owner-btn--outline"
          onclick={() => handleStatusChange('available')}
          disabled={busy}
        >{$t['market.owner.clearSold']}</button>
      {/if}

    </div>
    <!-- END 2×2 grid -->

    <!-- ─── Footer: last-bump info + delete link ─────────────────────────── -->
    <div class="owner-footer">
      {#if lastBumpLabel}
        <span class="owner-last-bump">{lastBumpLabel}</span>
      {:else}
        <span></span>
      {/if}

      <button
        class="owner-delete-link"
        onclick={handleDelete}
        disabled={busy}
      >{$t['market.owner.delete']}</button>
    </div>

  {/if}

</div>

<style>
  .owner-actions-panel {
    background: var(--k-paper-soft, #ede8db);
    border: 1.5px solid var(--k-ink, #1a1a18);
    border-radius: var(--k-radius-md, 8px);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* ─── Header ──────────────────────────────────────────────── */
  .owner-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .owner-kicker {
    font-family: var(--k-font-mono, 'DM Mono', monospace);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--k-wine, #b23a5b);
    text-transform: uppercase;
  }

  .owner-stats {
    font-family: var(--k-font-mono, 'DM Mono', monospace);
    font-size: 10px;
    color: var(--k-ink-mute, #8a8580);
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  /* ─── 2×2 grid ────────────────────────────────────────────── */
  .owner-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  /* ─── Button base ─────────────────────────────────────────── */
  .owner-btn {
    font-family: var(--k-font-mono, 'DM Mono', monospace);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: lowercase;
    border-radius: var(--k-radius-sm, 4px);
    padding: 7px 10px;
    cursor: pointer;
    text-align: center;
    transition: opacity 120ms ease, box-shadow 120ms ease;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1.2;
  }

  .owner-btn--primary {
    background: var(--k-wine, #b23a5b);
    color: var(--k-paper, #f7f1e3);
    border: 1.5px solid var(--k-ink, #1a1a18);
    box-shadow: 2px 2px 0 var(--k-ink, #1a1a18);
  }

  .owner-btn--primary:hover {
    box-shadow: 1px 1px 0 var(--k-ink, #1a1a18);
    opacity: 0.92;
  }

  .owner-btn--outline {
    background: transparent;
    color: var(--k-ink, #1a1a18);
    border: 1.5px solid var(--k-ink, #1a1a18);
    box-shadow: 1px 1px 0 var(--k-ink, #1a1a18);
  }

  .owner-btn--outline:hover:not(:disabled) {
    background: var(--k-paper-warm, #f3ead8);
  }

  .owner-btn:disabled,
  .owner-btn[aria-disabled='true'] {
    opacity: 0.4;
    cursor: not-allowed;
    box-shadow: none;
    pointer-events: none;
  }

  /* Re-enable pointer-events on disabled bump so title tooltip works */
  .owner-btn[aria-disabled='true'] {
    pointer-events: auto;
    cursor: not-allowed;
  }

  /* ─── Footer ──────────────────────────────────────────────── */
  .owner-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 6px;
    border-top: 1px dashed var(--k-rule, #c8c2b6);
  }

  .owner-last-bump {
    font-family: var(--k-font-mono, 'DM Mono', monospace);
    font-size: 10px;
    color: var(--k-ink-mute, #8a8580);
    letter-spacing: 0.03em;
  }

  .owner-delete-link {
    background: transparent;
    color: var(--k-danger, #c0392b);
    border: none;
    font-family: var(--k-font-mono, 'DM Mono', monospace);
    font-size: 11px;
    font-weight: 600;
    text-decoration: underline;
    text-decoration-style: dashed;
    text-underline-offset: 3px;
    letter-spacing: 0.05em;
    cursor: pointer;
    padding: 0;
  }

  .owner-delete-link:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
