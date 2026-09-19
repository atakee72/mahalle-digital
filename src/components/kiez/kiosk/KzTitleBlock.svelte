<script lang="ts">
  // Title block — moss kicker + carved H1 ("Der Kiez, gemessen") + serif dek
  // + mono fact row, paired with the "Zahl der Woche" stamp card (right
  // column) that rotates through a fixed menu of derivable weekly figures
  // (src/lib/kiez/zdw.ts) and shares straight to a pre-filled forum topic
  // (plain link to /topics/create?prefill_title=&prefill_body=, no special
  // endpoint — ComposePageInner already reads those params synchronously).
  // §07 "Stand veraltet" warn line renders beneath the header when `isStale`.
  // Design source: kiosk-kiezdaten.jsx:183-221 (KZTitle),
  // kiosk-kiezdaten-states.jsx:137-150 (§07), kiosk-kiezdaten-novel.jsx:108-143 (share flow).

  import { t, tStr, locale } from '../../../lib/kiosk-i18n';
  import { deriveZdw } from '../../../lib/kiez/zdw';
  import type { KiezVM } from '../../../lib/kiez/kiezViewModel';
  import type { AirHistoryResponse } from '../../../types/kiezStats';

  let { vm, history, isStale }: { vm: KiezVM; history: AirHistoryResponse | null; isStale: boolean } = $props();

  const area = $derived(vm.areas[0]);
  const kicker = $derived(tStr($t['kiez.kicker'], { stand: vm.stand }));
  const popLabel = $derived(area.pop.toLocaleString($locale === 'de' ? 'de-DE' : 'en-GB'));
  const dek = $derived(tStr($t['kiez.dek'], { pop: popLabel }));

  // Zahl der Woche — hidden entirely when every menu figure is underivable.
  const zdw = $derived(deriveZdw(vm, history, new Date()));
  const displayValue = $derived(zdw ? ($locale === 'de' ? zdw.value : zdw.value.replace(',', '.')) : '');
  const readingLine = $derived(zdw ? tStr($t[`kiez.zdw.read.${zdw.figureKey}` as const], zdw.varsForText) : '');

  const pageUrl = $derived(typeof window !== 'undefined' ? `${window.location.origin}/schillerkiez` : '/schillerkiez');
  const shareHref = $derived(
    zdw
      ? `/topics/create?prefill_title=${encodeURIComponent(
          tStr($t['kiez.zdw.shareTitle'], { kw: String(zdw.kw), value: displayValue })
        )}&prefill_body=${encodeURIComponent(tStr($t['kiez.zdw.shareBody'], { stand: vm.stand, url: pageUrl }))}`
      : '#'
  );
</script>

<section class="px-4 md:px-5 py-5 lg:px-9 lg:pt-6 lg:pb-5 border-b border-dashed border-rule">
  <div class="grid gap-6 lg:gap-7 lg:grid-cols-[1fr_330px] items-start">
    <div class="min-w-0">
      <div class="font-dmmono text-[11px] uppercase tracking-[0.14em]" style="color: var(--k-accent, var(--k-moss));">
        {kicker}
      </div>
      <h1
        class="font-bricolage font-extrabold text-ink leading-[0.95] mt-1.5 text-[36px] lg:text-[56px]"
        style="letter-spacing: -0.035em;"
      >
        {$t['kiez.title.pre']}<span class="font-instrument italic font-normal" style="color: var(--k-accent, var(--k-moss));">{$t['kiez.title.italic']}</span>
      </h1>
      <p class="font-instrument italic text-[15px] lg:text-[17px] text-ink-soft mt-2 max-w-[620px]">
        {dek}
      </p>
      <div class="flex flex-wrap gap-4 mt-3 font-dmmono text-[11px] text-ink-mute">
        <span><b class="text-ink">{popLabel}</b> {$t['kiez.fact.residents']}</span>
        <span><b class="text-ink">4</b> {$t['kiez.fact.areas']}</span>
        <span><b class="text-ink">{$t['kiez.fact.syncRate']}</b> {$t['kiez.fact.sync']}</span>
      </div>
    </div>

    {#if zdw}
      <div class="kz-zdw-in min-w-0 border-2 border-ink rounded-2xl bg-paper-warm shadow-[3px_3px_0_var(--k-ink)] px-5 py-4">
        <div class="flex items-center justify-between font-dmmono text-[9.5px] uppercase tracking-[0.14em] text-ink-mute">
          <span class="font-semibold" style="color: var(--k-accent, var(--k-moss));">{$t['kiez.zdw.label']}</span>
          <span>{tStr($t['kiez.zdw.kw'], { kw: String(zdw.kw) })}</span>
        </div>
        <div class="font-dmmono font-medium text-[40px] lg:text-[44px] leading-none tracking-tight mt-2 mb-0.5 text-ink">
          {displayValue}
        </div>
        <p class="text-[13.5px] lg:text-[14px] leading-snug text-ink-soft">{readingLine}</p>
        <div class="mt-2.5 pt-2.5 border-t border-dashed border-rule">
          <!-- kiosk-tap: inline link, so the invisible pseudo-extender lifts the
               hit area to 48px on touch viewports without moving the text. -->
          <a href={shareHref} class="font-dmmono text-[11px] font-semibold inline-block kiosk-tap" style="color: var(--k-accent, var(--k-moss));">
            {$t['kiez.zdw.share']}
          </a>
        </div>
      </div>
    {/if}
  </div>

  {#if isStale}
    <div class="mt-4 flex items-start gap-3 rounded-md px-4 py-3 border-[1.5px]" style="border-color: var(--kz-grade-mid); background: #f5e7c8;">
      <span class="font-dmmono text-[16px]" style="color: var(--kz-grade-mid);">⚠</span>
      <div>
        <p class="text-[13.5px] font-bold text-ink">{tStr($t['kiez.state.stale.title'], { date: vm.stand })}</p>
        <p class="font-dmmono text-[10px] text-ink-mute mt-0.5">{$t['kiez.state.stale.hint']}</p>
      </div>
    </div>
  {/if}
</section>
