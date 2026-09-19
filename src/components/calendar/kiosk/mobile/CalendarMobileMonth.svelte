<script lang="ts">
  // Mobile month view — the dot-only mini grid + day-detail bottom panel
  // shown below `lg` in place of the desktop CalendarMonthGrid. The mobile
  // header and filter rail live in CalendarTitleBlock + CalCategoryRail
  // (shared with agenda/day since 2026-09-09), not here.
  //
  // Pure presentation: state still owned by CalendarPageInner.
  // Internal state: `selectedDay` (drives the bottom panel; defaults
  // to today; updates on cell tap).

  import {
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    isSameMonth,
    isSameDay,
    isToday as isTodayDate,
    isBefore,
    startOfDay,
    format
  } from 'date-fns';
  import { de as deLocale, enUS } from 'date-fns/locale';

  import { CATEGORIES } from '../../../../lib/calendar/categories';
  import { tick } from 'svelte';
  import { swipeX } from '../../../../lib/swipe';
  import { resolveDragEnd } from '../../../../lib/calendar/rangeDrag';
  import { mastBottomAfterScroll, MAST_HIDE_QUERY } from '../../../../lib/nav/hideOnScroll';
  import {
    eventCoversDay,
    isLiveNow,
    sortEventsForDay
  } from '../../../../lib/calendar/eventTime';
  import { now } from '../../../../lib/calendar/nowTicker';
  import { t, locale } from '../../../../lib/kiosk-i18n';
  import { rsvpMutation } from '../../../../lib/calendarMutations';
  import { showError } from '../../../../utils/toast';
  import type { EventCategory, Event as EventDoc } from '../../../../types';
  import DragSelectPin from '../DragSelectPin.svelte';
  import StatusBadge from '../../../forum/kiosk/StatusBadge.svelte';

  // Moderation badge precedence — same as forum cards.
  function inferBadge(ev: EventDoc) {
    if (ev.moderationStatus === 'rejected') return 'rejected' as const;
    if (ev.isUserReported && ev.moderationStatus === 'pending') return 'reported' as const;
    if (ev.moderationStatus === 'pending') return 'pending' as const;
    if (ev.hasWarningLabel) return 'warning' as const;
    return null;
  }

  // Author-only ghosting state — pending / reported / rejected only.
  // Returns the dashed outline class string + body opacity flag.
  function authorIdOf(ev: EventDoc): string | null {
    const a = ev.author as any;
    if (!a) return null;
    if (typeof a === 'string') return a;
    if (a._id) return typeof a._id === 'string' ? a._id : a._id.toString?.() ?? null;
    return null;
  }
  function ghostOutlineClass(ev: EventDoc, viewerId: string | null): string {
    if (!viewerId || viewerId !== authorIdOf(ev)) return '';
    if (ev.moderationStatus === 'rejected')
      return 'outline outline-2 outline-dashed outline-danger outline-offset-[-2px] rounded-md';
    if (ev.isUserReported && ev.moderationStatus === 'pending')
      return 'outline outline-2 outline-dashed outline-plum outline-offset-[-2px] rounded-md';
    if (ev.moderationStatus === 'pending')
      return 'outline outline-2 outline-dashed outline-warn outline-offset-[-2px] rounded-md';
    return '';
  }

  let {
    visibleMonth = new Date(),
    events = [],
    onPickEvent,
    onPrevMonth,
    onNextMonth,
    currentUserId = null,
    savedIds = new Set<string>(),
    onToggleSave
  } = $props<{
    visibleMonth?: Date;
    events?: EventDoc[];
    onPickEvent?: (ev: EventDoc) => void;
    onPrevMonth?: () => void;
    onNextMonth?: () => void;
    currentUserId?: string | null;
    savedIds?: Set<string>;
    onToggleSave?: (eventId: string) => void;
  }>();

  // RSVP toggle for the day-panel rows. Mutation is bound to the
  // current user id at component init; clicking +/✓ on a row flips
  // between 'going' and 'cancel'. Logged-out users see no button.
  // Initial-value capture is deliberate: currentUserId comes from the SSR
  // session and never changes within a page's lifetime.
  // svelte-ignore state_referenced_locally
  const rsvp = rsvpMutation(currentUserId ?? '__anon__');

  function isGoing(ev: EventDoc): boolean {
    if (!currentUserId) return false;
    const arr = (ev.rsvps?.going ?? []).map(String);
    return arr.includes(currentUserId);
  }

  function toggleRsvp(ev: EventDoc) {
    if (!currentUserId) return;
    const eventId = String(ev._id);
    const next: 'going' | 'cancel' = isGoing(ev) ? 'cancel' : 'going';
    rsvp.mutate(
      { eventId, status: next },
      {
        onError: (err) => {
          showError(err instanceof Error ? err.message : 'RSVP fehlgeschlagen.');
        }
      }
    );
  }

  let selectedDay = $state(new Date());

  // ─── Range-select state-machine ───────────────────────────────────
  // Ported 1:1 from origin/main:CalendarContainer.tsx:305 (handleDateClick)
  // — long-press arms range, next plain tap commits, plain tap on a
  // third day clears the range, long-press anywhere restarts.
  let rangeStart = $state<Date | null>(null);
  let rangeEnd = $state<Date | null>(null);
  let isRangeArmed = $state(false);
  let pulseCellKey = $state<string | null>(null);
  let pin = $state<{ x: number; y: number; from: Date; to: Date; flip: boolean; tailX: number } | null>(null);

  // Touch drag (2026-09-11): after the long-press fires, the SAME finger
  // can keep moving over other days to stretch the range — no second tap
  // needed. `dragging` is reactive because the pin effect hides the pin
  // while a range is being stretched; `dragPointerId` pins the gesture to
  // the finger that started it.
  let dragging = $state(false);
  let dragPointerId: number | null = null;

  // Non-reactive locals — internal flags only.
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressFired = false;
  let gridWrapper: HTMLDivElement | undefined = $state();
  let panelEl: HTMLDivElement | undefined = $state();

  // After a plain tap, scroll so the month stepper („‹ SEPTEMBER 2026 ›",
  // `data-tour="cal-month-nav"` in CalendarTitleBlock's mobile hero) sits
  // right under the sticky masthead (user, 2026-09-10 — the earlier
  // "smallest delta" version scrolled too little). That keeps the whole
  // grid on screen and shows as much of the day panel as the viewport
  // allows. Aligns in both directions; no-op when already there; instant
  // under reduced motion.
  async function revealPanel() {
    await tick();
    if (!panelEl) return;
    const stepper = Array.from(document.querySelectorAll<HTMLElement>('[data-tour="cal-month-nav"]'))
      .find((el) => el.getBoundingClientRect().height > 0);
    if (!stepper) return;
    // The scroll below may itself hide or show the masthead (hide-on-scroll,
    // 2026-09-19) — aim at where the bar WILL be, or the stepper lands a bar's
    // height too low (bar hides) or under it (bar returns).
    const header = document.querySelector('header');
    const currentBottom = header?.getBoundingClientRect().bottom ?? 0;
    const stepperTop = stepper.getBoundingClientRect().top;
    const mastheadBottom = mastBottomAfterScroll(
      stepperTop - Math.max(currentBottom, 0) - 8,
      header?.offsetHeight ?? 0,
      currentBottom,
      window.matchMedia(MAST_HIDE_QUERY).matches,
      window.scrollY
    );
    const delta = stepperTop - mastheadBottom - 8;
    if (Math.abs(delta) < 4) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollBy({ top: delta, behavior: reduced ? 'auto' : 'smooth' });
  }

  // Slide direction for the month swap (swipe or the header arrows —
  // both arrive here as a new `visibleMonth`): forward → grid comes in
  // from the right. Set in `$effect.pre` so the {#key}-remounted grid
  // wears the class on mount; null on first render = no animation.
  let swapDir = $state<'left' | 'right' | null>(null);
  let lastMonthTs: number | null = null;
  $effect.pre(() => {
    const ts = visibleMonth.getTime();
    if (lastMonthTs !== null && ts !== lastMonthTs) swapDir = ts > lastMonthTs ? 'left' : 'right';
    lastMonthTs = ts;
  });

  // While a drag is live, swallow touchmove so the browser never starts a
  // pan (a pan would pointercancel the drag). Non-passive on purpose;
  // attached once to the stable wrapper and checks the flag per event, so
  // plain touches keep native scrolling. Reading `dragging` inside the
  // listener does not subscribe the effect — that is intended.
  $effect(() => {
    const el = gridWrapper;
    if (!el) return;
    const block = (ev: TouchEvent) => {
      if (dragging) ev.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  });

  function clearLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  // The timer body writes reactive state and captures a pointer on the
  // cell — never let it fire on a destroyed instance.
  $effect(() => clearLongPress);

  // Tap vs. long-press (changed 2026-09-09, user request): a plain tap only
  // SELECTS the day for the panel below — it never opens the „+ termin"
  // pin. Long-press anchors + arms the pin (and a following tap on another
  // day extends it to a range). A plain tap while nothing is armed clears
  // any leftover selection, so the pin can't linger from an earlier
  // long-press. The legacy "tap anchors" behavior lives on only on desktop
  // (CalendarMonthGrid's drag-select).
  function handleDateTap(date: Date, viaLongPress: boolean) {
    const isPast = isBefore(startOfDay(date), startOfDay(new Date()));

    // Always update the bottom-panel day; a plain tap also scrolls the
    // panel into view (a long-press keeps the pin where the finger is).
    selectedDay = date;
    if (!viaLongPress) void revealPanel();

    // Past date: clear all selection state. Bottom panel still shows
    // events for that day (above), but no range can start in the past.
    if (isPast) {
      rangeStart = null;
      rangeEnd = null;
      isRangeArmed = false;
      return;
    }

    // Long-press always re-anchors + arms (pin opens on this day).
    if (viaLongPress) {
      rangeStart = date;
      rangeEnd = null;
      isRangeArmed = true;
      return;
    }

    // ARMED + plain tap on the anchor day → no-op (pin stays).
    if (rangeStart && isRangeArmed && isSameDay(date, rangeStart)) return;

    // ARMED + plain tap on a different day → form the range.
    if (rangeStart && isRangeArmed) {
      if (isBefore(date, rangeStart)) {
        rangeEnd = rangeStart;
        rangeStart = date;
      } else {
        rangeEnd = date;
      }
      isRangeArmed = false;
      return;
    }

    // Not armed (idle, or a finished range) → plain tap just selects the
    // day; drop any leftover anchor/range so the pin closes.
    rangeStart = null;
    rangeEnd = null;
    isRangeArmed = false;
  }

  function cellPointerDown(e: PointerEvent, date: Date, isInMonth: boolean) {
    longPressFired = false;
    if (e.pointerType !== 'touch' || !isInMonth || !e.isPrimary || dragging) return;
    clearLongPress();
    // `currentTarget` is null once the event has finished dispatching —
    // grab the button now for the pointer capture inside the timer.
    const cellEl = e.currentTarget as HTMLElement | null;
    const pointerId = e.pointerId;
    longPressTimer = setTimeout(() => {
      longPressFired = true;
      if ('vibrate' in navigator) {
        try { navigator.vibrate([30, 30, 30]); } catch { /* ignore */ }
      }
      pulseCellKey = date.toISOString();
      setTimeout(() => (pulseCellKey = null), 400);
      // Commit IN the timer — iOS Safari swallows the post-long-press
      // synthetic click, so onclick won't fire reliably.
      handleDateTap(date, true);
      // Past days never arm (handleDateTap bails) — nothing to drag then.
      if (!isRangeArmed) return;
      // Drag phase: keep move/up events flowing to this cell even when
      // the finger leaves it. The touchmove guard below stops the browser
      // from turning the travel into a page scroll.
      // Commit to the drag phase only once capture has actually succeeded:
      // `dragging` gates the touchmove guard and the swipe `ignore`, so a
      // latched flag would freeze grid scrolling and month swipes until a
      // reload. A refused capture (finger already gone) means no drag phase.
      try {
        if (!cellEl) throw new Error('no cell');
        cellEl.setPointerCapture(pointerId);
        dragging = true;
        dragPointerId = pointerId;
      } catch {
        /* no drag phase */
      }
    }, 450);
  }

  function cellPointerMove(e: PointerEvent) {
    if (!dragging || e.pointerId !== dragPointerId || !rangeStart) return;
    // The pin card can sit between the finger and the grid (it renders on
    // the anchor until the first cell change, and again whenever the finger
    // is back on the anchor) — walk the whole hit-test stack so the cell
    // underneath still resolves.
    let iso: string | null = null;
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      const cell = el.closest('[data-cell-date]');
      if (cell) { iso = cell.getAttribute('data-cell-date'); break; }
    }
    const next = resolveDragEnd(rangeStart, iso ? new Date(iso) : null, startOfDay(new Date()), rangeEnd);
    if ((next?.getTime() ?? null) === (rangeEnd?.getTime() ?? null)) return;
    rangeEnd = next;
    if ('vibrate' in navigator) {
      try { navigator.vibrate(10); } catch { /* ignore */ }
    }
  }

  // pointerup AND pointercancel. A finger that travelled to another day
  // committed a range (same outcome as the second-tap path); no travel
  // keeps the anchor armed so tap-to-extend still works. The wrapper's
  // swipeX has already run by the time this delegated handler fires
  // (Svelte 5 delegates pointerup to the root) — it reads `dragging`
  // through its `ignore` option, still true at that moment, which is
  // why the flag is cleared HERE and not earlier.
  function endDrag(e: PointerEvent) {
    clearLongPress();
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragging = false;
    dragPointerId = null;
    if (rangeEnd) isRangeArmed = false;
  }

  // Android fires contextmenu ~500 ms into a press; after our long-press
  // it would only get in the way of the drag.
  function cellContextMenu(e: Event) {
    if (longPressFired || dragging) e.preventDefault();
  }

  function cellClick(e: MouseEvent, date: Date, isInMonth: boolean) {
    if (longPressFired) {
      // Android sometimes still fires a click after the long-press
      // timer commits — swallow it so we don't double-trigger.
      longPressFired = false;
      e.preventDefault();
      return;
    }
    if (!isInMonth) return;
    handleDateTap(date, false);
  }

  // Pin positioning — when rangeStart/rangeEnd change, look up the
  // target cell's bounds and stash the pin's x/y. Cells expose a
  // `data-cell-date={cell.toISOString()}` attribute below. Coordinates
  // are clamped to the wrapper rect so the pin never bleeds past the
  // grid edges, and the pin flips ABOVE the cell when there isn't room
  // below it.
  //
  // The pin must read as ATTACHED to the selected day (2026-09-09 fix):
  //  · flipped placement anchors the pin's BOTTOM edge 8px above the
  //    cell (`flip` → the pin translates itself up by its own height),
  //    so a wrong height estimate can no longer leave it floating two
  //    rows above the cell — which is exactly what happened before,
  //    when a row-4 tap put the card over row 2;
  //  · `tailX` re-points the tail at the cell's centre after `x` has
  //    been clamped, so the tail isn't stuck at the card's left edge;
  //  · PIN_H is measured from the rendered card (`pinH`) and only used
  //    to DECIDE the flip, never to place the card.
  // Conservative width estimate so the pin always fits inside the
  // grid wrapper. Min-width is 180 but the rendered card grows to
  // ~220 with the '+ neuer termin' + 'abbrechen' buttons inside.
  const PIN_W = 230;
  const PIN_H = 100;
  const PIN_GAP = 8;
  let pinH = $state(PIN_H);

  // Measure the rendered card once it exists — the estimate above is a
  // fallback for the first frame only. Writes `pinH`, which re-runs the
  // placement effect below; the guard stops that settling into a loop.
  $effect(() => {
    if (!pin || !gridWrapper) return;
    const el = gridWrapper.querySelector<HTMLElement>('.k-cal-pin');
    if (!el) return;
    const h = el.offsetHeight;
    if (h > 0 && Math.abs(h - pinH) > 1) pinH = h;
  });

  $effect(() => {
    if (!rangeStart || !gridWrapper) {
      pin = null;
      return;
    }
    // Stretching a range under the finger: the pin would sit under the
    // thumb and jump every cell — hide it until the finger lifts. The
    // press itself (no travel yet) keeps showing the pin on the anchor.
    if (dragging && rangeEnd) {
      pin = null;
      return;
    }
    const target = rangeEnd ?? rangeStart;
    const sel = `[data-cell-date="${target.toISOString()}"]`;
    const cell = gridWrapper.querySelector<HTMLElement>(sel);
    if (!cell) return;
    const cellRect = cell.getBoundingClientRect();
    const wrapRect = gridWrapper.getBoundingClientRect();

    const lo = rangeEnd && rangeStart < rangeEnd ? rangeStart : (rangeEnd ?? rangeStart);
    const hi = rangeEnd && rangeStart < rangeEnd ? rangeEnd : rangeStart;

    // Horizontal clamp — keep [8 .. wrapRect.width − PIN_W − 8].
    const cellCentreRel = cellRect.left - wrapRect.left + cellRect.width / 2;
    const ideal = cellCentreRel - PIN_W / 2;
    const x = Math.max(8, Math.min(wrapRect.width - PIN_W - 8, ideal));
    // Tail follows the cell centre; clamped inside the card's minimum
    // width (180) so it can't hang off a narrow card's corner.
    const tailX = Math.max(10, Math.min(158, cellCentreRel - x - 6));

    // Vertical placement — below the cell by default, above it when
    // there is no room below AND there is room above.
    const cellTopRel = cellRect.top - wrapRect.top;
    const cellBottomRel = cellRect.bottom - wrapRect.top;
    const roomBelow = wrapRect.height - cellBottomRel;
    const roomAbove = cellTopRel;
    const flip = roomBelow < pinH + PIN_GAP && roomAbove >= pinH + PIN_GAP;
    // Flipped: `y` is the pin's BOTTOM edge. Otherwise its top edge,
    // kept inside the wrapper when neither side has full room.
    const y = flip
      ? cellTopRel - PIN_GAP
      : Math.max(PIN_GAP, Math.min(cellBottomRel + PIN_GAP, wrapRect.height - pinH - PIN_GAP));

    pin = { x, y, from: lo, to: hi, flip, tailX };
  });

  function clearSelection() {
    rangeStart = null;
    rangeEnd = null;
    isRangeArmed = false;
    pin = null;
  }

  function confirmPin() {
    if (!pin) return;
    const fromIso = format(pin.from, 'yyyy-MM-dd');
    const toIso = format(pin.to, 'yyyy-MM-dd');
    if (typeof window !== 'undefined') {
      window.location.href = `/events/create?from=${fromIso}&to=${toIso}`;
    }
    clearSelection();
  }

  // Helpers used by the cell template.
  function inCommittedRange(date: Date): boolean {
    if (!rangeStart || !rangeEnd) return false;
    const lo = rangeStart < rangeEnd ? rangeStart : rangeEnd;
    const hi = rangeStart < rangeEnd ? rangeEnd : rangeStart;
    return date >= lo && date <= hi;
  }
  function isEndpoint(date: Date): boolean {
    return (
      (rangeStart != null && isSameDay(rangeStart, date)) ||
      (rangeEnd != null && isSameDay(rangeEnd, date))
    );
  }
  function isArmedAnchor(date: Date): boolean {
    return !!(isRangeArmed && rangeStart && isSameDay(rangeStart, date));
  }

  const dateLocale = $derived($locale === 'de' ? deLocale : enUS);

  // Single-letter DOW labels (Mon-start) — same pattern as the desktop
  // grid, just narrowed.
  const DOW_NARROW_DE = ['M', 'D', 'M', 'D', 'F', 'S', 'S'];
  const DOW_NARROW_EN = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const dowLabels = $derived($locale === 'de' ? DOW_NARROW_DE : DOW_NARROW_EN);

  // Short labels for the bottom-panel kicker (`MO`, `DI`, … / `MON`, `TUE`, …).
  const DOW_SHORT_DE = ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'];
  const DOW_SHORT_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  const gridStart = $derived(
    startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 1 })
  );
  const gridEnd = $derived(
    endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 1 })
  );
  const cells = $derived(eachDayOfInterval({ start: gridStart, end: gridEnd }));
  const rows = $derived(Math.ceil(cells.length / 7));

  // Bottom-panel data
  const dayEvents = $derived(
    sortEventsForDay(events.filter((ev) => eventCoversDay(ev, selectedDay)))
  );
  const dayIsToday = $derived(isTodayDate(selectedDay));

  const dayKicker = $derived.by(() => {
    const dowArr = $locale === 'de' ? DOW_SHORT_DE : DOW_SHORT_EN;
    const dow = dowArr[selectedDay.getDay()];
    const d = selectedDay.getDate();
    const month = format(selectedDay, 'MMMM', { locale: dateLocale }).toUpperCase();
    if (dayIsToday) {
      return `◆ ${$t['cal.cell.today']} · ${dow} ${d}. ${month}`;
    }
    return `◆ ${dow} ${d}. ${month}`;
  });

</script>

<div class="lg:hidden">
  <!-- Header + filter rail REMOVED 2026-09-09: CalendarTitleBlock (mobile hero) and
       CalCategoryRail now render for month view too, so the chrome is identical across
       month / agenda / day. This component is the dot-grid + day panel only. -->
  <!-- Mini dot-grid -->
  <!-- Swipe left/right on the grid = next/previous month (touch); taps and the
       long-press range selection are untouched (a swipe has travel, they don't). -->
  <div data-tour="cal-grid" class="px-2 pt-2 relative" bind:this={gridWrapper} use:swipeX={{ onLeft: onNextMonth, onRight: onPrevMonth, ignore: () => dragging }}>
    <div class="grid grid-cols-7 border-b border-ink">
      {#each dowLabels as label, i (label + '-' + i)}
        <div
          class={`font-dmmono text-[10px] uppercase tracking-[0.1em] py-1.5 text-center ${
            i >= 5 ? 'text-wine' : 'text-ink-mute'
          }`}
        >
          {label}
        </div>
      {/each}
    </div>
    <!-- Keyed on the month so the dot-grid remounts and slides in (C09). -->
    {#key visibleMonth.getTime()}
    <div
      class={`grid grid-cols-7 select-none ${swapDir ? `k-cal-swap-${swapDir}` : ''}`}
      style:grid-template-rows={`repeat(${rows}, minmax(52px, 1fr))`}
      style:touch-action="manipulation"
    >
      {#each cells as cell, i (cell.toISOString())}
        {@const inMonth = isSameMonth(cell, visibleMonth)}
        {@const today = isTodayDate(cell)}
        {@const selected = isSameDay(cell, selectedDay)}
        {@const inRange = inCommittedRange(cell)}
        {@const endpoint = isEndpoint(cell)}
        {@const armed = isArmedAnchor(cell)}
        {@const pulsing = pulseCellKey === cell.toISOString()}
        {@const cellEvents = sortEventsForDay(
          events.filter((ev) => eventCoversDay(ev, cell))
        ).slice(0, 3)}
        <button
          type="button"
          data-cell-date={cell.toISOString()}
          onclick={(e) => cellClick(e, cell, inMonth)}
          onpointerdown={(e) => cellPointerDown(e, cell, inMonth)}
          onpointermove={cellPointerMove}
          onpointerup={endDrag}
          onpointercancel={endDrag}
          onlostpointercapture={endDrag}
          onpointerleave={clearLongPress}
          oncontextmenu={cellContextMenu}
          disabled={!inMonth}
          class={`flex flex-col items-center justify-center gap-1 py-2 transition-colors ${
            inRange ? 'bg-wine/10' : selected && !today && !armed ? 'bg-wine/10' : ''
          } ${pulsing ? 'longpress-pulse' : ''} ${inMonth ? '' : 'opacity-35'} disabled:cursor-default`}
        >
          <span
            class={`flex items-center justify-center text-[13px] ${
              today || endpoint
                ? 'w-7 h-7 rounded-full bg-wine border-2 border-ink font-extrabold text-paper'
                : armed
                ? 'w-7 h-7 rounded-full bg-paper border-2 border-wine font-extrabold text-wine'
                : 'font-medium text-ink'
            }`}
          >
            {cell.getDate()}
          </span>
          <span class="flex gap-0.5 h-1 items-center">
            {#each cellEvents as ev (String(ev._id) + cell.toISOString())}
              {@const cellCat = (ev.category ?? 'kiez') as EventCategory}
              <span
                class={`w-1 h-1 rounded-full ${CATEGORIES[cellCat].bgClass}`}
                aria-hidden="true"
              ></span>
            {/each}
          </span>
        </button>
      {/each}
    </div>
    {/key}

    {#if pin}
      <DragSelectPin
        x={pin.x}
        y={pin.y}
        from={pin.from}
        to={pin.to}
        flip={pin.flip}
        tailX={pin.tailX}
        onConfirm={confirmPin}
        onCancel={clearSelection}
      />
    {/if}
  </div>

  <!-- Usage guidance — small italic note explaining tap vs long-press. -->
  <p
    class="px-4 mt-3 font-instrument italic text-[12px] text-ink-mute leading-[1.5]"
  >
    {$t['cal.mobile.guidance']}
  </p>

  <!-- Bottom day panel -->
  <!-- pb-24: the fixed „+" FAB (bottom-16, 56px) otherwise covers the last row's RSVP/save buttons. -->
  <div data-tour="cal-rsvp" class="px-4 pt-4 pb-24 mt-2 border-t-[1.5px] border-ink" bind:this={panelEl}>
    <div class="font-dmmono text-[10px] uppercase tracking-[0.12em] text-teal mb-2">
      {dayKicker}
    </div>
    {#if dayEvents.length === 0}
      <p class="font-instrument italic text-[14px] text-ink-mute py-3">
        {$t['cal.mobile.dayEmpty']}
      </p>
    {:else}
      <ul class="m-0 p-0 list-none">
        {#each dayEvents as ev (String(ev._id))}
          {@const live = isLiveNow(ev, $now)}
          {@const start = ev.startDate instanceof Date ? ev.startDate : new Date(ev.startDate)}
          {@const going = isGoing(ev)}
          {@const badge = inferBadge(ev)}
          {@const ghost = ghostOutlineClass(ev, currentUserId)}
          <li class={`flex items-center gap-2 border-b border-dashed border-rule ${ghost} ${ghost ? 'px-1.5 my-0.5' : ''}`}>
            <button
              type="button"
              onclick={() => onPickEvent?.(ev)}
              class="flex-1 min-w-0 grid grid-cols-[64px_1fr] gap-2 py-2 text-left items-start"
            >
              <span
                class={`font-dmmono text-[11px] font-semibold pt-0.5 ${
                  live ? 'text-wine' : 'text-ink'
                }`}
              >
                {ev.allDay
                  ? $t['cal.allDay']
                  : format(start, 'HH:mm', { locale: dateLocale })}
              </span>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="font-bricolage font-bold text-[13px] leading-[1.2] truncate">
                    {ev.title}
                  </span>
                  {#if badge}
                    <StatusBadge state={badge} size="sm" />
                  {/if}
                </div>
                {#if ev.location}
                  <div class={`font-instrument italic text-[11px] text-ink-mute truncate ${ghost ? 'opacity-70' : ''}`}>
                    {ev.location}
                  </div>
                {/if}
              </div>
            </button>

            {#if currentUserId}
              <button
                type="button"
                onclick={() => toggleRsvp(ev)}
                aria-pressed={going}
                aria-label={going ? $t['cal.mobile.rsvp.cancel.aria'] : $t['cal.mobile.rsvp.going.aria']}
                class={`shrink-0 w-9 h-9 rounded-full border-[1.5px] border-ink flex items-center justify-center font-bricolage font-bold text-[16px] leading-none transition-colors ${
                  going ? 'bg-moss text-paper' : 'bg-paper text-ink hover:bg-paper-warm'
                }`}
              >
                {going ? '✓' : '+'}
              </button>
            {/if}
            {#if onToggleSave}
              {@const isSaved = savedIds.has(String(ev._id))}
              <button
                type="button"
                onclick={() => onToggleSave(String(ev._id))}
                aria-pressed={isSaved}
                aria-label={$t['cal.agenda.row.save']}
                title={$t['cal.agenda.row.save']}
                class={`shrink-0 w-9 h-9 rounded-full border-[1.5px] border-ink flex items-center justify-center transition-colors ${
                  isSaved ? 'bg-ink text-paper' : 'bg-paper text-ink hover:bg-paper-warm'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor" fill={isSaved ? 'currentColor' : 'none'} aria-hidden="true">
                  <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
                </svg>
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

</div>
