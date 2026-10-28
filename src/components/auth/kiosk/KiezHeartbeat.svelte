<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../../lib/kiosk-i18n';

  let { compact = false }: { compact?: boolean } = $props();

  // Ambient, not load-bearing: each stat resolves independently; any failure
  // leaves that stat null and its segment is simply omitted. Never throws,
  // never blocks paint, no spinner.
  let events = $state<number | null>(null);
  let posts = $state<number | null>(null);
  let air = $state<string | null>(null);

  // LQI grade → label (matches /api/kiez-air's GRADE_LABELS, grades 1–5).
  const AIR_LABELS: Record<number, string> = { 1: 'sehr gut', 2: 'gut', 3: 'mäßig', 4: 'schlecht', 5: 'sehr schlecht' };

  onMount(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const opts = { signal: ctrl.signal };

    // Single public aggregate fetch — same source as the landing strip.
    // Each segment still resolves independently: a missing row leaves its
    // stat null and the segment is omitted (ambient, never blocks paint).
    fetch('/api/kiez-heartbeat', opts)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!Array.isArray(d?.rows)) return;
        for (const row of d.rows) {
          if (row.kind === 'air' && !row.mute && typeof row.value === 'number') {
            air = AIR_LABELS[row.value] ?? null;
          }
          if (row.kind === 'forum' && typeof row.value === 'number') posts = row.value;
          if (row.kind === 'events' && typeof row.value === 'number') events = row.value;
        }
      })
      .catch(() => {});

    return () => { clearTimeout(timer); ctrl.abort(); };
  });
</script>

<div class="kh font-dmmono"
  style="--kh-gap:{compact ? '10px' : '16px'}; --kh-pad:{compact ? '7px 12px' : '9px 16px'};
         --kh-fs:{compact ? '10px' : '11px'}; --kh-live-fs:{compact ? '9px' : '10px'};">
  <span class="kh-seg kh-live">
    <span class="kh-dot">
      <span class="kh-ping"></span>
      <span class="kh-dot-core"></span>
    </span>
    {$t['auth.heartbeat.live']}
  </span>

  {#if events !== null}
    <span class="kh-seg">
      <span class="kh-rule"></span>
      <b>{events}</b> {events === 1 ? $t['auth.heartbeat.events.one'] : $t['auth.heartbeat.events']}
    </span>
  {/if}
  {#if posts !== null}
    <span class="kh-seg">
      <span class="kh-rule"></span>
      <b>{posts}</b> {posts === 1 ? $t['auth.heartbeat.posts.one'] : $t['auth.heartbeat.posts']}
    </span>
  {/if}
  {#if air !== null}
    <span class="kh-seg">
      <span class="kh-rule"></span>
      {$t['auth.heartbeat.air']}: <b>{air}</b>
    </span>
  {/if}
</div>

<style>
  .kh {
    display: inline-flex; align-items: center; gap: var(--kh-gap); padding: var(--kh-pad);
    background: var(--k-paper-warm); border: 1.5px solid var(--k-ink); border-radius: 999px;
    box-shadow: 2px 2px 0 var(--k-ink); font-size: var(--kh-fs); color: var(--k-ink-soft);
  }
  /* A segment is one unit: its label never breaks mid-phrase. */
  .kh-seg { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
  .kh-seg b { color: var(--k-ink); font-weight: 700; }
  .kh-live { gap: 6px; color: var(--k-ink); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; font-size: var(--kh-live-fs); }
  .kh-dot { position: relative; width: 8px; height: 8px; }
  .kh-ping, .kh-dot-core { position: absolute; inset: 0; border-radius: 50%; background: var(--k-success); }
  .kh-rule { width: 1px; height: 12px; background: var(--k-rule); }
  /* Phones (2026-10-28): the pill is wider than the screen with three segments, so each
     label wrapped inside its segment („LIVE IM / KIEZ"). Let whole segments wrap onto a
     second centred line instead; the dividers would start a wrapped line, the gap separates. */
  @media (max-width: 639px) {
    .kh { flex-wrap: wrap; justify-content: center; row-gap: 4px; column-gap: 12px;
          max-width: calc(100vw - 32px); margin: 0 16px; padding: 7px 14px; font-size: 10px;
          border-radius: 18px; }
    .kh-live { font-size: 9px; }
    .kh-rule { display: none; }
  }
  @keyframes khPing { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.55); opacity: 0.35; } }
  .kh-ping { animation: khPing 1.8s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .kh-ping { animation: none; } }
</style>
