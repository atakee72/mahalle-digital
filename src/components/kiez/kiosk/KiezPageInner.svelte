<script lang="ts">
  import { t } from '../../../lib/kiosk-i18n';
  import type { KiezStatsResponse, AirQualityResponse, AirHistoryResponse } from '../../../types/kiezStats';
  import type { KiezKontext } from '../../../lib/kiez/kontextTypes';
  import { buildKiezViewModel } from '../../../lib/kiez/kiezViewModel';
  import KzSkeleton from './KzSkeleton.svelte';
  import KzFooter from './KzFooter.svelte';
  import KzInstrumentStrip from './KzInstrumentStrip.svelte';
  import KzTitleBlock from './KzTitleBlock.svelte';
  import KzSelector from './KzSelector.svelte';
  import KzKanalPop from './KzKanalPop.svelte';
  import KzKanalAge from './KzKanalAge.svelte';
  import KzKanalMig from './KzKanalMig.svelte';
  import KzKanalSocial from './KzKanalSocial.svelte';
  import KzKanalSocTrend from './KzKanalSocTrend.svelte';
  import KzBerlinVergleich from './KzBerlinVergleich.svelte';

  let stats = $state<KiezStatsResponse | null>(null);
  let statsStatus = $state<'loading' | 'ready' | 'error'>('loading');
  let air = $state<AirQualityResponse | null>(null);
  let airStatus = $state<'loading' | 'ready' | 'off'>('loading');
  let history = $state<AirHistoryResponse | null>(null);
  let kontext = $state<KiezKontext | null>(null);
  let plr = $state('all');

  let seq = 0;
  let errorDetail = $state('');
  async function refetchStats() {
    const mySeq = ++seq;
    statsStatus = 'loading';
    try {
      const res = await fetch('/api/kiez-stats');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (mySeq !== seq) return;
      stats = body;
      statsStatus = 'ready';
    } catch (e) {
      if (mySeq !== seq) return;
      errorDetail = e instanceof Error && e.message.startsWith('HTTP') ? e.message : '';
      statsStatus = 'error';
    }
  }
  async function fetchAir() {
    try {
      const res = await fetch('/api/kiez-air');
      if (!res.ok) throw new Error('off');
      air = await res.json();
      airStatus = 'ready';
    } catch {
      airStatus = 'off'; // state §04 — the strip stays and says so
    }
  }
  async function fetchHistory() {
    try {
      const res = await fetch('/api/kiez-air-history');
      if (res.ok) history = await res.json();
    } catch { /* sparkline simply absent */ }
  }
  async function fetchKontext() {
    try {
      const res = await fetch('/api/kiez-kontext');
      if (res.ok) kontext = await res.json();
    } catch { /* chips simply absent */ }
  }

  let started = $state(false);
  $effect(() => {
    if (started) return;
    started = true;
    refetchStats();
    fetchAir();
    fetchHistory();
    fetchKontext();
  });

  const vm = $derived(stats?.demographics ? buildKiezViewModel(stats) : null);
  const isEmpty = $derived(statsStatus === 'ready' && !stats?.demographics);
  const isStale = $derived.by(() => {
    const d = stats?.lastUpdated;
    if (!d) return false;
    return Date.now() - new Date(d).getTime() > 8 * 30.44 * 24 * 3600 * 1000; // > 8 months
  });
</script>

<div class="mx-auto w-full max-w-[1280px]">
  <KzInstrumentStrip {air} {airStatus} {history} />

  {#if statsStatus === 'loading'}
    <KzSkeleton />
  {:else if statsStatus === 'error'}
    <section class="px-4 md:px-9 py-12 lg:px-10">
      <div class="rounded-lg border-[1.5px] border-dashed border-[var(--k-danger)] px-5 py-6 text-center">
        <p class="font-serif italic text-[17px] text-[var(--k-ink-soft)]">{$t['kiez.state.error.title']}</p>
        <p class="mt-1.5 font-dmmono text-[10px] text-[var(--k-ink-mute)]">{errorDetail || $t['kiez.state.error.network']} · /api/kiez-stats</p>
        <button
          class="mt-3 min-h-[44px] rounded-full bg-[var(--k-ink)] px-5 py-2 text-[13px] font-bold text-[var(--k-paper)]"
          onclick={refetchStats}
        >{$t['kiez.state.error.retry']}</button>
      </div>
    </section>
  {:else if isEmpty}
    <section class="px-4 md:px-9 py-12 lg:px-10">
      <div class="rounded-lg border-[1.5px] border-dashed border-[var(--k-rule)] px-5 py-6 text-center">
        <p class="font-serif italic text-[17px] text-[var(--k-ink-soft)]">{$t['kiez.state.empty.title']}</p>
        <p class="mt-2 text-[12.5px] leading-relaxed text-[var(--k-ink-mute)]">{$t['kiez.state.empty.body']}</p>
      </div>
    </section>
  {:else if vm}
    <KzTitleBlock {vm} {history} {isStale} />
    <!-- Selector stays mounted across selection changes (its own map/chips
         are already reactive on `plr`) — only the Kanäle below re-key so
         their draw-in animations replay per the motion spec. -->
    <KzSelector areas={vm.areas} bind:plr />
    {@const selectedArea = vm.areas.find((a) => a.code === plr) ?? vm.areas[0]}
    {#key plr}
      <div class="kz-swap-in">
        <KzKanalPop area={selectedArea} {vm} />
        <KzKanalAge area={selectedArea} {vm} />
        <KzKanalMig area={selectedArea} {vm} />
        <KzKanalSocial area={selectedArea} {vm} {plr} {kontext}>
          <!-- Berlin-Vergleich (novel §02) — Gesamt only, and only when a
               reference row exists for the latest MSS period with at least
               one non-null scope. Otherwise quietly absent, like the air
               strip. KzKanalSocial only renders `children` inside its own
               has-social-data branch, so `selectedArea.social` is also
               guaranteed non-null there — the extra check below narrows the
               type for `kiezSocial`. -->
          {#if plr === 'all' && stats?.reference && (stats.reference.berlin || stats.reference.neukoelln) && selectedArea.social}
            <KzBerlinVergleich reference={stats.reference} kiezSocial={selectedArea.social} />
          {/if}
        </KzKanalSocial>
        {#if plr === 'all' && vm.socTrend}
          <KzKanalSocTrend {vm} />
        {/if}
      </div>
    {/key}
  {/if}

  <KzFooter />
</div>
