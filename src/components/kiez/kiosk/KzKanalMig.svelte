<script lang="ts">
  // Kanal 03 — Vielfalt. Double-struck donut (3 non-overlapping migration
  // segments) + legend with non-overlap caption, plus a Zeitverlauf line
  // chart that is ALWAYS Gesamt data (never filtered by the PLR selection —
  // matches K01's small-multiples panel in spirit). `area.mig === null` skips
  // the donut card but keeps the Kanal frame. Spec: kiosk-kiezdaten.jsx:361-431.
  import { t, locale } from '../../../lib/kiosk-i18n';
  import { KZ_SERIES_COLORS } from '../../../lib/kiez/kiezViewModel';
  import type { KzAreaVM, KiezVM } from '../../../lib/kiez/kiezViewModel';
  import KzKanal from './KzKanal.svelte';
  import KzDonut from './primitives/KzDonut.svelte';
  import KzGrid from './primitives/KzGrid.svelte';
  import KzLine from './primitives/KzLine.svelte';
  import { trendXs } from '../../../lib/kiez/trendAxis';
  import KzMap from './primitives/KzMap.svelte';

  let { area, vm }: { area: KzAreaVM; vm: KiezVM } = $props();

  const color = $derived(KZ_SERIES_COLORS[area.code] ?? KZ_SERIES_COLORS.all);

  const fmtPct = (n: number) => ($locale === 'de' ? String(n).replace('.', ',') : String(n)) + ' %';

  const legs = $derived.by(() => {
    if (!area.mig) return [];
    return [
      { key: 'a', l: $t['kiez.k03.foreign'], v: area.mig.a, c: 'var(--k-teal)' },
      { key: 'mh', l: $t['kiez.k03.germanMig'], v: area.mig.mh, c: 'var(--k-wine)' },
      { key: 'o', l: $t['kiez.k03.noMig'], v: area.mig.o, c: 'var(--k-ochre)' },
    ];
  });

  const trendSeries: { key: 'a' | 'mh' | 'o'; color: string }[] = [
    { key: 'a', color: 'var(--k-teal)' },
    { key: 'mh', color: 'var(--k-wine)' },
    { key: 'o', color: 'var(--k-ochre)' },
  ];

  // Time-true x positions — same rule and reason as KzKanalPop (trendAxis.ts).
  const divXs = $derived(trendXs(vm.divTrend.map((d) => d.t), 64, 584));

  function toY(v: number): number {
    return 108 - ((v - 18) / 30) * 88;
  }

  const trendPts = $derived(
    trendSeries.map((s) => vm.divTrend.map((d, i) => [divXs[i], toY(d[s.key])] as [number, number]))
  );

  const showTrend = $derived(vm.divTrend.length >= 2);
</script>

{#snippet right()}
  <KzMap size={40} accent={color} highlight={area.code} />
{/snippet}

<KzKanal nr="03" title={$t['kiez.k03.title']} area={area.name} {right}>
  <div class="grid grid-cols-1 gap-4 lg:grid-cols-[440px_1fr] lg:gap-[22px]">
    {#if area.mig}
      <!-- Donut above the legend on phones (a 148px donut left a ~140px
           legend column at 375px — the three-line labels pushed the
           percentages off the card), side by side from `sm` up. -->
      <div class="flex flex-col items-stretch gap-4 rounded-2xl border-[1.5px] border-ink bg-paper-warm px-4 py-3.5 sm:flex-row sm:items-center sm:gap-5 lg:px-5">
        <div class="self-center"><KzDonut segs={legs.map((s) => ({ v: s.v, c: s.c }))} /></div>
        <div class="min-w-0 flex-1">
          {#each legs as s (s.key)}
            <div class="flex items-baseline gap-2 border-b border-dashed border-rule py-1.5">
              <span class="h-2.5 w-2.5 shrink-0 rounded-sm border border-ink" style={`background:${s.c}`}></span>
              <span class="flex-1 text-[12.5px] leading-tight text-ink-soft">{s.l}</span>
              <span class="shrink-0 whitespace-nowrap font-dmmono text-[15px] font-medium text-ink">{fmtPct(s.v)}</span>
            </div>
          {/each}
          <div class="mt-2 font-dmmono text-[9px] text-ink-mute">{$t['kiez.k03.caption']}</div>
        </div>
      </div>
    {/if}

    {#if showTrend}
      <div class="rounded-2xl border-[1.5px] border-ink bg-paper-warm px-4 py-3 lg:px-[18px] {area.mig ? '' : 'lg:col-span-2'}">
        <div class="font-dmmono text-[9.5px] uppercase tracking-[0.14em] text-ink-mute">{$t['kiez.k03.overTime']}</div>
        <svg viewBox="0 0 620 140" class="mt-1 w-full">
          <KzGrid x1={36} x2={600} rows={3} top={22} step={38} />
          <line x1={36} y1={12} x2={36} y2={116} stroke="var(--k-ink)" stroke-width="1.1" />
          {#each trendSeries as s, si (s.key)}
            <KzLine pts={trendPts[si]} color={s.color} seed={si * 3 + 2} width={2} />
          {/each}
          {#each vm.divTrend as d, i (i)}
            <text x={divXs[i]} y="134" text-anchor="middle" font-family="var(--k-font-mono)" font-size="10" fill="var(--k-ink-mute)">{d.label}</text>
          {/each}
        </svg>
        {#if area.mig}
          <div class="mt-1 flex flex-wrap gap-3.5 font-dmmono text-[9.5px] text-ink-soft">
            {#each legs as s (s.key)}
              <span class="inline-flex items-center gap-1.5">
                <span class="inline-block h-[3px] w-3" style={`background:${s.c}`}></span>{fmtPct(s.v)}
              </span>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</KzKanal>
