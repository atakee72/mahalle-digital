<script lang="ts">
  // Month grid — Editorial Kiosk treatment.
  //
  // Dynamic 5- or 6-row layout: real months sometimes need 6 rows
  // (e.g. a 31-day month starting on Sunday). CD's JSX hardcodes 35
  // because the artboard targets one specific month — we compute the
  // row count via date-fns instead.
  //
  // Each event renders as a colored pill in every cell it spans, with
  // span-start/mid/end flags driving border-radius + side borders so
  // multi-day events read as a continuous banner across cells. The
  // negative-margin trick (`-mr-px`) eliminates the 1px gap between
  // adjacent cell borders so the banner is unbroken.
  //
  // Drag-select pointer-events land in Phase 4. For Phase 3 cells are
  // click-only (event-pill clicks bubble to parent's `onPickEvent`).

  import {
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    isSameMonth,
    isToday as isTodayDate,
    getDay,
    format,
    isSameDay,
    startOfDay
  } from 'date-fns';

  import EventPill from './EventPill.svelte';
  import DragSelectPin from './DragSelectPin.svelte';
  import DragSelectCoachmark from './DragSelectCoachmark.svelte';
  import {
    eventCoversDay,
    isLiveNow,
    isSpanStart,
    isSpanEnd,
    sortEventsForDay
  } from '../../../lib/calendar/eventTime';
  import { now } from '../../../lib/calendar/nowTicker';
  import { t, locale } from '../../../lib/kiosk-i18n';
  import type { Event as EventDoc } from '../../../types';

  let {
    visibleMonth = new Date(),
    events = [],
    onPickEvent,
    onOpenDay,
    onSelectionConfirmed,
    onPrevMonth,
    onNextMonth,
    prevMonthLabel = '',
    nextMonthLabel = '',
    liveCount = 0,
    currentUserId = null
  } = $props<{
    visibleMonth?: Date;
    events?: EventDoc[];
    onPickEvent?: (ev: EventDoc) => void;
    onOpenDay?: (day: Date) => void;
    onSelectionConfirmed?: (from: Date, to: Date) => void;
    onPrevMonth?: () => void;
    onNextMonth?: () => void;
    prevMonthLabel?: string;
    nextMonthLabel?: string;
    liveCount?: number;
    currentUserId?: string | null;
  }>();

  function liveLine(n: number): string {
    return ($t['cal.footer.live'] as string).replace('{n}', String(n));
  }

  // Day-of-week labels — short, locale-specific. Hardcoded (matches
  // CD's JSX `DOW[lang]`); a date-fns `format(d, 'EEEEEE')` route would
  // be locale-pure but loses our period-free DE convention ("Mo" not "Mo.").
  const DOW_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const DOW_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dowLabels = $derived($locale === 'de' ? DOW_DE : DOW_EN);

  const gridStart = $derived(
    startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 1 })
  );
  const gridEnd = $derived(
    endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 1 })
  );
  const cells = $derived(eachDayOfInterval({ start: gridStart, end: gridEnd }));
  const rows = $derived(Math.ceil(cells.length / 7));

  function isWeekend(d: Date): boolean {
    // getDay: 0 = Sun, 6 = Sat — both are weekend.
    const g = getDay(d);
    return g === 0 || g === 6;
  }

  // ─── Drag-select state ────────────────────────────────────────────
  let gridWrapper: HTMLDivElement;
  let coachmark: { dismiss: () => void } | undefined = $state();
  let dragStart = $state<Date | null>(null);
  let dragEnd = $state<Date | null>(null);
  let dragging = $state(false);
  let pin = $state<{ x: number; y: number; from: Date; to: Date } | null>(null);
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  // Range bounds (always [lo, hi] regardless of drag direction)
  const dragLo = $derived(
    dragStart && dragEnd
      ? dragStart < dragEnd
        ? dragStart
        : dragEnd
      : null
  );
  const dragHi = $derived(
    dragStart && dragEnd
      ? dragStart < dragEnd
        ? dragEnd
        : dragStart
      : null
  );

  function inDragRange(d: Date): boolean {
    if (!dragLo || !dragHi) return false;
    return d >= dragLo && d <= dragHi;
  }

  function getDateFromPointer(e: PointerEvent): Date | null {
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const cell = el?.closest('[data-cell-date]') as HTMLElement | null;
    const iso = cell?.getAttribute('data-cell-date');
    return iso ? new Date(iso) : null;
  }

  function activate(day: Date, e: PointerEvent) {
    // First successful drag-select activation also dismisses the
    // coachmark — the user has now used the feature.
    coachmark?.dismiss();
    pin = null;
    dragStart = day;
    dragEnd = day;
    dragging = true;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* some browsers refuse pointer capture in odd states */
    }
  }

  function onCellPointerDown(e: PointerEvent, day: Date, isInMonth: boolean) {
    if (!isInMonth) return; // greyed cells are inert
    // No creating events in the past: past cells don't start a selection.
    if (day < startOfDay(new Date())) return;
    if (e.pointerType === 'touch') {
      // Long-press to disambiguate scroll from drag-select on touch.
      longPressTimer = setTimeout(() => activate(day, e), 400);
    } else {
      activate(day, e);
    }
  }

  function onCellPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const day = getDateFromPointer(e);
    if (!day) return;
    // A drag can't extend into the past — clamp at today.
    const today = startOfDay(new Date());
    dragEnd = day < today ? today : day;
  }

  function onCellPointerUp(e: PointerEvent) {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (!dragging) return;
    dragging = false;

    const lo = dragLo;
    const hi = dragHi;
    if (!lo || !hi) {
      dragStart = null;
      dragEnd = null;
      return;
    }

    // Pin position relative to the wrapper, tucked just below the
    // pointerup point.
    const rect = gridWrapper.getBoundingClientRect();
    pin = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top + 12,
      from: lo,
      to: hi
    };
  }

  function onCellPointerCancel() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    dragging = false;
  }

  function clearSelection() {
    pin = null;
    dragStart = null;
    dragEnd = null;
  }

  function confirmPin() {
    if (!pin) return;
    const fromIso = format(pin.from, 'yyyy-MM-dd');
    const toIso = format(pin.to, 'yyyy-MM-dd');
    if (onSelectionConfirmed) {
      onSelectionConfirmed(pin.from, pin.to);
    } else if (typeof window !== 'undefined') {
      window.location.href = `/events/create?from=${fromIso}&to=${toIso}`;
    }
    clearSelection();
  }

  // ESC dismisses the pin / drag selection.
  $effect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        clearSelection();
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        dragging = false;
      }
    }
    if (typeof document === 'undefined') return;
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Click-outside dismiss — when the pin is mounted, any pointerdown
  // that isn't on the pin itself OR on a grid cell (which would start
  // a fresh selection via the cell's own handler) clears the pin.
  // Capture phase so we run before stopPropagation handlers higher up.
  $effect(() => {
    if (!pin) return;
    function onOutside(e: PointerEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('.k-cal-pin')) return;
      if (t.closest('[data-cell-date]')) return;
      clearSelection();
    }
    if (typeof document === 'undefined') return;
    document.addEventListener('pointerdown', onOutside, true);
    return () => document.removeEventListener('pointerdown', onOutside, true);
  });
</script>

<div data-tour="cal-grid" class="px-4 md:px-9 lg:px-10 pb-6 relative" bind:this={gridWrapper}>
  <!-- DOW header -->
  <div
    class="grid grid-cols-7 border-b-[1.5px] border-ink"
    role="row"
  >
    {#each dowLabels as label, i (label)}
      <div
        class={`font-dmmono text-[10.5px] uppercase tracking-[0.12em] py-2 px-2 ${
          i >= 5 ? 'text-wine' : 'text-ink-mute'
        }`}
        role="columnheader"
      >
        {label}
      </div>
    {/each}
  </div>

  <!-- Grid cells -->
  <div
    class="grid grid-cols-7 border-l border-dashed border-rule select-none"
    style:grid-template-rows={`repeat(${rows}, minmax(96px, 1fr))`}
    style:touch-action="pan-y"
    role="rowgroup"
    onpointermove={onCellPointerMove}
    onpointerup={onCellPointerUp}
    onpointercancel={onCellPointerCancel}
  >
    {#each cells as cell, i (cell.toISOString())}
      {@const inMonth = isSameMonth(cell, visibleMonth)}
      <!-- `today` is scoped to the visible month on purpose: the grid pads
           the first/last week with adjacent-month days, so browsing August
           while it is Sep 6 used to paint the teal disc, the paper-warm
           cell tint AND the HEUTE badge onto a 35%-opacity spillover cell.
           All three are the same "you are here" marker, so all three are
           suppressed together — getting back to the real today is what the
           rail's HEUTE button is for. -->
      {@const today = isTodayDate(cell) && inMonth}
      {@const weekend = isWeekend(cell)}
      {@const dayEvents = sortEventsForDay(events.filter((ev) => eventCoversDay(ev, cell))).slice(0, 3)}
      {@const overflow = events.filter((ev) => eventCoversDay(ev, cell)).length - dayEvents.length}
      {@const inSel = inDragRange(cell)}
      <div
        data-cell-date={cell.toISOString()}
        onpointerdown={(e) => onCellPointerDown(e, cell, inMonth)}
        class={`relative border-r border-b border-dashed border-rule p-1.5 overflow-hidden flex flex-col gap-1 ${
          inSel
            ? 'bg-[repeating-linear-gradient(45deg,rgba(178,58,91,0.16)_0_6px,var(--k-paper-warm,#f7f0de)_6px_12px)]'
            : today
            ? 'bg-paper-warm'
            : weekend
            ? 'bg-wine/[0.025]'
            : ''
        } ${inMonth ? '' : 'opacity-35'} ${inMonth ? 'cursor-pointer' : ''}`}
        role="gridcell"
      >
        <!-- Date number row -->
        <div class="flex items-center justify-between">
          <span
            class={`font-bricolage tracking-[-0.02em] ${
              today
                ? 'inline-flex items-center justify-center w-[26px] h-[26px] rounded-full bg-teal text-paper border border-ink font-extrabold text-[18px]'
                : 'font-semibold text-[13px] text-ink'
            }`}
          >
            {cell.getDate()}
          </span>
          {#if today}
            <span class="font-dmmono text-[9px] tracking-[0.1em] text-teal">
              {$t['cal.cell.today']}
            </span>
          {/if}
        </div>

        <!-- Event pills -->
        <div class="flex flex-col gap-[2px] min-w-0">
          {#each dayEvents as ev (String(ev._id) + cell.toISOString())}
            {@const sStart = isSpanStart(ev, cell)}
            {@const sEnd = isSpanEnd(ev, cell)}
            {@const sMid = !sStart && !sEnd}
            <EventPill
              {ev}
              spanStart={sStart}
              spanMid={sMid}
              spanEnd={sEnd}
              isLive={isLiveNow(ev, $now)}
              {currentUserId}
              onclick={() => onPickEvent?.(ev)}
            />
          {/each}
          {#if overflow > 0}
            <button
              type="button"
              class="font-dmmono text-[9.5px] text-ink-mute px-1 text-left cursor-pointer hover:text-ink hover:underline underline-offset-2"
              onclick={() => onOpenDay?.(cell)}
              onpointerdown={(e) => e.stopPropagation()}
            >
              + {overflow} {$t['cal.events.more']}
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  {#if pin}
    <DragSelectPin
      x={pin.x}
      y={pin.y}
      from={pin.from}
      to={pin.to}
      onConfirm={confirmPin}
      onCancel={clearSelection}
    />
  {/if}

  <DragSelectCoachmark bind:this={coachmark} />

  <!-- Month nav footer: prev / live indicator / next.
       Per CD's design — DM Mono 10px, dashed top rule, full-width. -->
  {#if onPrevMonth || onNextMonth}
    <div
      class="mt-2 pt-2 flex justify-between items-center font-dmmono text-[10px] uppercase tracking-[0.05em] text-ink-mute border-t border-dashed border-rule"
    >
      <button
        type="button"
        onclick={onPrevMonth}
        disabled={!onPrevMonth}
        class="hover:text-ink transition-colors disabled:opacity-50"
      >
        ← {prevMonthLabel}
      </button>
      <span class="text-wine">
        {liveLine(liveCount)}
      </span>
      <button
        type="button"
        onclick={onNextMonth}
        disabled={!onNextMonth}
        class="hover:text-ink transition-colors disabled:opacity-50"
      >
        {nextMonthLabel} →
      </button>
    </div>
  {/if}
</div>
