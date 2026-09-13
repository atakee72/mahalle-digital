<script lang="ts">
  // Single agenda event row — 4-column grid:
  //   time | colored rule | body | RSVP+details CTA
  // Per `kiosk-calendar-views.jsx:13–133`.

  import { format } from 'date-fns';
  import { de as deLocale, enUS } from 'date-fns/locale';
  import { CATEGORIES } from '../../../lib/calendar/categories';
  import { eventSpanDays, isLiveNow } from '../../../lib/calendar/eventTime';
  import { now } from '../../../lib/calendar/nowTicker';
  import { t, locale } from '../../../lib/kiosk-i18n';
  import { shortenUrlsInText } from '../../../lib/linkify';
  import { rsvpMutation } from '../../../lib/calendarMutations';
  import { showError } from '../../../utils/toast';
  import StatusBadge from '../../forum/kiosk/StatusBadge.svelte';
  import type { Event as EventDoc, EventCategory } from '../../../types';

  let {
    ev,
    onPick,
    onRsvp,
    today = false,
    isSaved = false,
    onToggleSave,
    currentUserId = null
  } = $props<{
    ev: EventDoc;
    onPick?: (ev: EventDoc) => void;
    onRsvp?: (ev: EventDoc) => void;
    today?: boolean;
    isSaved?: boolean;
    onToggleSave?: () => void;
    currentUserId?: string | null;
  }>();

  // Direct RSVP toggle for the round +/✓ button in the agenda action
  // column. Going ↔ cancel only; the modal handles maybe.
  // Initial-value capture is deliberate: currentUserId comes from the SSR
  // session and never changes within a page's lifetime.
  // svelte-ignore state_referenced_locally
  const rsvp = rsvpMutation(currentUserId ?? '__anon__');

  const isGoing = $derived.by(() => {
    if (!currentUserId) return false;
    const arr = (ev.rsvps?.going ?? []).map(String);
    return arr.includes(currentUserId);
  });

  function toggleRsvp() {
    if (!currentUserId) return;
    const eventId = String(ev._id);
    const next: 'going' | 'cancel' = isGoing ? 'cancel' : 'going';
    rsvp.mutate(
      { eventId, status: next },
      {
        onError: (err) => {
          showError(err instanceof Error ? err.message : 'RSVP fehlgeschlagen.');
        }
      }
    );
  }

  const dateLocale = $derived($locale === 'de' ? deLocale : enUS);
  const cat = $derived((ev.category ?? 'kiez') as EventCategory);
  const style = $derived(CATEGORIES[cat]);

  const start = $derived(ev.startDate instanceof Date ? ev.startDate : new Date(ev.startDate));
  const end = $derived(ev.endDate instanceof Date ? ev.endDate : new Date(ev.endDate));

  const startTime = $derived(
    ev.allDay ? $t['cal.allDay'] : format(start, 'HH:mm', { locale: dateLocale })
  );
  const endTime = $derived(ev.allDay ? '' : format(end, 'HH:mm', { locale: dateLocale }));

  const span = $derived(eventSpanDays(ev));
  const live = $derived(isLiveNow(ev, $now));

  const goingCount = $derived(ev.rsvps?.going?.length ?? 0);
  const maybeCount = $derived(ev.rsvps?.maybe?.length ?? 0);
  const isSoldOut = $derived(
    typeof ev.capacity === 'number' && ev.capacity > 0 && goingCount >= ev.capacity
  );

  const author = $derived(
    typeof ev.author === 'object' && ev.author !== null && 'name' in ev.author
      ? (ev.author as any).name
      : null
  );

  function categoryLabel(c: EventCategory): string {
    return $t[`cal.cat.${c}.label` as const] as string;
  }

  // Moderation badge — same precedence as forum cards
  // (ForumPostCard.svelte:167-173). Author lands here after submitting
  // their own pending event; community-reported pending events stay
  // visible to everyone with a small ⚑ chip.
  const inferredBadge = $derived(
    ev.moderationStatus === 'rejected' ? 'rejected'
    : ev.isUserReported && ev.moderationStatus === 'pending' ? 'reported'
    : ev.moderationStatus === 'pending' ? 'pending'
    : ev.hasWarningLabel ? 'warning'
    : null
  );

  // Ghosting for the author's own pending/reported/rejected events —
  // dashed-color outline + reduced body opacity. Mirrors the forum index
  // wrapper at ForumIndexInner.svelte:480/500/520. Non-authors get a
  // clean row (their visibility is already gated by buildModerationFilter
  // for own-pending/rejected; reported-pending stays visible to all but
  // only the author sees the ghosting).
  const authorId = $derived.by(() => {
    const a = ev.author as any;
    if (!a) return null;
    if (typeof a === 'string') return a;
    if (a._id) return typeof a._id === 'string' ? a._id : a._id.toString?.() ?? null;
    return null;
  });
  const isAuthor = $derived(!!currentUserId && currentUserId === authorId);
  const ghostState = $derived.by(() => {
    if (!isAuthor) return null;
    if (ev.moderationStatus === 'rejected') return 'rejected' as const;
    if (ev.isUserReported && ev.moderationStatus === 'pending') return 'reported' as const;
    if (ev.moderationStatus === 'pending') return 'pending' as const;
    return null;
  });
  const ghostOutline = $derived(
    ghostState === 'rejected' ? 'outline outline-2 outline-dashed outline-danger outline-offset-[-2px] rounded-md'
    : ghostState === 'reported' ? 'outline outline-2 outline-dashed outline-plum outline-offset-[-2px] rounded-md'
    : ghostState === 'pending' ? 'outline outline-2 outline-dashed outline-warn outline-offset-[-2px] rounded-md'
    : ''
  );
  const ghostBodyOpacity = $derived(ghostState ? 'opacity-70' : '');
</script>

{#if today}
  <!-- ─── Today variant: compact row inside the dark block ─── -->
  <article
    class={`grid grid-cols-[72px_1fr_auto] gap-3 items-stretch py-2 ${ghostOutline} ${ghostState ? 'pl-2 pr-2' : ''}`}
  >
    <!-- Time column — start hour, with ochre dot inline if live -->
    <div class="pt-0.5">
      <div
        class="flex items-center gap-1.5 font-dmmono font-semibold text-[13px] tracking-[-0.01em] text-paper"
      >
        <span>{startTime}</span>
        {#if live}
          <span
            class="inline-block w-[10px] h-[10px] rounded-full bg-ochre border border-ink k-cal-live-dot shrink-0"
            aria-label={$t['cal.live.label']}
          ></span>
        {/if}
      </div>
    </div>

    <!-- Body — under ghosting, location/meta fades; title + badge stay sharp. -->
    <div class="min-w-0">
      <div class="flex items-center flex-wrap gap-1.5 mb-1">
        <span
          class={`inline-flex items-center px-2 py-0.5 rounded font-dmmono font-semibold uppercase tracking-[0.1em] text-[10px] ${style.bgClass} ${style.textOnFill}`}
        >
          {categoryLabel(cat)}
        </span>
        {#if span > 1}
          <span class="font-dmmono uppercase text-[9.5px] tracking-[0.05em] px-[5px] py-px border rounded-[3px] text-paper/60 border-paper/30">
            {span} {$t['cal.span.days']}
          </span>
        {/if}
        {#if inferredBadge}
          <StatusBadge state={inferredBadge} size="sm" />
        {/if}
      </div>

      <h4 class="font-bricolage font-bold text-[16.5px] tracking-[-0.018em] leading-[1.2] mb-1 [text-wrap:balance] text-paper">
        <button
          type="button"
          onclick={() => onPick?.(ev)}
          class="text-left hover:underline decoration-wine underline-offset-2"
        >
          {ev.title}
        </button>
      </h4>

      {#if ev.location}
        <div class={`font-dmmono uppercase tracking-[0.06em] text-[9.5px] text-paper/70 mb-1 ${ghostBodyOpacity}`}>
          {ev.location}{#if author} · {$locale === 'de' ? 'VON' : 'BY'} {author}{/if}
        </div>
      {/if}
    </div>

    <!-- RSVP slot — sold-out red pill or round +/✓ toggle + save icon.
         Dotted separator on the left matches the dashed separator
         between the date column and the events block. -->
    <div class="flex flex-col gap-1.5 items-end justify-center border-l border-dotted border-paper/40 pl-3 self-stretch py-1">
      {#if isSoldOut}
        <span
          class="inline-flex items-center px-2.5 py-1 rounded-full bg-wine text-paper font-dmmono uppercase tracking-[0.06em] font-semibold text-[10px] border-2 border-paper"
        >
          {$t['cal.event.soldOut']}
        </span>
      {:else if currentUserId}
        <button
          type="button"
          onclick={toggleRsvp}
          aria-pressed={isGoing}
          aria-label={isGoing ? $t['cal.mobile.rsvp.cancel.aria'] : $t['cal.mobile.rsvp.going.aria']}
          title={isGoing ? $t['cal.mobile.rsvp.cancel.aria'] : $t['cal.agenda.row.rsvp']}
          class={`shrink-0 w-9 h-9 rounded-full border-[1.5px] border-paper flex items-center justify-center font-bricolage font-bold text-[16px] leading-none transition-colors ${
            isGoing ? 'bg-moss text-paper border-moss' : 'bg-transparent text-paper hover:bg-paper/10'
          }`}
        >
          {isGoing ? '✓' : '+'}
        </button>
      {/if}
      {#if onToggleSave}
        <button
          type="button"
          onclick={onToggleSave}
          aria-pressed={isSaved}
          aria-label={$t['cal.agenda.row.save']}
          title={$t['cal.agenda.row.save']}
          class={`shrink-0 w-9 h-9 rounded-full border-[1.5px] border-paper flex items-center justify-center transition-colors ${
            isSaved ? 'bg-paper text-ink' : 'bg-transparent text-paper hover:bg-paper/10'
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke="currentColor"
            fill={isSaved ? 'currentColor' : 'none'}
            aria-hidden="true"
          >
            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
          </svg>
        </button>
      {/if}
    </div>
  </article>
{:else}
  <!-- ─── Paper card variant: full CD treatment with body + dashed action column ─── -->
  <article class={`flex items-stretch ${ghostOutline}`}>
    <!-- Colored category band on the left edge of the card -->
    <div
      class={`${style.bgClass} w-[6px] self-stretch shrink-0`}
      aria-hidden="true"
    ></div>

    <!-- Body -->
    <div class="flex-1 min-w-0 py-3.5 pl-4">
      <div class="flex items-center flex-wrap gap-2 mb-1.5">
        <span
          class={`inline-flex items-center px-2 py-0.5 rounded font-dmmono font-semibold uppercase tracking-[0.1em] text-[10px] ${style.bgClass} ${style.textOnFill}`}
        >
          {categoryLabel(cat)}
        </span>
        {#if span > 1}
          <span class="font-dmmono uppercase text-[9.5px] tracking-[0.05em] text-ink-mute">
            {span} {$t['cal.span.days']}
          </span>
        {/if}
        {#if inferredBadge}
          <StatusBadge state={inferredBadge} size="sm" />
        {/if}
      </div>

      <h4 class="font-bricolage font-bold text-[18px] tracking-[-0.018em] leading-[1.2] mb-1 [text-wrap:balance] text-ink">
        <button
          type="button"
          onclick={() => onPick?.(ev)}
          class="text-left hover:underline decoration-wine underline-offset-2"
        >
          {ev.title}
        </button>
      </h4>

      <!-- Meta line: time + location + organizer.
           Meta + body fade under ghosting; title + badge stay sharp. -->
      <div class={`font-dmmono text-[11px] text-ink-soft mb-1.5 flex items-center flex-wrap gap-x-1.5 gap-y-0.5 ${ghostBodyOpacity}`}>
        <span class="font-semibold text-ink">
          {ev.allDay ? $t['cal.allDay'] : startTime}
        </span>
        {#if live}
          <span
            class="inline-block w-[8px] h-[8px] rounded-full bg-ochre border border-ink k-cal-live-dot shrink-0"
            aria-label={$t['cal.live.label']}
          ></span>
        {/if}
        {#if ev.location}
          <span aria-hidden="true">↳</span>
          <span class="text-ink">{ev.location}</span>
        {/if}
        {#if author}
          <span>· {author}</span>
        {/if}
      </div>

      {#if ev.body}
        <p class={`font-bricolage text-[13px] text-ink-soft leading-[1.4] mb-1.5 line-clamp-2 [text-wrap:pretty] ${ghostBodyOpacity}`}>
          {shortenUrlsInText(ev.body)}
        </p>
      {/if}

      {#if goingCount > 0}
        <div class={`font-dmmono text-[10.5px] text-ink-mute ${ghostBodyOpacity}`}>
          {goingCount} {$t['cal.agenda.row.confirmed']}
        </div>
      {/if}
    </div>

    <!-- Action column with dashed left separator. Round +/✓ for RSVP,
         round ☆/★ for save. Sold-out events show the red pill instead
         of the RSVP toggle. -->
    <div class="shrink-0 flex flex-col gap-1.5 justify-center border-l border-dashed border-rule py-3.5 pl-4 pr-4 ml-4">
      {#if isSoldOut}
        <span
          class="inline-flex items-center justify-center px-3 py-1 rounded-full bg-wine text-paper font-dmmono uppercase tracking-[0.06em] font-semibold text-[10px] border-2 border-ink"
        >
          {$t['cal.event.soldOut']}
        </span>
      {:else if currentUserId}
        <button
          type="button"
          onclick={toggleRsvp}
          aria-pressed={isGoing}
          aria-label={isGoing ? $t['cal.mobile.rsvp.cancel.aria'] : $t['cal.mobile.rsvp.going.aria']}
          title={isGoing ? $t['cal.mobile.rsvp.cancel.aria'] : $t['cal.agenda.row.rsvp']}
          class={`shrink-0 w-9 h-9 rounded-full border-[1.5px] border-ink flex items-center justify-center font-bricolage font-bold text-[16px] leading-none transition-colors ${
            isGoing ? 'bg-moss text-paper' : 'bg-paper text-ink hover:bg-paper-warm'
          }`}
        >
          {isGoing ? '✓' : '+'}
        </button>
      {/if}
      {#if onToggleSave}
        <button
          type="button"
          onclick={onToggleSave}
          aria-pressed={isSaved}
          aria-label={$t['cal.agenda.row.save']}
          title={$t['cal.agenda.row.save']}
          class={`shrink-0 w-9 h-9 rounded-full border-[1.5px] border-ink flex items-center justify-center transition-colors ${
            isSaved ? 'bg-ink text-paper' : 'bg-paper text-ink hover:bg-paper-warm'
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke="currentColor"
            fill={isSaved ? 'currentColor' : 'none'}
            aria-hidden="true"
          >
            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
          </svg>
        </button>
      {/if}
    </div>
  </article>
{/if}
