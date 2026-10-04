<script lang="ts">
  // Agenda view — list of events grouped by day, with the editorial
  // sidebar on the right (lg+). Today's day group is rendered as a
  // dark ink-fill card per CD's design; past days collapse behind a
  // "show past" toggle (default off).

  import { isSameDay, startOfDay, isBefore, format } from 'date-fns';
  import { de as deLocale, enUS } from 'date-fns/locale';

  import AgendaDayHeader from './AgendaDayHeader.svelte';
  import AgendaRow from './AgendaRow.svelte';
  import CalendarSidebar from './CalendarSidebar.svelte';

  import { isLiveNow } from '../../../lib/calendar/eventTime';
  import { groupAgenda } from '../../../lib/calendar/agendaGroups';
  import { now } from '../../../lib/calendar/nowTicker';
  import { CATEGORIES } from '../../../lib/calendar/categories';
  import { t, locale } from '../../../lib/kiosk-i18n';
  import type { Event as EventDoc, EventCategory } from '../../../types';

  let {
    events = [],
    visibleMonth = new Date(),
    onPickEvent,
    savedIds = new Set<string>(),
    onToggleSave,
    currentUserId = null
  } = $props<{
    events?: EventDoc[];
    visibleMonth?: Date;
    onPickEvent?: (ev: EventDoc) => void;
    savedIds?: Set<string>;
    onToggleSave?: (eventId: string) => void;
    currentUserId?: string | null;
  }>();

  let showPast = $state(false);

  const todayStart = $derived(startOfDay(new Date()));

  // Events under their start day. A multi-day event that started earlier and
  // still covers a listed day is that day's `running` (see groupAgenda): full
  // rows under today, ONE slim line each under any other day — so a month-long
  // event is visible on every day without filling the list.
  const grouped = $derived(groupAgenda(events as EventDoc[], todayStart));

  // „bis 31. Okt." on the slim line.
  function untilLabel(ev: EventDoc): string {
    const end = ev.endDate instanceof Date ? ev.endDate : new Date(ev.endDate);
    const d = format(end, $locale === 'de' ? 'd. MMM' : 'MMM d', { locale: $locale === 'de' ? deLocale : enUS });
    return $t['cal.agenda.until'].replace('{d}', d);
  }
  const pastGroups = $derived(grouped.filter((g) => isBefore(g.day, todayStart)));
  const visibleGroups = $derived(
    showPast ? grouped : grouped.filter((g) => !isBefore(g.day, todayStart))
  );
  const pastCount = $derived(
    pastGroups.reduce((sum, g) => sum + g.events.length, 0)
  );
</script>

<div data-tour="cal-rsvp" class="grid grid-cols-1 lg:grid-cols-[1fr_320px] lg:gap-0">
  <!-- Agenda list -->
  <div class="px-4 md:px-9 lg:px-10 py-3">
    {#if pastCount > 0}
      <div class="flex justify-end mb-1">
        <button
          type="button"
          onclick={() => (showPast = !showPast)}
          aria-pressed={showPast}
          class="inline-flex items-center gap-1 font-dmmono text-[10px] uppercase tracking-[0.1em] text-ink-mute hover:text-ink transition-colors"
        >
          <span aria-hidden="true">{showPast ? '↑' : '↓'}</span>
          {showPast ? $t['cal.agenda.past.hide'] : $t['cal.agenda.past.show'].replace('{n}', String(pastCount))}
        </button>
      </div>
    {/if}

    {#if visibleGroups.length === 0}
      <p class="font-instrument italic text-[16px] text-ink-mute py-6">
        {$t['cal.agenda.quote']}
      </p>
    {:else}
      {#each visibleGroups as g (g.day.toISOString())}
        {@const isTodayGroup = isSameDay(g.day, todayStart)}
        {@const total = g.events.length + g.running.length}
        {#if isTodayGroup}
          {@const todayRows = [...g.running, ...g.events]}
          {@const liveCount = todayRows.filter((e) => isLiveNow(e, $now)).length}
          {@const termLabel = total === 1
            ? $t['cal.agenda.term.one']
            : $t['cal.agenda.term.many']}
          <!-- Whole today row (date column + events) sits inside one dark block.
               Mobile stacks vertically (date header on top, events below);
               desktop uses a 2-col grid with a vertical dashed separator. -->
          <div
            class="bg-ink rounded-md shadow-[3px_3px_0_var(--k-wine,#b23a5b)] mb-4 px-4 py-1 flex flex-col gap-1 lg:grid lg:grid-cols-[140px_1fr] lg:gap-4 lg:items-stretch"
          >
            <AgendaDayHeader day={g.day} eventCount={total} />
            <div class="border-t border-dashed border-paper/30 pt-2 lg:border-t-0 lg:border-l lg:pl-4 lg:pt-0 self-stretch">
              <div class="font-dmmono text-[10px] uppercase tracking-[0.1em] text-paper/60 pb-1 lg:pt-2">
                {total} {termLabel}{#if liveCount > 0}
                  <span class="text-ochre"> · {liveCount} {$t['cal.agenda.today.running']}</span>
                {/if}
              </div>
              {#each todayRows as ev (String(ev._id))}
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
            </div>
          </div>
        {:else}
          <div class="flex flex-col gap-2 mb-4 lg:grid lg:grid-cols-[140px_1fr] lg:gap-5 lg:items-start">
            <AgendaDayHeader day={g.day} eventCount={total} />
            <div class="flex flex-col gap-3">
              <!-- Still running from an earlier day: one slim line each (opens the event). -->
              {#each g.running as ev (String(ev._id))}
                {@const runStyle = CATEGORIES[(ev.category ?? 'kiez') as EventCategory]}
                <button
                  type="button"
                  data-agenda-running
                  onclick={() => onPickEvent?.(ev)}
                  class={`w-full min-h-[40px] text-left bg-paper border-[1.5px] border-dashed ${runStyle.borderClass} rounded-md px-3 py-1.5 flex items-center gap-2 hover:bg-paper-warm transition-colors ${ev.moderationStatus === 'pending' || ev.moderationStatus === 'rejected' ? 'opacity-60' : ''}`}
                >
                  <span class={`shrink-0 w-2 h-2 rounded-[2px] ${runStyle.bgClass}`} aria-hidden="true"></span>
                  <span class="shrink-0 font-dmmono text-[10px] uppercase tracking-[0.08em] text-ink-mute">
                    {ev.allDay ? $t['cal.allDay'] : $t['cal.agenda.ongoing']}
                  </span>
                  <span class="min-w-0 flex-1 truncate font-bricolage font-semibold text-[13.5px] tracking-[-0.01em] text-ink">{ev.title}</span>
                  <span class="shrink-0 font-dmmono text-[10px] uppercase tracking-[0.08em] text-ink-mute">{untilLabel(ev)}</span>
                </button>
              {/each}
              {#each g.events as ev (String(ev._id))}
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
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <CalendarSidebar {visibleMonth} {events} />
</div>
