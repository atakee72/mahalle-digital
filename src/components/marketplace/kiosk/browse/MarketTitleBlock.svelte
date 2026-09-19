<script lang="ts">
  // Marketplace browse page header — kicker + carved-italic display title +
  // stats row + new-listing CTA.
  //
  // Kicker format: MARKT · {WEEKDAY DAY. MONTH} — computed once at mount,
  // static for the session (no live clock needed).
  //
  // Headline uses `.kiosk-headline em` CSS rule (tokens.css) which auto-
  // applies var(--k-accent-italic) = ochre on [data-page="marketplace"].

  import { locale, t } from '../../../../lib/kiosk-i18n';
  import KioskBtn from '../../../forum/kiosk/KioskBtn.svelte';

  let {
    listingsCount = 0,
    newSinceYesterday = 0,
    freshCount = 0,
  }: {
    listingsCount?: number;
    newSinceYesterday?: number;
    freshCount?: number;
  } = $props();

  // Build kicker date string once at mount — no live clock.
  // Format: MARKT · MITTWOCH 20. MAI  (DE) / MARKT · WEDNESDAY 20. MAY (EN)
  function buildKicker(loc: 'de' | 'en'): string {
    const now = new Date();
    const weekday = new Intl.DateTimeFormat(loc === 'de' ? 'de-DE' : 'en-GB', {
      weekday: 'long',
    })
      .format(now)
      .toUpperCase();
    const day = now.getDate();
    const month = new Intl.DateTimeFormat(loc === 'de' ? 'de-DE' : 'en-GB', {
      month: 'long',
    })
      .format(now)
      .toUpperCase();
    return `MARKT · ${weekday} ${day}. ${month}`;
  }

  const kicker = $derived(buildKicker($locale));
</script>

<section
  class="px-4 md:px-5 py-5 lg:px-9 lg:py-[22px] lg:pb-[14px]"
  style="border-bottom: 1px dashed var(--k-rule);"
>
  <div
    style="display: grid; grid-template-columns: 1fr auto; gap: 20px; align-items: end;"
  >
    <!-- Left: kicker + headline + stats -->
    <div>
      <!-- Kicker — DM Mono, wine accent per page-accent rule -->
      <div
        class="font-dmmono text-[11px] uppercase tracking-[0.12em]"
        style="color: var(--k-accent, var(--k-wine));"
      >
        {kicker}
      </div>

      <!-- Display headline — 32px mobile / 56px desktop. Carved-italic verb
           in ochre via .kiosk-headline em CSS rule. -->
      <h1
        class="kiosk-headline font-bricolage font-extrabold text-ink leading-[0.95] tracking-tight mt-1.5 text-[32px] lg:text-[56px]"
      >
        {$t['market.title.q1']}
        <em class="font-instrument font-normal">{$t['market.title.q1.italic']}</em>
        {$t['market.title.q1.suffix']}
      </h1>

      <!-- Stats line — DM Mono 11px, inkMute labels / ink counts -->
      <div
        class="font-dmmono text-[11px] text-ink-mute mt-3 flex flex-wrap gap-x-4 gap-y-1"
      >
        <span>
          <b class="text-ink font-semibold">{listingsCount}</b>
          {$t['market.titlemeta.listings']}
        </span>
        <span>
          <b class="text-ink font-semibold">{newSinceYesterday}</b>
          {$t['market.titlemeta.new']}
        </span>
        <span class="flex items-center gap-1">
          <!-- Ochre dot -->
          <span
            class="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style="background: var(--k-ochre);"
            aria-hidden="true"
          ></span>
          <b class="text-ink font-semibold">{freshCount}</b>
          {$t['market.titlemeta.fresh']}
        </span>
      </div>
    </div>

    <!-- Right: CTA button -->
    <div class="hidden lg:block shrink-0" data-tour="markt-create">
      <KioskBtn href="/marketplace/create" variant="primary" size="md">
        {$t['market.cta.newListing']}
      </KioskBtn>
    </div>
  </div>
</section>
