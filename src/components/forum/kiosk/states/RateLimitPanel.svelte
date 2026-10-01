<script lang="ts">
  // Rate-limit panel — sandbox-only in 4b.
  //
  // The compose flow (which gates against this) lands in 5b; the panel
  // is built now so the design system shows the full state matrix and
  // 5b can drop it into the compose route without rebuilding it.
  //
  // The JSX (line 199) shows "5 BEITRÄGE / STUNDE" but our API enforces a
  // rolling 24 hours. The limit is per bucket and per member (src/lib/limits/dailyLimit.ts); the panel prints the number the 429 carried.
  //
  // `unlocksIn`:
  //   string ("04:47:12") → render the countdown clock (sandbox / design-fidelity)
  //   null               → render the static "{n} today, come back tomorrow" body
  //                        (live surface — the API doesn't expose a real
  //                        retry-after timestamp, so a clock would lie)

  import { t, tStr } from '../../../../lib/kiosk-i18n';

  let { unlocksIn = '04:47:12' as string | null, limit = 5 } = $props<{
    unlocksIn?: string | null;
    /** The member's real daily limit, from the 429 (`RateLimitError.dailyLimit`). */
    limit?: number;
  }>();
</script>

<div
  class="my-10 mx-4 md:mx-auto max-w-2xl px-6 md:px-9 py-10 bg-ochre border-2 border-ink rounded-2xl shadow-[3px_3px_0_var(--k-ink)]"
>
  <p class="font-dmmono text-[11px] uppercase tracking-[0.15em] text-ink">
    {tStr($t['state.rate.kicker'], { n: limit })}
  </p>
  <h2 class="font-bricolage font-extrabold tracking-tight text-3xl md:text-[32px] text-ink mt-2 mb-2">
    {$t['state.rate.title']}
  </h2>
  <p class="text-[14.5px] leading-relaxed text-ink mb-5 max-w-lg">
    {unlocksIn === null ? tStr($t['state.rate.body.short'], { n: limit }) : tStr($t['state.rate.body'], { n: limit })}
  </p>
  {#if unlocksIn !== null}
    <div
      class="px-3.5 py-3 bg-paper border-2 border-ink rounded-md flex justify-between items-center"
    >
      <span class="font-dmmono text-[11px] uppercase tracking-[0.1em] text-ink">
        {$t['state.rate.unlocks']}
      </span>
      <span class="font-dmmono font-bold text-[28px] text-ink leading-none">
        {unlocksIn}
      </span>
    </div>
  {/if}
  <p class="font-instrument italic text-[14px] text-ink-soft mt-3.5">
    {$t['state.rate.coda']}
  </p>
</div>
