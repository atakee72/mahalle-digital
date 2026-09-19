<script lang="ts">
  // Global PLR selector — riso map + chip row. `plr` is bound from
  // KiezPageInner and drives every Kanal downstream (Kanäle re-key on it,
  // not this component — the selector itself stays mounted so its own scroll
  // position / focus survive a selection change). Spec:
  // kiosk-kiezdaten.jsx:223-249 (KZSelector); mobile chip row is
  // re-specified per the Task 6 brief as a horizontally-scrolling row (not
  // flex-wrap like the static mobile mock) so all 5 chips stay reachable
  // without stacking tall on narrow screens.
  import { t, locale } from '../../../lib/kiosk-i18n';
  import { scrollFade } from '../../../lib/scrollFade';
  import { KZ_SERIES_COLORS } from '../../../lib/kiez/kiezViewModel';
  import type { KzAreaVM } from '../../../lib/kiez/kiezViewModel';
  import KzMap from './primitives/KzMap.svelte';

  let { areas, plr = $bindable('all') }: { areas: KzAreaVM[]; plr?: string } = $props();

  const fmtNum = (n: number) => n.toLocaleString($locale === 'de' ? 'de-DE' : 'en-GB');
  const accent = $derived(KZ_SERIES_COLORS[plr] ?? KZ_SERIES_COLORS.all);
</script>

<section data-tour="kiez-plr" class="flex items-center gap-4 border-b border-dashed border-rule px-4 md:px-9 py-3.5 lg:gap-[26px] lg:px-10 lg:py-[18px]">
  <div class="shrink-0 lg:hidden">
    <KzMap size={56} {accent} highlight={plr} />
  </div>
  <div class="hidden shrink-0 lg:block">
    <KzMap size={92} {accent} highlight={plr} />
  </div>

  <div class="min-w-0 flex-1">
    <div class="mb-2 font-dmmono text-[10px] uppercase tracking-[0.14em] text-ink-mute">
      {$t['kiez.selector.hint']}
    </div>
    <div
      use:scrollFade
      class="kiosk-scroll-fade no-scrollbar flex gap-2 overflow-x-auto py-1 lg:flex-wrap lg:overflow-visible lg:py-0"
    >
      {#each areas as a (a.code)}
        <button
          type="button"
          class="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border-[1.5px] border-ink px-3.5 py-[7px] text-[13px] font-semibold lg:min-h-0"
          class:bg-ink={a.code === plr}
          class:text-paper={a.code === plr}
          class:text-ink={a.code !== plr}
          aria-pressed={a.code === plr}
          onclick={() => (plr = a.code)}
        >
          <span
            class="h-[9px] w-[9px] rounded-[2px]"
            style={`background:${KZ_SERIES_COLORS[a.code] ?? KZ_SERIES_COLORS.all}; border:${a.code === plr ? 'none' : '1px solid var(--k-ink)'};`}
          ></span>
          <span class="lg:hidden">{a.code === 'all' ? $t['kiez.selector.total'] : a.short}</span>
          <span class="hidden lg:inline">{a.code === 'all' ? $t['kiez.selector.total'] : a.name}</span>
          <span class="font-dmmono text-[10px] opacity-65">{fmtNum(a.pop)}</span>
        </button>
      {/each}
    </div>
  </div>
</section>
