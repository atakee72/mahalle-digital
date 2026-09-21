<script lang="ts">
  import { t, tStr } from '../../../../lib/kiosk-i18n';
  import KioskAvatar from '../../../forum/kiosk/KioskAvatar.svelte';

  let {
    sellerId,
    sellerName,
    sellerHandle,
    sellerImage,
    listingCount = 0,
    memberSince,
    isVerified = false,
    onReport,
  }: {
    sellerId: string;
    sellerName?: string | null;
    sellerHandle?: string | null;
    sellerImage?: string | null;
    listingCount?: number;
    memberSince?: string | null;
    isVerified?: boolean;
    onReport?: () => void;
  } = $props();

  // Derive "seit {year}" string — use memberSince if provided, otherwise skip the line.
  const sinceLabel = $derived(
    memberSince
      ? tStr($t['market.seller.since'], { year: memberSince })
      : null
  );

  const listingsLabel = $derived(
    listingCount > 0
      ? tStr($t['market.seller.nListings'], { n: listingCount })
      : null
  );

  const metaLine = $derived(
    [sellerHandle ? `@${sellerHandle}` : null, sinceLabel, listingsLabel].filter(Boolean).join(' · ') || null
  );

  const viewProfileLabel = $derived(
    tStr($t['profile.public.viewprofile'], { name: sellerName ?? '' })
  );
</script>

<div
  style="
    background: var(--k-paper-warm);
    border: 1.5px solid var(--k-ink);
    border-radius: var(--k-radius-md);
    padding: 14px 16px;
    display: flex; flex-direction: column; gap: 8px;
  "
>
  <!-- Kicker -->
  <div
    style="
      font-family: var(--k-font-mono); font-size: 10px;
      color: var(--k-wine); letter-spacing: 0.12em; font-weight: 600;
    "
  >◆ {$t['market.seller.header']}</div>

  <!-- Avatar + name row -->
  <div style="display: flex; align-items: center; gap: 10px;">
    <div style="flex-shrink: 0; width: 48px; height: 48px;">
      <KioskAvatar
        name={sellerName ?? '?'}
        image={sellerImage ?? null}
        size="lg"
      />
    </div>
    <div style="flex: 1; min-width: 0;">
      {#if sellerId}
        <a
          href={`/nachbarn/id/${sellerId}`}
          aria-label={viewProfileLabel}
          class="hover:underline underline-offset-2"
          style="
            display: block;
            font-family: var(--k-font-display); font-size: 16px; font-weight: 700;
            letter-spacing: -0.01em; color: var(--k-ink);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          "
        >{sellerName ?? '—'}</a>
      {:else}
        <div
          style="
            font-family: var(--k-font-display); font-size: 16px; font-weight: 700;
            letter-spacing: -0.01em; color: var(--k-ink);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          "
        >{sellerName ?? '—'}</div>
      {/if}
      {#if metaLine}
        <div
          style="
            font-family: var(--k-font-mono); font-size: 10px;
            color: var(--k-ink-mute); letter-spacing: 0.03em; margin-top: 2px;
          "
        >{metaLine}</div>
      {/if}
    </div>
  </div>

  <!-- Badges row -->
  <div style="display: flex; gap: 6px; flex-wrap: wrap;">
    {#if isVerified}
      <span
        style="
          font-family: var(--k-font-mono); font-size: 10px; font-weight: 600;
          background: var(--k-moss); color: var(--k-paper);
          padding: 2px 7px; border-radius: var(--k-radius-sm);
          border: 1px solid var(--k-ink); letter-spacing: 0.08em;
        "
      >✓ {$t['market.seller.verified']}</span>
    {/if}
    <!-- Rating chip: repurposed as "★ N Anzeigen" since no rating data in v1 -->
    {#if listingCount > 0}
      <span
        style="
          font-family: var(--k-font-mono); font-size: 10px; font-weight: 600;
          background: var(--k-paper-soft, var(--k-paper)); color: var(--k-ink);
          padding: 2px 7px; border-radius: var(--k-radius-sm);
          border: 1px solid var(--k-rule); letter-spacing: 0.08em;
        "
      >★ {listingCount}</span>
    {/if}
  </div>

  <!-- Footer: more listings + report -->
  <div
    style="
      display: flex; justify-content: space-between; padding-top: 6px;
      border-top: 1px dashed var(--k-rule);
    "
  >
    <a
      href="/marketplace?seller={sellerId}"
      style="
        font-family: var(--k-font-mono); font-size: 11px;
        color: var(--k-ink-soft, var(--k-ink)); cursor: pointer;
        text-decoration: none;
      "
    >{$t['market.seller.moreListings']}</a>
    {#if onReport}
    <button
      onclick={onReport}
      style="
        font-family: var(--k-font-mono); font-size: 11px;
        color: var(--k-ink-mute); cursor: pointer;
        background: none; border: none; padding: 0;
      "
      type="button"
    >⚑ {$t['market.seller.report']}</button>
    {/if}
  </div>
</div>
