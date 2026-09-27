<script lang="ts">
  import { scrollFade } from '../../../lib/scrollFade';
  // Kiez-Chronik strip — compact derived tenure timeline. Sits above the
  // Archiv on the own profile (this task) AND, unmodified, on the public
  // profile (Plan B Task 4 reuses this exact component/prop contract).
  //
  // Design source: kiosk-profile.jsx (PChronikStrip, ~L330-351 — ink border,
  // radius-md, paperSoft bg, 14px/20px padding, dashed flex:1 connectors)
  // + kiosk-profile-novel.jsx (ChronikMilestone — dot color rules: FIRST
  // stop wine, `heute` ochre + profPulse, middle stops ink) + motion-profile.css
  // (profPulse keyframe / reduced-motion, ported verbatim to
  // src/styles/profile.css as `.prof-chronik-now`).
  //
  // Data contract: `ChronikData` (src/lib/profile/profileShared.ts, Task 1)
  // — ordered stops, max 5, `heute` always last. Labels/sub-labels are i18n
  // keys resolved HERE (`profile.chronik.stop.<kind>`), not resolver output
  // — keeps the derived-data layer free of copy. `heute`'s year-slot shows
  // the literal DE „heute“ / EN "today" (`profile.chronik.heute`) instead
  // of a date; the `dabei` stop shows the YEAR ONLY (not `MMM yyyy`), per
  // the strip anatomy.

  import { t, locale } from '../../../lib/kiosk-i18n';
  import type { ChronikData } from '../../../lib/profile/profileShared';

  let { chronik }: { chronik: ChronikData } = $props();

  const intlLocale = $derived($locale === 'de' ? 'de-DE' : 'en-GB');

  function yearOnly(iso: string | null): string {
    return iso ? String(new Date(iso).getFullYear()) : '—';
  }
  function monthYear(iso: string | null, loc: string): string {
    return iso ? new Intl.DateTimeFormat(loc, { month: 'short', year: 'numeric' }).format(new Date(iso)) : '—';
  }

  const rows = $derived(
    chronik.stops.map((stop, i) => ({
      stop,
      yearText:
        stop.kind === 'heute'
          ? $t['profile.chronik.heute']
          : stop.kind === 'dabei'
            ? yearOnly(stop.date)
            : monthYear(stop.date, intlLocale),
      label: $t[`profile.chronik.stop.${stop.kind}` as keyof typeof $t],
      // First stop (always `dabei` per the chronik.ts contract) = wine;
      // `heute` = ochre; every stop in between = ink.
      dotColor: i === 0 ? 'var(--k-wine)' : stop.kind === 'heute' ? 'var(--k-ochre)' : 'var(--k-ink)',
      pulse: stop.kind === 'heute' && stop.active === true,
    }))
  );
</script>

<div
  data-tour="profil-chronik"
  style="
    border: 1.5px solid var(--k-ink); border-radius: 12px; background: var(--k-paper-soft);
    padding: 14px 20px; display: flex; align-items: center; gap: 0;
  "
>
  <span
    class="font-dmmono"
    style="font-size: 9.5px; letter-spacing: 0.14em; color: var(--k-ink-mute); margin-right: 18px; flex-shrink: 0;"
  >{$t['profile.chronik.label']}</span>
  <!-- Phones: the stops overflow the 390 px card (user, 2026-09-28 01:51) —
       the row scrolls sideways with the shared edge fade; the dashed
       connectors keep a minimum length instead of collapsing. -->
  <div use:scrollFade class="kiosk-scroll-fade no-scrollbar" style="flex: 1; display: flex; align-items: center; min-width: 0; overflow-x: auto;">
    {#each rows as row, i (row.stop.kind)}
      {#if i > 0}
        <span style="flex: 1 0 24px; border-top: 1.5px dashed var(--k-rule); margin: 0 8px;"></span>
      {/if}
      <span style="display: flex; flex-direction: column; align-items: center; gap: 3px; flex-shrink: 0;">
        <span
          class={row.pulse ? 'prof-chronik-now' : ''}
          style="width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid var(--k-ink); background: {row.dotColor};"
        ></span>
        <span class="font-dmmono" style="font-size: 9.5px; font-weight: 600; white-space: nowrap;">{row.yearText}</span>
        <span class="font-dmmono" style="font-size: 8.5px; color: var(--k-ink-mute); white-space: nowrap;">{row.label}</span>
      </span>
    {/each}
  </div>
</div>
