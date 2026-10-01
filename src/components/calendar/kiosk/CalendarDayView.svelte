<script lang="ts">
  // Day view — single-day list of events. Reuses AgendaDayHeader +
  // AgendaRow so the visual treatment matches the agenda view.
  // Prev/next day nav at the bottom mirrors the month-grid footer.

  import { addDays, subDays, format, isToday as isTodayDate, isSameDay } from 'date-fns';
  import { de as deLocale, enUS } from 'date-fns/locale';

  import AgendaDayHeader from './AgendaDayHeader.svelte';
  import AgendaRow from './AgendaRow.svelte';
  import CalendarSidebar from './CalendarSidebar.svelte';

  import { eventCoversDay, isLiveNow } from '../../../lib/calendar/eventTime';
  import { now } from '../../../lib/calendar/nowTicker';
  import { swipeX } from '../../../lib/swipe';
  import { CATEGORIES } from '../../../lib/calendar/categories';
  import { t, locale } from '../../../lib/kiosk-i18n';
  import type { Event as EventDoc, EventCategory } from '../../../types';

  let {
    events = [],
    onPickEvent,
    savedIds = new Set<string>(),
    onToggleSave,
    currentUserId = null,
    initialDay,
    onDayChange
  } = $props<{
    events?: EventDoc[];
    onPickEvent?: (ev: EventDoc) => void;
    savedIds?: Set<string>;
    onToggleSave?: (eventId: string) => void;
    currentUserId?: string | null;
    initialDay?: Date;
    // Fired on every internal day step so the parent can keep the header
    // month stepper (and the events query range) in sync when the user
    // crosses a month boundary day-by-day.
    onDayChange?: (day: Date) => void;
  }>();

  let selectedDay = $state(initialDay ?? new Date());

  const dateLocale = $derived($locale === 'de' ? deLocale : enUS);
  const dayEvents = $derived(events.filter((ev) => eventCoversDay(ev, selectedDay)));

  function goPrev() {
    selectedDay = subDays(selectedDay, 1);
    onDayChange?.(selectedDay);
  }
  function goNext() {
    selectedDay = addDays(selectedDay, 1);
    onDayChange?.(selectedDay);
  }
  // Slide direction for the day swap (swipe, arrows, mini-calendar pick):
  // forward in time → the new list comes in from the right. `$effect.pre`
  // runs before the DOM flush, so the {#key}-remounted node wears the
  // class on mount. Null on first render = no animation.
  let swapDir = $state<'left' | 'right' | null>(null);
  let lastDayTs: number | null = null;
  $effect.pre(() => {
    const ts = selectedDay.getTime();
    if (lastDayTs !== null && ts !== lastDayTs) swapDir = ts > lastDayTs ? 'left' : 'right';
    lastDayTs = ts;
  });
  const isOnToday = $derived(isTodayDate(selectedDay));
  const liveCount = $derived(dayEvents.filter((e) => isLiveNow(e, $now)).length);
  const termLabel = $derived(
    dayEvents.length === 1 ? $t['cal.agenda.term.one'] : $t['cal.agenda.term.many']
  );
  const prevLabel = $derived(
    format(subDays(selectedDay, 1), $locale === 'de' ? 'd. MMM' : 'MMM d', {
      locale: dateLocale
    })
  );
  const nextLabel = $derived(
    format(addDays(selectedDay, 1), $locale === 'de' ? 'd. MMM' : 'MMM d', {
      locale: dateLocale
    })
  );
</script>

<div class="grid grid-cols-1 lg:grid-cols-[1fr_320px] lg:gap-0">
  <!-- Day list — same card treatment as the agenda view: today gets the
       dark ink block, other days get the date column + per-event paper
       cards with the category border. -->
  <!-- Swipe left/right = next/previous day (touch), same handlers as the arrows below. -->
  <div class="px-4 md:px-9 lg:px-10 py-3" use:swipeX={{ onLeft: goNext, onRight: goPrev }}>
    <!-- Keyed on the day so the list remounts and slides in (C09) on every change. -->
    {#key selectedDay.getTime()}
    <div class={swapDir ? `k-cal-swap-${swapDir}` : undefined}>
    {#if isOnToday}
      <div
        class="bg-ink rounded-md shadow-[3px_3px_0_var(--k-wine,#b23a5b)] mb-4 px-4 py-1 flex flex-col gap-1 lg:grid lg:grid-cols-[140px_1fr] lg:gap-4 lg:items-stretch"
      >
        <AgendaDayHeader day={selectedDay} eventCount={dayEvents.length} />
        <div class="border-t border-dashed border-paper/30 pt-2 lg:border-t-0 lg:border-l lg:pl-4 lg:pt-0 self-stretch">
          {#if dayEvents.length === 0}
            <p class="font-instrument italic text-[15px] text-paper/70 py-6">
              {$t['cal.state.empty.title']}
            </p>
          {:else}
            <div class="font-dmmono text-[10px] uppercase tracking-[0.1em] text-paper/60 pb-1 lg:pt-2">
              {dayEvents.length} {termLabel}{#if liveCount > 0}
                <span class="text-ochre"> · {liveCount} {$t['cal.agenda.today.running']}</span>
              {/if}
            </div>
            {#each dayEvents as ev (String(ev._id))}
              {@const eventId = String(ev._id)}
              <AgendaRow
                {ev}
                onPick={onPickEvent}
                today
                {currentUserId}
                isSaved={savedIds.has(eventId)}
                onToggleSave={onToggleSave ? () => onToggleSave(eventId) : undefined}
              />
            {/each}
          {/if}
        </div>
      </div>
    {:else}
      <div class="flex flex-col gap-2 mb-4 lg:grid lg:grid-cols-[140px_1fr] lg:gap-5 lg:items-start">
        <AgendaDayHeader day={selectedDay} eventCount={dayEvents.length} />
        {#if dayEvents.length === 0}
          <p class="font-instrument italic text-[16px] text-ink-mute py-6">
            {$t['cal.state.empty.title']}
          </p>
        {:else}
          <div class="flex flex-col gap-3">
            {#each dayEvents as ev (String(ev._id))}
              {@const eventId = String(ev._id)}
              {@const catStyle = CATEGORIES[(ev.category ?? 'kiez') as EventCategory]}
              <div
                class={`bg-paper border-[1.5px] ${catStyle.borderClass} rounded-md shadow-sm overflow-hidden`}
              >
                <AgendaRow
                  {ev}
                  onPick={onPickEvent}
                  {currentUserId}
                  isSaved={savedIds.has(eventId)}
                  onToggleSave={onToggleSave ? () => onToggleSave(eventId) : undefined}
                />
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    </div>
    {/key}

    <!-- Day-nav footer: prev / next. (A jump-to-today shortcut lived in
         the middle until Aug 2026 — removed, it read like a caption for
         the viewed day; the mini-calendar covers getting back.) -->
    <div
      class="mt-6 pt-3 flex justify-between items-center font-dmmono text-[10px] uppercase tracking-[0.05em] text-ink-mute border-t border-dashed border-rule"
    >
      <button
        type="button"
        onclick={goPrev}
        class="hover:text-ink transition-colors"
      >
        ← {prevLabel}
      </button>
      <button
        type="button"
        onclick={goNext}
        class="hover:text-ink transition-colors"
      >
        {nextLabel} →
      </button>
    </div>
  </div>

  <CalendarSidebar
    visibleMonth={selectedDay}
    {events}
    {selectedDay}
    onPickDay={(d) => {
      selectedDay = d;
      onDayChange?.(d);
    }}
  />
</div>
