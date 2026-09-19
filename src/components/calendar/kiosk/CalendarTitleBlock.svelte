<script lang="ts">
  // Calendar page header — kicker + carved-italic display title + stats
  // row with the month stepper and new-event CTA on the right. The view
  // switcher / coachmark / Heute live on the category-rail row beneath
  // (see CalCategoryRail.svelte).

  import { format } from 'date-fns';
  import { de as deLocale, enUS } from 'date-fns/locale';
  import { t, locale } from '../../../lib/kiosk-i18n';
  import { now } from '../../../lib/calendar/nowTicker';

  type View = 'month' | 'agenda' | 'day';

  let {
    monthLabel = '',
    visibleMonthLabel = '',
    weekEvents = 0,
    weekRange = '',
    liveNow = 0,
    goingToday = 0,
    onPrevMonth,
    onNextMonth,
    view = 'month',
    onView,
    monthEvents = 0
  } = $props<{
    monthLabel?: string;
    visibleMonthLabel?: string;
    weekEvents?: number;
    weekRange?: string;
    liveNow?: number;
    goingToday?: number;
    onPrevMonth?: () => void;
    onNextMonth?: () => void;
    view?: View;
    onView?: (v: View) => void;
    /** Mobile hero only: visible-month event count. */
    monthEvents?: number;
  }>();

  // Mobile hero dateline — same derivation as mobile/CalendarMobileMonth so
  // the header reads identically in month, agenda and day view (2026-09-09:
  // agenda/day used to show the desktop kicker + stats with no title, and the
  // controls sat on the other side — user-reported).
  const dateLocale = $derived($locale === 'de' ? deLocale : enUS);
  // Two lengths: the forum-style full dateline („KALENDER · DONNERSTAG 30. SEPTEMBER · 21:54", 43 chars in
  // wide-tracked mono) needs ~400 px; below that the short month keeps the kicker on ONE line — a wrapped
  // kicker pushes the whole heading down a line (2026-09-19).
  const todayKicker = $derived(format($now, 'EEEE d. MMMM', { locale: dateLocale }).toUpperCase());
  const todayKickerShort = $derived(format($now, 'EEEE d. MMM', { locale: dateLocale }).toUpperCase());
  const timeNow = $derived(format($now, 'HH:mm'));

  const views: { k: View; label: () => string }[] = [
    { k: 'month',  label: () => $t['cal.view.month']  },
    { k: 'agenda', label: () => $t['cal.view.agenda'] },
    { k: 'day',    label: () => $t['cal.view.day']    }
  ];
</script>

<section
  class="px-4 md:px-9 lg:px-10 pt-5 lg:pt-6 pb-3 lg:pb-4 border-b border-dashed border-rule"
>
  <!-- ── Mobile hero (ALL views since 2026-09-09) — dateline kicker, title,
       stepper on the right, stats left + switcher right. CalendarMobileMonth
       no longer renders its own header/rail; this + CalCategoryRail are the
       single mobile chrome for month, agenda and day. ─────────────────── -->
  <div class="lg:hidden">
    <!-- Kicker + title follow the forum's heading exactly (11px / 0.18em / mb-2, title text-4xl md:text-5xl,
         no extra top margin): until 2026-09-19 this hero had drifted — 10px kicker without the section name,
         24px more air above a 40px title — and the calendar's top read differently from every other section. -->
    <div class="font-dmmono text-[11px] uppercase tracking-[0.18em] text-teal mb-2">
      {$t['cal.title.kicker']} · <span class="min-[410px]:hidden">{todayKickerShort}</span><span class="hidden min-[410px]:inline">{todayKicker}</span> · {timeNow}
    </div>
    <h1 class="font-bricolage font-extrabold text-ink leading-[0.95] tracking-tight text-4xl md:text-5xl">
      {$t['cal.title.q1']}
      <span class="font-instrument italic font-normal text-teal">{$t['cal.title.q2']}</span>
      {$t['cal.title.q3']}
    </h1>
    <div class="flex items-center justify-end gap-2 mt-4">
      <!-- data-tour anchors duplicate the desktop ones below; the tour engine takes the first VISIBLE match. -->
      <div data-tour="cal-month-nav" class="inline-flex items-center border-[1.5px] border-ink rounded-full font-dmmono text-[11px] font-semibold leading-none">
        <button
          type="button"
          onclick={onPrevMonth}
          aria-label={$t['cal.nav.prevMonth.aria']}
          class="relative rounded-l-full px-2.5 py-1 hover:bg-paper-warm transition-colors"
        >‹<span aria-hidden="true" style="position:absolute; inset:-18px -9px -7px;"></span></button>
        <span class="px-3 py-1 border-l-[1.5px] border-r-[1.5px] border-ink uppercase tracking-[0.05em]">
          {visibleMonthLabel}
        </span>
        <button
          type="button"
          onclick={onNextMonth}
          aria-label={$t['cal.nav.nextMonth.aria']}
          class="relative rounded-r-full px-2.5 py-1 hover:bg-paper-warm transition-colors"
        >›<span aria-hidden="true" style="position:absolute; inset:-18px -9px -7px;"></span></button>
      </div>
    </div>
    <div class="flex items-center justify-between gap-3 mt-3">
      <div class="font-dmmono text-[11px] text-ink-mute">
        <b class="text-ink">{monthEvents}</b> {$t['cal.mobile.statsMonthEvents']}
        {#if liveNow > 0}
          · <b class="text-ochre">{liveNow}</b> {$t['cal.mobile.statsLiveNow']}
        {/if}
      </div>
      <div
        data-tour="cal-view"
        class="inline-flex border-2 border-ink rounded-full font-dmmono text-[12px] font-semibold shrink-0"
        role="group"
        aria-label={$t['cal.view.switcher.aria']}
      >
        {#each views as v, i (v.k)}
          <button
            type="button"
            aria-pressed={view === v.k}
            onclick={() => onView?.(v.k)}
            class="relative px-3 py-1 transition-colors {
              view === v.k ? 'bg-ink text-paper' : 'bg-transparent text-ink hover:bg-paper-warm'
            } {i > 0 ? 'border-l-2 border-ink' : ''} {
              i === 0 ? 'rounded-l-full' : i === views.length - 1 ? 'rounded-r-full' : ''
            }"
          >
            {v.label()}
            <span aria-hidden="true" style="position:absolute; inset:-7px 0 -11px;"></span>
          </button>
        {/each}
      </div>
    </div>
  </div>

  <!-- ── Desktop header ──────────────────────────────────────────────────── -->
  <div class="hidden lg:block">
  <div class="font-dmmono text-[11px] uppercase tracking-[0.12em] text-teal">
    {$t['cal.title.kicker']}{#if monthLabel}{' · '}{monthLabel}{/if}
  </div>
  <h1
    class="hidden lg:block font-bricolage font-extrabold text-ink leading-[0.95] tracking-tight mt-1.5 text-[40px] md:text-[48px] lg:text-[56px]"
  >
    {$t['cal.title.q1']}
    <span class="font-instrument italic font-normal text-teal">
      {$t['cal.title.q2']}
    </span>
    {$t['cal.title.q3']}
  </h1>

  <div class="mt-4 lg:mt-2.5 flex flex-wrap items-end justify-between gap-x-5 gap-y-5 lg:gap-y-3">
    <div class="flex flex-wrap gap-x-4 gap-y-1 font-dmmono text-[11px] text-ink-mute">
      <span
        ><b class="text-ink">{weekEvents}</b>
        {$t['cal.stat.weekEvents']}{#if weekRange}<span class="opacity-70 ml-1"
            >· {weekRange}</span
          >{/if}</span
      >
      <span><b class="text-ochre">{liveNow}</b> {$t['cal.stat.liveNow']}</span>
      <span><b class="text-ink">{goingToday}</b> {$t['cal.stat.goingToday']}</span>
    </div>

    <!-- Right side of the stats row: month stepper · view switcher ·
         new-event CTA. Coachmark `?` + Heute still live on the
         category-rail row beneath (see CalCategoryRail). -->
    <!-- ml-auto + justify-end: on phones the stats row takes the full width and
         this control group wraps onto its own line(s) — keep it on the RIGHT,
         where the month view's own header (CalendarMobileMonth) puts the same
         controls, so they don't jump sides when switching views (2026-09-09). -->
    <div class="flex items-center flex-wrap justify-end gap-3 ml-auto">
      <!-- Month stepper — ‹ MAI 2026 › per CD's desktop header. -->
      <!-- No `overflow-hidden` here on purpose: it used to clip the pill's
           corners, but it also clipped the buttons' invisible hit-area
           extenders, so the enlarged tap targets silently did nothing
           (rects measured right, `elementFromPoint` still missed). The end
           buttons carry `rounded-l/r-full` instead, which reproduces the
           same clipped-corner look without a clipping container. -->
      <div
        data-tour="cal-month-nav"
        class="inline-flex items-center border-2 border-ink rounded-full font-dmmono text-[11px] font-semibold"
      >
        <button
          type="button"
          onclick={onPrevMonth}
          aria-label={$t['cal.nav.prevMonth.aria']}
          class="relative rounded-l-full px-2.5 py-1 leading-none hover:bg-paper-warm transition-colors"
        >
          ‹
          <span aria-hidden="true" style="position:absolute; inset:-16px -9px -9px;"></span>
        </button>
        <span
          class="px-3 py-1 border-l-2 border-r-2 border-ink uppercase tracking-[0.05em]"
        >
          {visibleMonthLabel}
        </span>
        <button
          type="button"
          onclick={onNextMonth}
          aria-label={$t['cal.nav.nextMonth.aria']}
          class="relative rounded-r-full px-2.5 py-1 leading-none hover:bg-paper-warm transition-colors"
        >
          ›
          <span aria-hidden="true" style="position:absolute; inset:-16px -9px -9px;"></span>
        </button>
      </div>

      <!-- View switcher — Monat / Agenda / Tag. Modelled as a group of
           toggle buttons (`aria-pressed`), not a tablist: these switch the
           calendar body in place, and there is no `role="tabpanel"` /
           `aria-controls` target nor roving-tabindex arrow navigation to
           back up tab semantics. Mirrors CalCategoryRail's pills. -->
      <div
        data-tour="cal-view"
        class="inline-flex border-2 border-ink rounded-full font-dmmono text-[11px] font-semibold shrink-0"
        role="group"
        aria-label={$t['cal.view.switcher.aria']}
      >
        {#each views as v, i (v.k)}
          <button
            type="button"
            aria-pressed={view === v.k}
            onclick={() => onView?.(v.k)}
            class="relative px-3 py-1 transition-colors {
              view === v.k ? 'bg-ink text-paper' : 'bg-transparent text-ink hover:bg-paper-warm'
            } {i > 0 ? 'border-l-2 border-ink' : ''} {
              i === 0 ? 'rounded-l-full' : i === views.length - 1 ? 'rounded-r-full' : ''
            }"
          >
            {v.label()}
            <!-- Vertical-only extender: the three buttons are flush
                 neighbours, so any horizontal growth would steal a
                 neighbour's tap zone. They are already ≥44px wide. -->
            <span aria-hidden="true" style="position:absolute; inset:-9px 0 -11px;"></span>
          </button>
        {/each}
      </div>

      <!-- New event CTA — ink fill + wine print shadow per CD's design.
           Hidden on mobile (`< lg`) since the floating FAB at the bottom
           right of `CalendarPageInner` handles new-event creation there. -->
      <a
        href="/events/create"
        class="hidden lg:inline-flex items-center px-6 py-2.5 rounded-full border-2 border-ink bg-ink text-paper font-bricolage font-semibold text-[13px] shadow-[3px_3px_0_var(--k-wine,#b23a5b)] hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_var(--k-wine,#b23a5b)] transition-[transform,box-shadow] duration-[120ms] ease-out"
      >
        {$t['cal.cta.newEvent']}
      </a>
    </div>
  </div>
  </div>
</section>
