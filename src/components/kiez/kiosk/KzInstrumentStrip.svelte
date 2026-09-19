<script lang="ts">
  // Instrument strip — MESSSTATION NANSENSTRASSE · MC042. Independent source
  // from stats: mounted OUTSIDE the stats {#if} chain in KiezPageInner so a
  // silent BLUME (§04) never takes the rest of the page down with it.
  // Spec: kiosk-kiezdaten.jsx:127-181 (live + off), states.jsx:101-107 (§04
  // usage), :118-134 (§06 dashed gap-bar concept — this component ports that
  // concept onto its own 170×40 sparkline geometry, not the states.jsx
  // illustration's coordinates).
  import { t, locale, tStr } from '../../../lib/kiosk-i18n';
  import type { AirQualityResponse, AirHistoryResponse } from '../../../types/kiezStats';

  let { air, airStatus, history } = $props<{
    air: AirQualityResponse | null;
    airStatus: 'loading' | 'ready' | 'off';
    history: AirHistoryResponse | null;
  }>();

  const intlLocale = $derived($locale === 'de' ? 'de-DE' : 'en-GB');

  // Störung detection (2026-08 BLUME freeze): the live API can serve a 200
  // with an old measurement — a green LIVE badge next to a days-old
  // timestamp is a lie. Timestamp-based, never banner-scraping: catches
  // their outage, their API lying, and our proxy caching alike. BLUME
  // publishes hourly; 6h absorbs normal hiccups without flapping.
  const STALE_MS = 6 * 3_600_000;
  const isStale = $derived(
    !!air && Date.now() - Date.parse(air.datetime) > STALE_MS
  );

  // "13.07. · 11:00" (DE) / "13 Jul · 11:00" (EN) — mirrors the seed's
  // KZ_DATA.air.at strings, but computed from the real ISO timestamp.
  function formatAirTs(iso: string): string {
    const d = new Date(iso);
    const dateFmt = new Intl.DateTimeFormat(intlLocale, {
      day: '2-digit',
      month: $locale === 'de' ? '2-digit' : 'short',
      timeZone: 'Europe/Berlin',
    });
    const timeFmt = new Intl.DateTimeFormat(intlLocale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Europe/Berlin',
    });
    return `${dateFmt.format(d)} · ${timeFmt.format(d)}`;
  }

  function weekdayLabel(day: string, isToday: boolean): string {
    if (isToday) return $t['kiez.strip.today'];
    const d = new Date(`${day}T00:00:00Z`); // Berlin is always ahead of UTC — same calendar day
    return new Intl.DateTimeFormat(intlLocale, { weekday: 'short', timeZone: 'Europe/Berlin' }).format(d);
  }

  // Grade ramp (Task 2 tokens, [data-page="schillerkiez"] scope): ≤2 good, 3 mid, ≥4 bad.
  function gradeColor(grade: number | null): string {
    if (grade === null) return 'var(--k-paper)';
    return grade <= 2 ? 'var(--kz-grade-good-on-ink)' : grade === 3 ? 'var(--kz-grade-mid-on-ink)' : 'var(--kz-grade-bad-on-ink)';
  }

  const hasGap = $derived(!!history?.days.some((d: AirHistoryResponse['days'][number]) => d.lqiMax === null));

  // Dashed gap-bar placeholder geometry (§06 concept, ported onto this strip's
  // own 24px-pitch / 40px-tall sparkline — no real value exists, so height is
  // a fixed mid-scale outline, never interpolated from neighbours.
  const GAP_H = 22;
  const GAP_Y = 40 - GAP_H;

  const wrapClass = 'flex flex-wrap items-center gap-3.5 lg:flex-nowrap lg:gap-6';
  const padClass = 'px-4 md:px-[18px] py-3 lg:px-9 lg:py-3.5'; // 16px on phones = the shared page inset (was 18, the title below it 20)
  const leftClass = 'w-full lg:w-auto lg:min-w-[300px]';
  const rightClass = 'text-right lg:ml-auto';
  const tileClass =
    'min-w-[58px] rounded-[var(--k-radius-md)] px-[9px] py-[5px] text-center lg:min-w-[74px] lg:px-[13px] lg:py-[7px]';
  const gradeTextClass = 'font-dmmono text-[16px] font-medium lg:text-[20px]';

  // Grade words come from the dictionary, not the API's German
  // `gradeLabel`/`overallLabel` (audit 2026-09-09: EN locale showed „gut").
  function gradeLabel(grade: number | null): string {
    if (grade == null || grade < 1 || grade > 5) return $t['kiez.air.grade.none'];
    return $t[`kiez.air.grade.${grade}` as 'kiez.air.grade.1'];
  }
  const headlineLiveClass = 'mt-0.5 text-[18px] font-extrabold lg:text-[24px]';
  const headlineOffClass = 'mt-0.5 text-[17px] font-extrabold opacity-75 lg:text-[22px]';
  // viewBox is 170×52: top 40px is the bar field (spec geometry, untouched),
  // bottom 12px carries the weekday letters (brief addition, not in the seed jsx).
  const svgClass = 'h-10 w-[130px] lg:h-[52px] lg:w-[170px]';
</script>

<div class="bg-[var(--k-ink)] text-[var(--k-paper)]">
  {#if airStatus === 'loading'}
    <!-- §01 mirrored for the strip's own frame: dark skeleton, own loading source. -->
    <div class="{wrapClass} {padClass}" aria-hidden="true">
      <div class="kz-skel h-[14px] w-[140px] rounded opacity-25"></div>
      <div class="flex gap-2">
        {#each [0, 1, 2, 3] as i (i)}
          <div class="kz-skel h-[30px] w-11 rounded opacity-25"></div>
        {/each}
      </div>
    </div>
  {:else if airStatus === 'off'}
    <div class="{wrapClass} {padClass}">
      <div class="{leftClass}">
        <div class="flex items-center gap-[7px] font-dmmono text-[10px] uppercase tracking-[0.18em] text-[var(--k-ochre)]">
          <span class="inline-block h-[7px] w-[7px] rounded-full bg-[var(--k-ink-mute)]"></span>
          {$t['kiez.strip.station']} · {$t['kiez.strip.noSignal']}
        </div>
        <div class="{headlineOffClass}">{$t['kiez.strip.offTitle']}</div>
      </div>
      <div class="{rightClass}">
        <div class="font-dmmono text-[10px] leading-relaxed opacity-65">
          {#if history?.lastReading}
            {tStr($t['kiez.strip.lastReading'], { ts: formatAirTs(history.lastReading.ts), lqi: history.lastReading.lqi })}<br />
          {/if}
          {$t['kiez.strip.offNote']}
        </div>
      </div>
    </div>
  {:else if air}
    <div class="{wrapClass} {padClass}">
      <div class="{leftClass}">
        <div class="flex items-center gap-[7px] font-dmmono text-[10px] uppercase tracking-[0.18em] text-[var(--k-ochre)]">
          <span
            class="inline-block h-[7px] w-[7px] rounded-full {isStale ? 'bg-[var(--k-ink-mute)]' : 'kz-live-dot bg-[var(--k-success)]'}"
          ></span>
          {$t['kiez.strip.station']} · {isStale ? $t['kiez.strip.disrupted'] : $t['kiez.strip.live']}
        </div>
        <div class="{headlineLiveClass}">
          {$t['kiez.strip.airQuality']}: <span style={`color:${gradeColor(air.overallGrade)}`}>{air.overallGrade} · {gradeLabel(air.overallGrade)}</span>
          <span class="ml-3 font-dmmono text-[10px] font-normal opacity-60">{formatAirTs(air.datetime)}</span>
        </div>
        {#if isStale}
          <div class="mt-1 max-w-[420px] font-dmmono text-[10px] leading-relaxed text-[var(--k-ochre)]">
            {tStr($t['kiez.strip.staleNote'], { ts: formatAirTs(air.datetime) })}
          </div>
        {/if}
      </div>

      <div class="flex gap-2">
        {#each air.pollutants as p (p.component)}
          <div class="{tileClass} border-[1.5px] border-[rgba(243,234,216,0.3)]" class:opacity-55={p.grade === null}>
            <div class="font-dmmono text-[9.5px] opacity-65">{p.name}</div>
            <div class="{gradeTextClass}" style={`color:${gradeColor(p.grade)}`}>{p.grade ?? '–'}</div>
            <div class="hidden font-dmmono text-[8.5px] opacity-70 lg:block">{gradeLabel(p.grade)}</div>
          </div>
        {/each}
      </div>

      {#if history}
        <div class="{rightClass}">
          <svg viewBox="0 0 170 52" class="{svgClass}" aria-hidden="true">
            {#each history.days as day, i (day.day)}
              {@const isToday = i === history.days.length - 1}
              {#if day.lqiMax !== null}
                <!-- Bar height scales to the 40px field as lqiMax/5, not the JSX's
                     raw grade*11 — that formula overflows the field at grades 4–5
                     (44px/55px), clipping the two worst air readings identically.
                     The JSX's seed data never exceeded grade 3 so it never surfaced
                     there; scaling to the field is the honest fix here. -->
                {@const h = (day.lqiMax / 5) * 40}
                <rect
                  x={i * 24}
                  y={40 - h}
                  width="16"
                  height={h}
                  rx="2"
                  fill={gradeColor(day.lqiMax)}
                  opacity={isToday ? 1 : 0.55}
                />
              {:else}
                <rect
                  x={i * 24}
                  y={GAP_Y}
                  width="16"
                  height={GAP_H}
                  rx="3"
                  fill="none"
                  stroke="rgba(243,234,216,0.35)"
                  stroke-width="1.2"
                  stroke-dasharray="3 3"
                />
              {/if}
              <text
                x={i * 24 + 8}
                y="50"
                text-anchor="middle"
                font-family="var(--k-font-mono)"
                font-size="7"
                fill="var(--k-paper)"
                opacity="0.6"
              >{weekdayLabel(day.day, isToday)}</text>
            {/each}
          </svg>
          <div class="font-dmmono text-[8.5px] tracking-[0.1em] opacity-60">{$t['kiez.strip.week']}</div>
          {#if hasGap}
            <div class="font-dmmono text-[8.5px] leading-snug opacity-60">{$t['kiez.strip.gap']}</div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
