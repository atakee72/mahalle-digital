<script lang="ts">
  // Kanal 01 — Bevölkerung. Gauge card (EINWOHNER + gender + optional
  // Einpersonen-HH line) + trend line for the selected area (mix-hand
  // draw-in) + always-on 4-PLR small multiples (never filtered by the
  // selection — "NACH PLANUNGSRAUM" is a fixed comparison panel). Spec:
  // kiosk-kiezdaten.jsx:270-325 (KZKanalPop); mobile stacks gauge + trend
  // per kiosk-kiezdaten-mobile.jsx:97-112 — the small-multiples panel is
  // absent from that mock, so it's desktop-only here too.
  import { t, tStr, locale } from '../../../lib/kiosk-i18n';
  import { KZ_SERIES_COLORS } from '../../../lib/kiez/kiezViewModel';
  import type { KzAreaVM, KiezVM } from '../../../lib/kiez/kiezViewModel';
  import KzKanal from './KzKanal.svelte';
  import KzGrid from './primitives/KzGrid.svelte';
  import KzLine from './primitives/KzLine.svelte';
  import { trendXs } from '../../../lib/kiez/trendAxis';

  let { area, vm }: { area: KzAreaVM; vm: KiezVM } = $props();

  const fmtNum = (n: number) => n.toLocaleString($locale === 'de' ? 'de-DE' : 'en-GB');

  const color = $derived(KZ_SERIES_COLORS[area.code] ?? KZ_SERIES_COLORS.all);
  const overlay = $derived(vm.areas.filter((a) => a.code !== 'all'));

  // Points sit where their reference DATE is (trendXs), not at i/(n-1): the
  // imported editions are unevenly spaced (2022h1 + 2024h2 are missing), and
  // even spacing drew a full year as wide as a half year (fixed 2026-09-21).
  const mainXs = $derived(trendXs(area.trend.map((p) => p.t), 70, 830));

  const trendPts = $derived.by(() => {
    const trend = area.trend;
    if (!trend.length) return [] as [number, number][];
    const values = trend.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const toY = (v: number) => 118 - ((v - min) / span) * 82;
    return trend.map((p, i) => [mainXs[i], toY(p.value)] as [number, number]);
  });

  // "H2 '21" / "'21" → 2021, used only to build the "2021–2025" course range.
  function trendRange(trend: { label: string }[]): string {
    if (!trend.length) return '';
    const yearOf = (label: string) => {
      const m = label.match(/'(\d{2})/);
      return m ? 2000 + parseInt(m[1], 10) : null;
    };
    const first = yearOf(trend[0].label);
    const last = yearOf(trend[trend.length - 1].label);
    if (first === null || last === null) return '';
    return first === last ? String(first) : `${first}–${last}`;
  }
  const courseLabel = $derived(tStr($t['kiez.k01.course'], { range: trendRange(area.trend) }));

  function smallMultiplePts(a: KzAreaVM): [number, number][] {
    const trend = a.trend;
    if (!trend.length) return [];
    const values = trend.map((p) => p.value);
    const mn = Math.min(...values);
    const mx = Math.max(...values);
    const span = mx - mn || 1;
    const xs = trendXs(trend.map((p) => p.t), 8, 120);
    return trend.map((p, i) => [xs[i], 19 - ((p.value - mn) / span) * 14] as [number, number]);
  }
</script>

{#snippet right()}
  {#if area.delta !== null}
    <div class="font-dmmono text-[11px] text-moss">Δ {area.delta} / {area.deltaVsLabel}</div>
  {/if}
{/snippet}

<KzKanal nr="01" title={$t['kiez.k01.title']} area={area.name} {right}>
  <div class="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr_330px] lg:items-stretch lg:gap-[22px]">
    <!-- gauge -->
    <div class="rounded-2xl border-2 border-ink bg-paper-warm px-4 py-3.5 shadow-[2px_2px_0_var(--k-ink)]">
      <div class="font-dmmono text-[9.5px] uppercase tracking-[0.14em] text-ink-mute">{$t['kiez.k01.residents']}</div>
      <div class="mt-1 font-dmmono text-[34px] font-medium tracking-tight text-ink">{fmtNum(area.pop)}</div>
      <div class="mt-2 flex gap-3 font-dmmono text-[10.5px] text-ink-soft">
        <span>♂ {fmtNum(area.male)}</span><span>♀ {fmtNum(area.female)}</span>
      </div>
      {#if area.singlePerson > 0}
        <div class="mt-2.5 border-t border-dashed border-rule pt-2.5 font-dmmono text-[10px] leading-snug text-ink-mute">
          {fmtNum(area.singlePerson)} {$t['kiez.k01.singleHH']}
        </div>
      {/if}
    </div>

    <!-- trend -->
    <div class="rounded-2xl border-[1.5px] border-ink bg-paper-warm px-4 py-3 lg:px-[18px]">
      <div class="font-dmmono text-[9.5px] uppercase tracking-[0.14em] text-ink-mute">{courseLabel}</div>
      <svg viewBox="0 0 880 150" class="mt-1 w-full">
        <KzGrid x1={40} x2={860} rows={3} top={26} step={40} />
        <line x1={40} y1={16} x2={40} y2={126} stroke="var(--k-ink)" stroke-width="1.1" />
        {#if trendPts.length}
          <KzLine pts={trendPts} {color} seed={4} />
        {/if}
        {#each area.trend as p, i (i)}
          <text x={mainXs[i]} y="144" text-anchor="middle" font-family="var(--k-font-mono)" font-size="10.5" fill="var(--k-ink-mute)">{p.label}</text>
          <text x={mainXs[i]} y={trendPts[i][1] - 11} text-anchor="middle" font-family="var(--k-font-mono)" font-size="10.5" fill="var(--k-ink)" font-weight="500">{fmtNum(p.value)}</text>
        {/each}
      </svg>
    </div>

    <!-- per-PLR small multiples: always all 4 PLRs, desktop only -->
    <div class="hidden rounded-2xl border-[1.5px] border-ink bg-paper-warm px-[18px] py-3 lg:block">
      <div class="mb-2 font-dmmono text-[9.5px] uppercase tracking-[0.14em] text-ink-mute">{$t['kiez.k01.byArea']}</div>
      {#each overlay as a (a.code)}
        <div class="grid grid-cols-[84px_1fr_52px] items-center gap-2.5 py-1">
          <span class="font-dmmono text-[10px] text-ink-soft">{a.short}</span>
          <svg viewBox="0 0 130 24" class="w-full">
            <KzLine pts={smallMultiplePts(a)} color={KZ_SERIES_COLORS[a.code] ?? KZ_SERIES_COLORS.all} seed={6} width={1.8} dots={false} />
          </svg>
          <span class="text-right font-dmmono text-[10.5px] text-ink">{fmtNum(a.pop)}</span>
        </div>
      {/each}
    </div>
  </div>
</KzKanal>
