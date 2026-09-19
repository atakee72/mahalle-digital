<script lang="ts">
  // Loading skeleton — §01 of the state matrix.
  // 6 cards in a 3-col grid. Each card uses `.market-skeleton` for the
  // ::after shimmer animation defined in motion-marketplace.css.
  // No props — rendered when loading && data.items.length === 0 (first paint).
</script>

<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 px-4 md:px-5 lg:px-9 py-6" aria-hidden="true">
  {#each Array(6) as _, i (i)}
    <div
      class="market-skeleton"
      style="
        background: var(--k-paper-warm);
        border: var(--k-border-ink);
        border-radius: var(--k-radius-md);
        min-height: 280px;
        overflow: hidden;
        position: relative;
      "
    >
      <!-- Image placeholder -->
      <div
        style="
          aspect-ratio: 4/3;
          background: color-mix(in srgb, var(--k-rule) 40%, transparent);
          border-radius: var(--k-radius-sm);
          margin: 8px;
        "
      ></div>

      <!-- Text lines -->
      <div style="padding: 0 12px 12px; display: flex; flex-direction: column; gap: 8px;">
        <div
          style="
            height: 8px;
            width: 70%;
            background: color-mix(in srgb, var(--k-rule) 40%, transparent);
            border-radius: 4px;
          "
        ></div>
        <div
          style="
            height: 8px;
            width: 45%;
            background: color-mix(in srgb, var(--k-rule) 30%, transparent);
            border-radius: 4px;
          "
        ></div>
      </div>
    </div>
  {/each}
</div>
