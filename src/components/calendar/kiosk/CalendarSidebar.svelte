<script lang="ts">
  // Right rail for the agenda view: mini month nav + "GERADE LIVE"
  // card + italic kiez quote.
  // Per `kiosk-calendar-views.jsx:230–342`.

  import {
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    format,
    isSameMonth,
    isToday as isTodayDate,
    isSameDay
  } from 'date-fns';
  import { de as deLocale, enUS } from 'date-fns/locale';
  import { CATEGORIES } from '../../../lib/calendar/categories';
  import { eventCoversDay, isLiveNow } from '../../../lib/calendar/eventTime';
  import { now } from '../../../lib/calendar/nowTicker';
  import { t, locale } from '../../../lib/kiosk-i18n';
  import type { Event as EventDoc, EventCategory } from '../../../types';
  import StatusBadge from '../../forum/kiosk/StatusBadge.svelte';

  function inferBadge(ev: EventDoc | undefined) {
    if (!ev) return null;
    if (ev.moderationStatus === 'rejected') return 'rejected' as const;
    if (ev.isUserReported && ev.moderationStatus === 'pending') return 'reported' as const;
    if (ev.moderationStatus === 'pending') return 'pending' as const;
    if (ev.hasWarningLabel) return 'warning' as const;
    return null;
  }

  let {
    visibleMonth = new Date(),
    events = [],
    selectedDay,
    onPickDay
  } = $props<{
    visibleMonth?: Date;
    events?: EventDoc[];
    // Day view passes both: cells become buttons that jump the view to
    // the picked day, with the current day ring-highlighted. Agenda view
    // passes neither — the mini month stays a static reference there.
    selectedDay?: Date;
    onPickDay?: (day: Date) => void;
  }>();

  const dateLocale = $derived($locale === 'de' ? deLocale : enUS);

  const gridStart = $derived(
    startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 1 })
  );
  const gridEnd = $derived(
    endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 1 })
  );
  const cells = $derived(eachDayOfInterval({ start: gridStart, end: gridEnd }));
  const monthLabel = $derived(format(visibleMonth, 'MMMM yyyy', { locale: dateLocale }).toUpperCase());

  const liveEvent = $derived(events.find((ev) => isLiveNow(ev, $now)));

  function eventDotColor(d: Date): string | null {
    const ev = events.find((e) => eventCoversDay(e, d));
    if (!ev) return null;
    const cat = (ev.category ?? 'kiez') as EventCategory;
    return CATEGORIES[cat].bgClass;
  }
</script>

<aside
  class="hidden lg:block bg-paper-soft border-l border-dashed border-rule lg:-mr-10 lg:pr-8 px-6 py-7"
>
  <!-- Mini month -->
  <div class="mb-5 pl-4 pr-8">
    <div class="font-dmmono text-[10px] uppercase tracking-[0.12em] text-teal mb-2.5">
      ◆ {monthLabel}
    </div>
    <div class="grid grid-cols-7 gap-[2px] font-dmmono text-[9.5px]">
      {#each ($locale === 'de' ? ['M','D','M','D','F','S','S'] : ['M','T','W','T','F','S','S']) as label, i (`${label}-${i}`)}
        <div class="text-ink-mute py-0.5 text-center tracking-[0.05em]">{label}</div>
      {/each}
      {#each cells as d (d.toISOString())}
        {@const inMonth = isSameMonth(d, visibleMonth)}
        {@const today = isTodayDate(d)}
        {@const selected = selectedDay != null && isSameDay(d, selectedDay)}
        {@const dotClass = eventDotColor(d)}
        <svelte:element
          this={onPickDay ? 'button' : 'div'}
          type={onPickDay ? 'button' : undefined}
          onclick={onPickDay ? () => onPickDay(d) : undefined}
          class={`relative py-1 text-center ${
            today
              ? 'bg-teal text-paper border border-ink rounded-[4px] font-bold'
              : selected
              ? 'border border-wine rounded-[4px] font-bold text-wine'
              : 'text-ink'
          } ${inMonth ? '' : 'opacity-30'} ${onPickDay ? 'cursor-pointer hover:bg-wine/10 rounded-[4px]' : ''}`}
        >
          {d.getDate()}
          {#if dotClass && !today}
            <div
              class={`absolute left-1/2 -translate-x-1/2 bottom-0 w-1 h-1 rounded-full ${dotClass}`}
              aria-hidden="true"
            ></div>
          {/if}
        </svelte:element>
      {/each}
    </div>
  </div>

  <!-- LIVE NOW card -->
  {#if liveEvent}
    {@const liveCat = (liveEvent.category ?? 'kiez') as EventCategory}
    {@const liveStyle = CATEGORIES[liveCat]}
    <div class="mb-5 pl-4 pr-8">
      <div
        class="flex items-center gap-1.5 font-dmmono text-[10px] uppercase tracking-[0.12em] text-ochre mb-2"
      >
        <span class="w-[6px] h-[6px] rounded-full bg-ochre border border-ink k-cal-live-dot" aria-hidden="true"></span>
        ◆ {$t['cal.agenda.live.kicker']}
      </div>
      <div
        class="bg-paper border-2 border-ochre rounded-md px-3.5 py-3 shadow-[2px_2px_0_var(--k-ochre,#e8a53a)]"
      >
        <div class="flex items-center flex-wrap gap-1.5 mb-1">
          <span class={`font-dmmono text-[10px] tracking-[0.1em] ${liveStyle.textClass}`}>
            {liveStyle.glyph} {$t[`cal.cat.${liveCat}.label` as const]?.toUpperCase()}
          </span>
          {#if inferBadge(liveEvent)}
            <StatusBadge state={inferBadge(liveEvent)!} size="sm" />
          {/if}
        </div>
        <div class="font-bricolage font-bold text-[14px] leading-[1.2] mb-1">
          {liveEvent.title}
        </div>
        {#if liveEvent.location}
          <div class="font-instrument italic text-[11.5px] text-ink-mute">
            {liveEvent.location}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Quote -->
  <div
    class="bg-paper-warm border border-dashed border-rule rounded-sm px-3 py-2.5 font-instrument italic text-[11.5px] text-ink-soft leading-[1.5]"
  >
    {$t['cal.agenda.quote']}
  </div>
</aside>
