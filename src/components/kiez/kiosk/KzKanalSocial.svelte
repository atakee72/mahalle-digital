<script lang="ts">
  // Kanal 04 — Soziale Lage. 3-row horizontal bar chart (Arbeitslosenquote,
  // Kinderarmut, Transferleistungen) scaled to a 50% grid, numeric
  // Status-/Dynamik-Index footer with the MSS methodology footnote, and the
  // Anwohner-Kontext chip rows (Task 9 fills `kontext`, this task renders
  // them). `area.social === null` → §05 honest blank: keep the frame, no
  // bars, no zeros. Spec: kiosk-kiezdaten.jsx:434-483; §05: states :110-116.
  //
  // Adaptation from the desktop JSX: the ♨ thread-count text sits inline in
  // the combined SVG there, which is fiddly for real `<a>` chip links —
  // rendered instead as an HTML row under the (still combined) bar SVG,
  // mirroring the mobile JSX's per-row pattern (mobile lines 158-162).
  import { t, locale } from '../../../lib/kiosk-i18n';
  import type { KzAreaVM, KiezVM } from '../../../lib/kiez/kiezViewModel';
  import type { KiezKontext } from '../../../lib/kiez/kontextTypes';
  import type { Snippet } from 'svelte';
  import KzKanal from './KzKanal.svelte';
  import KzBar from './primitives/KzBar.svelte';

  let { area, vm, kontext = null, children }: {
    area: KzAreaVM;
    vm: KiezVM;
    kontext?: KiezKontext | null;
    children?: Snippet;
  } = $props();

  const fmtPct = (n: number) => ($locale === 'de' ? String(n).replace('.', ',') : String(n)) + ' %';
  const fmtIdx = (n: number) => ($locale === 'de' ? String(n).replace('.', ',') : String(n));

  type RowKey = 'alq' | 'ka' | 'tr';
  type KontextKey = keyof KiezKontext;

  const rows = $derived.by(() => {
    if (!area.social) return [] as { key: RowKey; kontextKey: KontextKey; label: string; v: number; color: string }[];
    return [
      { key: 'alq' as const, kontextKey: 'alq' as const, label: $t['kiez.k04.alq'], v: area.social.alq, color: 'var(--k-teal)' },
      { key: 'ka' as const, kontextKey: 'kinderarmut' as const, label: $t['kiez.k04.ka'], v: area.social.ka, color: 'var(--k-wine)' },
      { key: 'tr' as const, kontextKey: 'transfer' as const, label: $t['kiez.k04.tr'], v: area.social.tr, color: 'var(--k-ochre)' },
    ];
  });

  function barW(pct: number): number {
    return (pct / 50) * 820;
  }
</script>

{#snippet right()}
  {#if vm.socialPeriod}
    <div class="font-dmmono text-[10.5px] text-ink-mute">MSS {vm.socialPeriod}</div>
  {/if}
{/snippet}

<KzKanal nr="04" title={$t['kiez.k04.title']} area={area.name} {right}>
  {#if !area.social}
    <div class="rounded-2xl border-[1.5px] border-dashed border-rule px-6 py-6 text-center font-instrument text-[16px] italic text-ink-mute">
      {$t['kiez.k04.noData']}
    </div>
  {:else}
    <div class="rounded-2xl border-[1.5px] border-ink bg-paper-warm px-4 py-3.5 lg:px-[22px]">
      <svg viewBox="0 0 1130 150" class="w-full">
        {#each [0, 10, 20, 30, 40, 50] as p (p)}
          <g>
            <line x1={170 + (p / 50) * 820} x2={170 + (p / 50) * 820} y1={4} y2={130} stroke="var(--k-rule)" stroke-width="0.8" />
            <text x={170 + (p / 50) * 820} y="146" text-anchor="middle" font-family="var(--k-font-mono)" font-size="10" fill="var(--k-ink-mute)">{p}%</text>
          </g>
        {/each}
        <line x1={170} y1={2} x2={170} y2={130} stroke="var(--k-ink)" stroke-width="1.2" />
        {#each rows as r, i (r.key)}
          {@const w = barW(r.v)}
          {@const y = i * 42 + 8}
          <text x={160} y={y + 15} text-anchor="end" font-size="13" font-weight="600" fill="var(--k-ink)" font-family="var(--k-font-display)">{r.label}</text>
          <KzBar x={170} {y} {w} h={20} seed={i + 11} color={r.color} opacity={0.5} />
          <text x={178 + w} y={y + 15} font-family="var(--k-font-mono)" font-size="12" font-weight="500" fill="var(--k-ink)">{fmtPct(r.v)}</text>
        {/each}
      </svg>

      {#each rows as r (r.key)}
        {#if kontext && kontext[r.kontextKey].length}
          {@const chips = kontext[r.kontextKey]}
          <div class="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-dmmono text-[10.5px] font-medium text-moss">
            <span>
              ♨ {chips.length} {chips.length === 1 ? $t['kiez.k04.threads.one'] : $t['kiez.k04.threads.many']} →
            </span>
            {#each chips as chip (chip.id)}
              <a href={chip.href} class="kz-kontext-chip-in underline decoration-dotted underline-offset-2 hover:text-ink">{chip.title}</a>
            {/each}
          </div>
        {/if}
      {/each}

      <div class="mt-2 flex flex-wrap gap-4 border-t border-dashed border-rule pt-2.5 font-dmmono text-[10.5px] text-ink-soft">
        <span>{$t['kiez.k04.status']}: <b>{fmtIdx(area.social.status)}</b></span>
        <!-- Dynamik is a class (positiv/stabil/negativ), not a number; „–" until
             the social rows have been re-synced with the class-aware importer. -->
        <span>{$t['kiez.k04.dyn']}: <b>{area.social.dynClass ? $t[`kiez.k04.dyn.${area.social.dynClass}` as 'kiez.k04.dyn.stabil'] : '–'}</b></span>
        <span class="text-ink-mute">{$t['kiez.k04.mss']}</span>
      </div>

      {#if children}{@render children()}{/if}
    </div>
  {/if}
</KzKanal>
