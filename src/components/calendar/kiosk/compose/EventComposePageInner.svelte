<script lang="ts">
  // /events/create logic island — mirrors `forum/kiosk/compose/
  // ComposePageInner.svelte` but for events. Submit flow:
  //
  //   1. validate
  //   2. compose ISO startDate / endDate from date+time strings
  //   3. createEventMutation → POST /api/events/create
  //   4. on success → clearDraft + navigate to /calendar
  //   5. on RateLimitError → swap form for RateLimitPanel
  //   6. on other errors → surface inline below publish button
  //
  // Pre-fill from URL search params (?from=YYYY-MM-DD&to=YYYY-MM-DD&
  // allDay=1) handed off by the drag-select pin.

  import EventComposeForm, {
    type EventComposeValues
  } from './EventComposeForm.svelte';
  import EventComposePreview from './EventComposePreview.svelte';
  import EventComposeMiniPreview from './EventComposeMiniPreview.svelte';
  import EventComposeStickyPublish from './EventComposeStickyPublish.svelte';
  import ModeratingModal from '../../../forum/kiosk/compose/ModeratingModal.svelte';
  import KioskBtn from '../../../forum/kiosk/KioskBtn.svelte';
  import RateLimitPanel from '../../../forum/kiosk/states/RateLimitPanel.svelte';

  import {
    createEventMutation,
    editEventMutation,
    RateLimitError
  } from '../../../../lib/calendarMutations';
  import { eventDraft, type EventDraftValues } from '../../../../lib/eventDraftStore';
  import { t } from '../../../../lib/kiosk-i18n';
  import { showToast, showSuccess } from '../../../../utils/toast';
  import type { EventCategory, Event as EventDoc } from '../../../../types';

  let {
    currentUser,
    mode = 'create',
    initialEvent
  } = $props<{
    currentUser: { id: string; name?: string; image?: string | null };
    mode?: 'create' | 'edit';
    initialEvent?: EventDoc;
  }>();

  // svelte-ignore state_referenced_locally
  const isEditing = mode === 'edit';

  // ─── Initial values — computed synchronously at script-top.
  // This component runs client-only (`client:only="svelte"` on the
  // Astro page), so `window` is always available at instantiation;
  // we don't need to defer to onMount. Computing synchronously here
  // means EventComposeForm's `$state` seeders fire with the right
  // values on first render.
  function computeInitialValues(): Partial<EventComposeValues> {
    // Edit mode wins outright — populate from the existing event,
    // never read URL prefill or draft store.
    if (isEditing && initialEvent) {
      const start = new Date(initialEvent.startDate as any);
      const end = new Date(initialEvent.endDate as any);
      const pad = (n: number) => n.toString().padStart(2, '0');
      const dateStr = (d: Date) =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const timeStr = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      return {
        title: initialEvent.title ?? '',
        body: initialEvent.body ?? '',
        category: (initialEvent.category ?? 'kiez') as EventCategory,
        startDate: dateStr(start),
        startTime: initialEvent.allDay ? '00:00' : timeStr(start),
        endDate: dateStr(end),
        endTime: initialEvent.allDay ? '23:59' : timeStr(end),
        allDay: !!initialEvent.allDay,
        location: initialEvent.location ?? '',
        capacity: initialEvent.capacity ?? null,
        visibility: (initialEvent.visibility ?? 'public') as 'public' | 'private',
        tags: initialEvent.tags ?? []
      };
    }

    const search =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams();
    const from = search.get('from');
    const to = search.get('to');
    const allDayParam = search.get('allDay') === '1';
    // Event-clipper / external prefill (Aug 2026): title/body/location can
    // arrive alongside (or without) the drag-select date params. ANY prefill
    // param present → the URL wins over the draft store, same rule as `from`.
    // Length caps are defensive — URL values are caller-controlled.
    const titleParam = search.get('title');
    const bodyParam = search.get('body');
    const locationParam = search.get('location');
    // Clipper v2: optional HH:MM times (e.g. from <time datetime> fallback).
    // Invalid values are dropped so the form's next-full-hour defaults apply.
    const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
    const startTimeParam = search.get('startTime');
    const endTimeParam = search.get('endTime');

    let saved: EventDraftValues | null = null;
    eventDraft.subscribe((v) => (saved = v))();

    if (from || titleParam !== null || bodyParam !== null || locationParam !== null) {
      return {
        title: (titleParam ?? '').slice(0, 200),
        body: (bodyParam ?? '').slice(0, 3000),
        category: 'kiez',
        ...(from ? { startDate: from, endDate: to ?? from } : {}),
        ...(startTimeParam && HHMM.test(startTimeParam) ? { startTime: startTimeParam } : {}),
        ...(endTimeParam && HHMM.test(endTimeParam) ? { endTime: endTimeParam } : {}),
        allDay: allDayParam,
        location: (locationParam ?? '').slice(0, 200),
        capacity: null,
        visibility: 'public',
        tags: []
      };
    }
    if (saved) {
      const s = saved as EventDraftValues;
      return {
        title: s.title,
        body: s.body,
        category: s.category,
        startDate: s.startDate,
        startTime: s.startTime,
        endDate: s.endDate,
        endTime: s.endTime,
        allDay: s.allDay,
        location: s.location,
        capacity: s.capacity,
        visibility: s.visibility ?? 'public',
        tags: s.tags
      };
    }
    return {};
  }

  const initialValues: Partial<EventComposeValues> = computeInitialValues();

  // Event-clipper v5: the /events/clip landing sets ?clipMiss=1 when the
  // model + markup fallback found no date at all — surfaced as a notice
  // above the form (state declared next to inlineError below).
  const clipMissParam =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('clipMiss') === '1';

  // ─── Form values ─────────────────────────────────────────────────
  // Seed from initialValues so the preview rail matches first-paint
  // (otherwise edit mode would briefly show today's date until the
  // form's onChange fires).
  let values = $state<EventComposeValues>({
    title: initialValues.title ?? '',
    body: initialValues.body ?? '',
    category: (initialValues.category ?? 'kiez') as EventCategory,
    startDate: initialValues.startDate ?? new Date().toISOString().slice(0, 10),
    startTime: initialValues.startTime ?? '09:00',
    endDate: initialValues.endDate ?? new Date().toISOString().slice(0, 10),
    endTime: initialValues.endTime ?? '17:00',
    allDay: initialValues.allDay ?? false,
    location: initialValues.location ?? '',
    capacity: initialValues.capacity ?? null,
    visibility: initialValues.visibility ?? 'public',
    tags: initialValues.tags ?? []
  });

  // Auto-save debounced — same pattern as forum compose.
  // Skipped entirely in edit mode: drafts are scoped to the create flow.
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    if (isEditing) return;
    const snapshot: EventDraftValues = {
      title: values.title,
      body: values.body,
      category: values.category,
      startDate: values.startDate,
      startTime: values.startTime,
      endDate: values.endDate,
      endTime: values.endTime,
      allDay: values.allDay,
      location: values.location,
      capacity: values.capacity,
      visibility: values.visibility,
      tags: values.tags
    };
    if (!snapshot.title && !snapshot.body && !snapshot.location) return;
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => eventDraft.setDraft(snapshot), 500);
    return () => {
      if (draftTimer) clearTimeout(draftTimer);
    };
  });

  function handleChange(next: EventComposeValues) {
    values = next;
  }

  // ─── Mutation ───────────────────────────────────────────────────
  const create = createEventMutation();
  const edit = editEventMutation();

  let submitting = $state(false);
  let modalOpen = $state(false);
  let rateLimited = $state(false);
  let inlineError = $state<string | null>(null);
  let clipMiss = $state(clipMissParam);

  function validate(v: EventComposeValues): string | null {
    if (v.title.trim().length < 5) return 'Titel zu kurz (mind. 5 Zeichen).';
    if (v.title.length > 200) return 'Titel zu lang.';
    if (v.body.trim().length < 10) return 'Beschreibung zu kurz (mind. 10 Zeichen).';
    if (!v.startDate || !v.endDate) return 'Datum fehlt.';
    return null;
  }

  // Compose ISO datetime strings from the date+time inputs.
  function composeIso(date: string, time: string, allDay: boolean): string {
    if (allDay) return `${date}T00:00:00.000Z`;
    return new Date(`${date}T${time || '00:00'}`).toISOString();
  }

  async function onPublish() {
    if (submitting) return;
    inlineError = null;
    const err = validate(values);
    if (err) {
      inlineError = err;
      return;
    }

    submitting = true;
    modalOpen = true;
    try {
      const startISO = composeIso(values.startDate, values.startTime, values.allDay);
      const endISO = values.allDay
        ? new Date(`${values.endDate}T23:59:59.000Z`).toISOString()
        : composeIso(values.endDate, values.endTime, false);

      const payload = {
        title: values.title.trim(),
        body: values.body.trim(),
        startDate: startISO,
        endDate: endISO,
        category: values.category,
        capacity: values.capacity ?? null,
        allDay: values.allDay,
        visibility: values.visibility,
        location: values.location.trim() || undefined,
        tags: values.tags
      };

      const result = isEditing && initialEvent
        ? await edit.mutateAsync({ id: String(initialEvent._id), input: payload })
        : await create.mutateAsync(payload);

      if (!isEditing) eventDraft.clearDraft();
      modalOpen = false;

      // Toast: dispatched onto window now, but the full-page redirect
      // tears down the toast listener immediately. The flash query on
      // the next page (CalendarPageInner) re-fires the toast on mount
      // so the user actually sees it post-redirect.
      if (result?.moderationStatus === 'pending') {
        showToast(
          result.message ||
            ($t[isEditing ? 'compose.toast.editPending' : 'compose.toast.pending'] as string),
          { type: 'info', duration: 6000 }
        );
      } else {
        showSuccess(
          $t[isEditing ? 'compose.toast.editApproved' : 'compose.toast.approved'] as string
        );
      }

      if (typeof window !== 'undefined') {
        const flash = isEditing
          ? result?.moderationStatus === 'pending'
            ? 'just_edited=pending'
            : 'just_edited=1'
          : 'just_posted=1';
        window.location.href = `/calendar?${flash}`;
      }
    } catch (caught) {
      modalOpen = false;
      submitting = false;
      if (caught instanceof RateLimitError) {
        rateLimited = true;
      } else if (
        isEditing &&
        caught instanceof Error &&
        caught.message === 'edit_blocked_by_moderation'
      ) {
        inlineError = $t['compose.error.editBlocked'] as string;
      } else {
        inlineError =
          caught instanceof Error ? caught.message : 'Veröffentlichen fehlgeschlagen.';
      }
    }
  }

  function onDiscard() {
    if (!isEditing) eventDraft.clearDraft();
    if (typeof window !== 'undefined') window.location.href = '/calendar';
  }
</script>

{#if rateLimited}
  <RateLimitPanel unlocksIn={null} />
{:else}
  {#if clipMiss}
    <div class="px-4 md:px-9 lg:px-10 pt-5">
      <p class="font-bricolage text-sm px-3.5 py-2 rounded-md border" style="color: var(--k-ink); background: color-mix(in srgb, var(--k-ochre) 18%, transparent); border-color: var(--k-ochre);" role="status">
        {$t['cal.compose.clip.miss']}
      </p>
    </div>
  {/if}

  <div
    class="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-0 min-h-[calc(100vh-180px)]"
  >
    <EventComposeForm
      {initialValues}
      onChange={handleChange}
      showBreadcrumb={true}
      editing={isEditing}
    />
    <EventComposePreview
      {values}
      submitting={submitting}
      onPublish={onPublish}
      onDiscard={onDiscard}
      editing={isEditing}
    />
  </div>

  {#if inlineError}
    <div class="px-4 md:px-9 lg:px-10 pb-6">
      <p
        class="font-bricolage text-sm text-danger px-3.5 py-2 bg-danger/10 border border-danger rounded-md"
        role="alert"
      >
        {inlineError}
      </p>
    </div>
  {/if}

  <!-- Mobile flow: mini preview + inline discard + AI footnote.
       Publish lives in the sticky bar below so it stays on-screen
       across the long form. Bottom h-32 spacer clears the sticky
       bar (~50–60px) + bottom mobile nav (h-12) so the AI footnote
       isn't hidden behind them. -->
  <div class="lg:hidden px-4 pt-4">
    <EventComposeMiniPreview {values} />
  </div>
  <div class="lg:hidden px-4 flex flex-col gap-2.5">
    <KioskBtn
      variant="secondary"
      size="lg"
      onclick={onDiscard}
      disabled={submitting}
      class="w-full"
    >
      {$t['cal.compose.cta.discard']}
    </KioskBtn>
    <p class="font-dmmono text-[9.5px] text-ink-mute leading-relaxed">
      {$t['cal.compose.aiNote']}
    </p>
  </div>
  <div class="lg:hidden h-32" aria-hidden="true"></div>

  <EventComposeStickyPublish {onPublish} {submitting} editing={isEditing} />

  <ModeratingModal open={modalOpen} onDismiss={() => (modalOpen = false)} />
{/if}
