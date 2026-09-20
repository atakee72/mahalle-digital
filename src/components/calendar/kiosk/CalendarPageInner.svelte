<script lang="ts">
  // Calendar page inner — view-state machine + events query.
  //
  // Phase 2 scope (this file): mount the kiosk shell (title block +
  // filter rail) and wire the events query so we can prove the data
  // layer end-to-end. The view bodies (month grid, agenda, day) land
  // in Phase 3, behind this same view state.
  //
  // Phase 4 will add drag-select state. Phase 5 will mount the detail
  // modal off the events list.

  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import {
    format,
    startOfWeek,
    endOfWeek,
    startOfMonth,
    endOfMonth,
    addMonths,
    subMonths,
    isSameMonth
  } from 'date-fns';
  import { de as deLocale, enUS } from 'date-fns/locale';

  import CalendarTitleBlock from './CalendarTitleBlock.svelte';
  import CalCategoryRail from './CalCategoryRail.svelte';
  import CalendarMonthGrid from './CalendarMonthGrid.svelte';
  import CalendarMobileMonth from './mobile/CalendarMobileMonth.svelte';
  import CalendarAgendaView from './CalendarAgendaView.svelte';
  import CalendarDayView from './CalendarDayView.svelte';
  import EventDetailModal from './EventDetailModal.svelte';
  import CalendarSkeleton from './states/CalendarSkeleton.svelte';
  import CalendarEmpty from './states/CalendarEmpty.svelte';
  import CalendarFilteredEmpty from './states/CalendarFilteredEmpty.svelte';
  import CalendarError from './states/CalendarError.svelte';

  import { CATEGORY_ORDER } from '../../../lib/calendar/categories';
  import { countLiveNow, countEventsThisWeek } from '../../../lib/calendar/eventTime';
  import { locale, t } from '../../../lib/kiosk-i18n';
  import { getDefaultCalendarQueryOptions } from '../../../lib/calendarQueryOptions';
  import { createSavedEventsQuery, createSaveEventMutation } from '../../../lib/savedEventsQueries';
  import { showToast, showSuccess } from '../../../utils/toast';
  import type { EventCategory, Event as EventDoc } from '../../../types';

  let { initialEvents = [], currentUserId = null } = $props<{
    initialEvents?: any[];
    currentUserId?: string | null;
  }>();

  // useQueryClient must be called during component setup (it reads from
  // QueryClientProvider context). Used by the flash-effect below to
  // cache-bust the events query so the UI catches up to the DB write.
  const queryClient = useQueryClient();

  // ─── Flash toasts on redirect from compose / edit ───────────────────
  // The compose page dispatches a toast before window.location.href, but
  // the full-page reload tears down the listener immediately. Reading the
  // query param here on mount re-fires the toast so the user actually
  // sees it. URL-cleanup keeps the flash from re-firing on back/forward.
  $effect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const justPosted = params.get('just_posted');
    const justEdited = params.get('just_edited');
    const editBlocked = params.get('edit_blocked');

    if (justPosted === '1') {
      showSuccess($t['compose.toast.approved'] as string);
    } else if (justEdited === '1') {
      showSuccess($t['compose.toast.editApproved'] as string);
    } else if (justEdited === 'pending') {
      showToast($t['compose.toast.editPending'] as string, {
        type: 'info',
        duration: 6000
      });
    } else if (editBlocked === '1') {
      showToast($t['calendar.flash.editBlocked'] as string, {
        type: 'warning',
        duration: 6000
      });
    }

    if (justPosted || justEdited || editBlocked) {
      // Cache-bust: SSR data can momentarily lag the DB write (browser
      // HTTP cache, MongoDB read-after-write timing). Background refetch
      // so the UI catches up within ~150ms without a loading spinner.
      queryClient.invalidateQueries({ queryKey: ['calendar', 'events'] });

      params.delete('just_posted');
      params.delete('just_edited');
      params.delete('edit_blocked');
      const qs = params.toString();
      const clean = window.location.pathname + (qs ? `?${qs}` : '');
      window.history.replaceState({}, '', clean);
    }
  });

  type View = 'month' | 'agenda' | 'day';

  // ─── Shared-event deep link (?event=<id>&d=<yyyy-MM-dd>) ──────────
  // Written by the detail modal's „teilen" button. Parsed synchronously
  // at script init (client:only island — window exists, same pattern as
  // the compose prefill) so visibleMonth can seed from `d` and the
  // events query fetches the right month range on first paint.
  const deepLink = (() => {
    if (typeof window === 'undefined') return null;
    const p = new URLSearchParams(window.location.search);
    const id = p.get('event');
    if (!id) return null;
    const d = p.get('d');
    const date = d ? new Date(`${d}T12:00:00`) : null;
    return { id, date: date && !isNaN(date.getTime()) ? date : null };
  })();
  let pendingEventId = $state<string | null>(deepLink?.id ?? null);

  let view = $state<View>('month');

  // Day the Tag view should open on — set by the month grid's "+ N weitere"
  // overflow chip, cleared on manual tab switches so the Tag tab itself
  // still lands on today. {#key} below remounts CalendarDayView when it
  // changes (the component snapshots initialDay into its own state).
  let dayViewDate = $state<Date | null>(null);

  function openDay(day: Date) {
    dayViewDate = day;
    view = 'day';
  }

  function switchView(v: View) {
    // Entering Tag view follows the header month — today when the header
    // is on the current month, the 1st otherwise (dayForMonth below).
    dayViewDate = v === 'day' ? dayForMonth(visibleMonth) : null;
    view = v;
  }
  let active = $state<Set<EventCategory>>(new Set(CATEGORY_ORDER));
  let myRsvps = $state(false);
  let myMaybes = $state(false);
  let saved = $state(false);

  // The category rail (CalCategoryRail, shared by every view + viewport)
  // uses single-select-with-all-reset semantics:
  //   Alle click → all categories on.
  //   Category click → isolate that category.
  //   Click already-isolated category → revert to "all".
  const isAllActive = $derived(active.size === CATEGORY_ORDER.length);

  function selectAll() {
    active = new Set(CATEGORY_ORDER);
  }

  function selectOnly(cat: EventCategory) {
    if (active.size === 1 && active.has(cat)) {
      selectAll();
    } else {
      active = new Set([cat]);
    }
  }

  function clearFilters() {
    // Re-enable all categories + drop "Zugesagt"/"Vielleicht"/"Gespeichert"
    active = new Set(CATEGORY_ORDER);
    myRsvps = false;
    myMaybes = false;
    saved = false;
  }

  // ─── Visible month + month navigation ─────────────────────────────
  // Tracked as $state so the bottom month-nav (← MÄRZ / MAI →) can
  // walk through months. Defaults to today.
  let visibleMonth = $state(deepLink?.date ?? new Date());

  // In Tag view the header month stepper must also move the shown day —
  // the day view snapshots initialDay, so dayViewDate (keyed remount)
  // carries the jump. Lands on today when stepping into the current
  // month, on the 1st otherwise.
  function dayForMonth(month: Date): Date {
    const today = new Date();
    return isSameMonth(month, today) ? today : startOfMonth(month);
  }

  function goPrevMonth() {
    visibleMonth = subMonths(visibleMonth, 1);
    if (view === 'day') dayViewDate = dayForMonth(visibleMonth);
  }
  function goNextMonth() {
    visibleMonth = addMonths(visibleMonth, 1);
    if (view === 'day') dayViewDate = dayForMonth(visibleMonth);
  }
  function goToday() {
    visibleMonth = new Date();
    if (view === 'day') dayViewDate = new Date();
  }

  // Reverse sync: day-by-day stepping inside the Tag view crossing a
  // month boundary recenters the header + query range. Deliberately does
  // NOT touch dayViewDate — that would remount the day view mid-step.
  function onDayViewDayChange(day: Date) {
    if (!isSameMonth(day, visibleMonth)) visibleMonth = day;
  }

  // Show the "Heute" snap-back button only when the user has navigated
  // away from the current calendar month.
  const isOnTodayMonth = $derived.by(() => {
    const now = new Date();
    return (
      visibleMonth.getFullYear() === now.getFullYear() &&
      visibleMonth.getMonth() === now.getMonth()
    );
  });

  // ─── Query ─────────────────────────────────────────────────────────
  // queryOpts depends on visibleMonth so the events query refetches when
  // the user navigates months. The thunk form of createQuery() lets
  // Svelte-Query v6 see the reactive queryKey change.
  const queryOpts = $derived(getDefaultCalendarQueryOptions(visibleMonth));

  async function fetchEvents(): Promise<EventDoc[]> {
    const opts = queryOpts;
    const params = new URLSearchParams();
    params.set('sortBy', opts.sortBy);
    params.set('sortOrder', opts.sortOrder);
    params.set('dateFrom', opts.dateFrom.toISOString());
    params.set('dateTo', opts.dateTo.toISOString());
    const res = await fetch(`/api/events?${params.toString()}`, {
      credentials: 'include'
    });
    if (!res.ok) throw new Error(`fetch /api/events ${res.status}`);
    const json = await res.json();
    return (json.events ?? []) as EventDoc[];
  }

  const eventsQuery = createQuery<EventDoc[]>(() => ({
    queryKey: ['calendar', 'events', queryOpts] as readonly unknown[],
    queryFn: fetchEvents,
    initialData:
      initialEvents.length > 0 ? (initialEvents as EventDoc[]) : undefined,
    // Stamped STALE (epoch), not Date.now(): initialData seeds EVERY month
    // key on navigation, and the SSR snapshot is (a) from page-load time and
    // (b) fetched for the initial range — stamping it fresh made just-published
    // events vanish for staleTime (60s) per visited month (flip-flop bug,
    // 2026-08-30). Epoch keeps the instant SSR paint but triggers an
    // immediate background refetch that reconciles the list.
    initialDataUpdatedAt: initialEvents.length > 0 ? 0 : undefined
  }));

  const events = $derived(eventsQuery.data ?? []);

  // ─── Saved events ─────────────────────────────────────────────────
  // Query is gated on having a logged-in user; the mutation is the
  // single source of truth for the saved set (both the MERKEN button
  // state per row and the "Gespeichert" filter read from this cache).
  const savedEventsQuery = createSavedEventsQuery(() => !!currentUserId);
  const saveMutation = createSaveEventMutation();

  const savedIds = $derived.by(() => {
    const data = savedEventsQuery.data;
    return {
      ready: data !== undefined,
      ids: new Set(data ?? [])
    };
  });

  function onToggleSave(eventId: string) {
    if (!currentUserId) return;
    const action = savedIds.ids.has(eventId) ? 'unsave' : 'save';
    saveMutation.mutate({ eventId, action });
  }

  // ─── Derived display data ─────────────────────────────────────────
  // Kicker reflects the months actually visible in the grid (Mon-start
  // weeks pull in trailing days from the previous month and leading
  // days from the next). When the visible window straddles two
  // months, label them as a range — `APRIL — MAI 2026` per CD's
  // header design.
  const monthLabel = $derived.by(() => {
    const loc = $locale === 'de' ? deLocale : enUS;
    const gridStart = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 1 });
    const sameMonth = gridStart.getMonth() === gridEnd.getMonth();
    const year = format(visibleMonth, 'yyyy', { locale: loc });
    if (sameMonth) {
      return format(visibleMonth, 'MMMM yyyy', { locale: loc }).toUpperCase();
    }
    const lo = format(gridStart, 'MMMM', { locale: loc }).toUpperCase();
    const hi = format(gridEnd, 'MMMM', { locale: loc }).toUpperCase();
    return `${lo} — ${hi} ${year}`;
  });

  // Single-month form for the desktop header stepper — always `MAI 2026`,
  // never the grid-straddle range. Kicker keeps the range form via `monthLabel`.
  const visibleMonthLabel = $derived(
    format(visibleMonth, 'MMMM yyyy', {
      locale: $locale === 'de' ? deLocale : enUS
    }).toUpperCase()
  );

  const prevMonthLabel = $derived(
    format(subMonths(visibleMonth, 1), 'MMMM', {
      locale: $locale === 'de' ? deLocale : enUS
    }).toUpperCase()
  );
  const nextMonthLabel = $derived(
    format(addMonths(visibleMonth, 1), 'MMMM', {
      locale: $locale === 'de' ? deLocale : enUS
    }).toUpperCase()
  );

  const displayedEvents = $derived(
    events.filter((ev) => {
      if (ev.category && !active.has(ev.category as EventCategory)) return false;
      if ((myRsvps || myMaybes) && currentUserId) {
        // "Zugesagt" means committed (going only); "Vielleicht" covers
        // maybe-RSVPs. Both active = OR (an RSVP is one or the other).
        const inGoing = (ev.rsvps?.going ?? []).some((id) => String(id) === currentUserId);
        const inMaybe = (ev.rsvps?.maybe ?? []).some((id) => String(id) === currentUserId);
        if (!((myRsvps && inGoing) || (myMaybes && inMaybe))) return false;
      }
      // Skip the saved filter until the savedEvents query hydrates —
      // otherwise the list flashes empty before resolving.
      if (saved && savedIds.ready && !savedIds.ids.has(String(ev._id))) return false;
      return true;
    })
  );

  // Stats — derived from current event list. `goingToday` is the
  // total RSVPs across all events occurring today (cheap to compute).
  const weekStart = $derived(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const weekEnd = $derived(endOfWeek(new Date(), { weekStartsOn: 1 }));
  const weekEvents = $derived(
    countEventsThisWeek(displayedEvents, weekStart, weekEnd)
  );
  // Range label disambiguating „diese Woche" — the stat always talks
  // about the REAL current week, even while another month is browsed.
  // DE „24.–30. Aug." / „31. Aug.–6. Sep."; EN „Aug 24–30" / „Aug 31–Sep 6".
  const weekRange = $derived.by(() => {
    const loc = $locale === 'de' ? deLocale : enUS;
    const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
    if ($locale === 'de') {
      return sameMonth
        ? `${format(weekStart, 'd.')}–${format(weekEnd, 'd. MMM', { locale: loc })}`
        : `${format(weekStart, 'd. MMM', { locale: loc })}–${format(weekEnd, 'd. MMM', { locale: loc })}`;
    }
    return sameMonth
      ? `${format(weekStart, 'MMM d', { locale: loc })}–${format(weekEnd, 'd', { locale: loc })}`
      : `${format(weekStart, 'MMM d', { locale: loc })}–${format(weekEnd, 'MMM d', { locale: loc })}`;
  });
  const liveNow = $derived(countLiveNow(displayedEvents));
  const goingToday = $derived.by(() => {
    const today = new Date();
    let total = 0;
    for (const ev of displayedEvents) {
      const start = ev.startDate instanceof Date ? ev.startDate : new Date(ev.startDate);
      if (
        start.getFullYear() === today.getFullYear() &&
        start.getMonth() === today.getMonth() &&
        start.getDate() === today.getDate()
      ) {
        total += ev.rsvps?.going?.length ?? 0;
      }
    }
    return total;
  });

  // ─── Detail modal state ─────────────────────────────────────────
  let selectedEvent = $state<EventDoc | null>(null);

  function onPickEvent(ev: EventDoc) {
    selectedEvent = ev;
  }

  // Deep-link opener: once the events for the seeded month are in, find
  // the shared event and open its modal. While the query is still
  // fetching (initialData is stamped stale → immediate reconcile) keep
  // waiting; only give up with a toast when the fetch settled without it
  // (deleted / moderated away).
  $effect(() => {
    if (!pendingEventId) return;
    const found = events.find((e) => String(e._id) === pendingEventId);
    if (found) {
      selectedEvent = found as EventDoc;
    } else if (eventsQuery.isPending || eventsQuery.isFetching) {
      return; // still loading — keep the deep link pending
    } else {
      showToast($t['cal.deeplink.notFound'] as string, { type: 'info' });
    }
    pendingEventId = null;
    const p = new URLSearchParams(window.location.search);
    p.delete('event');
    p.delete('d');
    const qs = p.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
  });

  // Re-derive selected event from the live cache so RSVP optimistic
  // updates flow through to the open modal without re-opening it.
  const liveSelected = $derived.by(() => {
    if (!selectedEvent) return null;
    const id = String(selectedEvent._id);
    return (events.find((e) => String(e._id) === id) as EventDoc | undefined) ?? selectedEvent;
  });
</script>

<div data-page="calendar">
  <!-- Title block + category rail render on EVERY view and viewport (2026-09-09,
       user decision): CalendarTitleBlock carries the mobile hero, CalCategoryRail
       the outlined „Alle …" pills — CalendarMobileMonth is grid + day panel only. -->
  <div>
    <CalendarTitleBlock
      {monthLabel}
      {visibleMonthLabel}
      {weekEvents}
      {weekRange}
      {liveNow}
      {goingToday}
      onPrevMonth={goPrevMonth}
      onNextMonth={goNextMonth}
      {view}
      onView={switchView}
      monthEvents={displayedEvents.length}
    />

    <CalCategoryRail
      {active}
      {isAllActive}
      onSelectAll={selectAll}
      onSelectOnly={selectOnly}
      {myRsvps}
      {myMaybes}
      {saved}
      onMyRsvps={() => (myRsvps = !myRsvps)}
      onMyMaybes={() => (myMaybes = !myMaybes)}
      onSaved={() => (saved = !saved)}
      {view}
      showToday={!isOnTodayMonth}
      onToday={goToday}
    />
  </div>

  <!-- Mobile month: dot-grid + day-detail panel (the header and category rail
       are the shared CalendarTitleBlock + CalCategoryRail above). Rendered from
       a snippet because it must ALSO mount when the month has no (visible)
       events — the empty states below used to replace it, which stranded phone
       users on an empty month with no way back (mobile audit 2026-09-09). -->
  {#snippet mobileMonth()}
    <div class="lg:hidden">
      <CalendarMobileMonth
        {visibleMonth}
        events={displayedEvents}
        onPickEvent={onPickEvent}
        onPrevMonth={goPrevMonth}
        onNextMonth={goNextMonth}
        {currentUserId}
        savedIds={savedIds.ids}
        onToggleSave={currentUserId ? onToggleSave : undefined}
      />
    </div>
  {/snippet}

  {#if eventsQuery.isPending && !events.length}
    <CalendarSkeleton />
  {:else if eventsQuery.isError}
    <CalendarError onRetry={() => eventsQuery.refetch()} />
  {:else if events.length === 0 && view !== 'month'}
    <CalendarEmpty />
  {:else if displayedEvents.length === 0 && view !== 'month'}
    <CalendarFilteredEmpty onClear={clearFilters} />
  {:else if view === 'month'}
    <!-- Month view ALWAYS shows the grid, even with zero events (user decision
         2026-09-09: the „Pause" empty card read as "nothing happens here" —
         a user complained). Only agenda/day fall back to the empty states. -->
    {@render mobileMonth()}
    <!-- Desktop month: full grid with event pills + drag-select. -->
    <div data-tour="cal-rsvp" class="hidden lg:block">
      <CalendarMonthGrid
        {visibleMonth}
        events={displayedEvents}
        onPickEvent={onPickEvent}
        onOpenDay={openDay}
        onPrevMonth={goPrevMonth}
        onNextMonth={goNextMonth}
        {prevMonthLabel}
        {nextMonthLabel}
        liveCount={liveNow}
        {currentUserId}
      />
    </div>
    {#if events.length > 0 && displayedEvents.length === 0}
      <!-- Filters hide every event of the month: keep the grid, add the clear hint. -->
      <CalendarFilteredEmpty onClear={clearFilters} />
    {/if}
  {:else if view === 'agenda'}
    <CalendarAgendaView
      events={displayedEvents}
      {visibleMonth}
      onPickEvent={onPickEvent}
      onRsvp={onPickEvent}
      savedIds={savedIds.ids}
      onToggleSave={currentUserId ? onToggleSave : undefined}
      {currentUserId}
    />
  {:else}
    {#key dayViewDate}
      <CalendarDayView
        events={displayedEvents}
        onPickEvent={onPickEvent}
        onRsvp={onPickEvent}
        savedIds={savedIds.ids}
        onToggleSave={currentUserId ? onToggleSave : undefined}
        {currentUserId}
        initialDay={dayViewDate ?? undefined}
        onDayChange={onDayViewDayChange}
      />
    {/key}
  {/if}

  <EventDetailModal
    event={liveSelected}
    open={!!liveSelected}
    currentUserId={currentUserId}
    onClose={() => (selectedEvent = null)}
    onDeleted={() => {
      selectedEvent = null;
      queryClient.invalidateQueries({ queryKey: ['calendar', 'events'] });
      showSuccess($t['cal.detail.delete.done'] as string);
    }}
  />

  <!-- Floating add-event FAB (mobile-only, all views). Parked above
       the bottom mobile nav (h-12 at z-40) with 16px clearance. Teal
       fill since 2026-09-20 (user: the button takes the page colour —
       forum + market wine, calendar teal, news ink) + ink print-shadow. -->
  <a
    href="/events/create"
    aria-label={$t['cal.mobile.cta.aria']}
    class="fixed bottom-16 right-4 z-30 w-14 h-14 rounded-full bg-teal text-paper border-2 border-ink font-bricolage font-bold text-[28px] leading-none shadow-[3px_3px_0_var(--k-ink,#0e1033)] flex items-center justify-center lg:hidden"
  ><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 4v16M4 12h16" /></svg></a>
</div>
