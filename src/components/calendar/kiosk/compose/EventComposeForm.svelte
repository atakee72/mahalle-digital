<script lang="ts" module>
  export type EventComposeValues = {
    title: string;
    body: string;
    category: import('../../../../types').EventCategory;
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
    allDay: boolean;
    location: string;
    capacity: number | null;
    visibility: 'public' | 'private';
    tags: string[];
  };
</script>

<script lang="ts">
  // Event compose form — 6 numbered field groups per CD's
  // CreateEventArtboard (`kiosk-calendar-flows.jsx:281–404`).
  //
  // Each field group has a step number (01–06) + dashed-bottom-rule
  // header, mirroring forum's compose form labelling. The form is
  // controlled — values bubble up via `onChange` so the page can
  // observe them for the preview sidebar and submit handler.

  import { onMount } from 'svelte';
  import { CATEGORIES, CATEGORY_ORDER } from '../../../../lib/calendar/categories';
  import { scrollFade } from '../../../../lib/scrollFade';
  import { t } from '../../../../lib/kiosk-i18n';
  import { berlinTodayISO } from '../../../../lib/calendar/berlinDay';
  import type { EventCategory } from '../../../../types';

  let {
    initialValues,
    initialMultiDay,
    onChange,
    showBreadcrumb = false,
    editing = false
  } = $props<{
    initialValues?: Partial<EventComposeValues>;
    /** „kopieren" opens without dates, so the several-days state cannot be read from them. */
    initialMultiDay?: boolean;
    onChange: (v: EventComposeValues) => void;
    showBreadcrumb?: boolean;
    editing?: boolean;
  }>();

  // ─── State ─────────────────────────────────────────────────────────
  // Default times: a daytime 09:00–17:00 slot. Only when the chosen day
  // is TODAY does "next full hour" kick in (past 09:00) — a future day
  // must never inherit the current wall-clock (e.g. picking a day at 22:00
  // used to prefill 22:00–23:00). Mirrors the calendar tooltip's prefill.
  function todayISO(): string {
    return berlinTodayISO(); // Berlin's civil date — between 00:00 and 02:00 CEST the UTC date is still yesterday
  }
  function isTodayISO(d?: string): boolean {
    return (d ?? todayISO()) === todayISO();
  }
  function defaultStartHHMM(forDate?: string): string {
    const now = new Date();
    const next =
      !isTodayISO(forDate) || now.getHours() < 9 ? 9 : Math.min(23, now.getHours() + 1);
    return next.toString().padStart(2, '0') + ':00';
  }
  function defaultEndHHMM(forDate?: string): string {
    const now = new Date();
    const next =
      !isTodayISO(forDate) || now.getHours() < 9 ? 17 : Math.min(23, now.getHours() + 4);
    return next.toString().padStart(2, '0') + ':00';
  }

  // svelte-ignore state_referenced_locally
  let title = $state(initialValues?.title ?? '');
  // svelte-ignore state_referenced_locally
  let body = $state(initialValues?.body ?? '');
  // svelte-ignore state_referenced_locally
  let category = $state<EventCategory>(initialValues?.category ?? 'kiez');
  // svelte-ignore state_referenced_locally
  let startDate = $state(initialValues?.startDate ?? todayISO());
  // svelte-ignore state_referenced_locally
  let startTime = $state(initialValues?.startTime ?? defaultStartHHMM(initialValues?.startDate));
  // svelte-ignore state_referenced_locally
  let endDate = $state(initialValues?.endDate ?? initialValues?.startDate ?? todayISO());
  // svelte-ignore state_referenced_locally
  let endTime = $state(
    initialValues?.endTime ?? defaultEndHHMM(initialValues?.endDate ?? initialValues?.startDate)
  );
  // svelte-ignore state_referenced_locally
  let allDay = $state(initialValues?.allDay ?? false);
  // svelte-ignore state_referenced_locally
  let location = $state(initialValues?.location ?? '');
  // svelte-ignore state_referenced_locally
  let capacity = $state<number | null>(initialValues?.capacity ?? null);
  // svelte-ignore state_referenced_locally
  let visibility = $state<'public' | 'private'>(initialValues?.visibility ?? 'public');
  // svelte-ignore state_referenced_locally
  let tagsInput = $state((initialValues?.tags ?? []).join(' '));

  // Multi-day mode — auto-on when the URL prefill brings a different
  // start/end (drag-select pin path). User can toggle via the
  // 'mehrtägig' checkbox in the When section.
  // svelte-ignore state_referenced_locally
  let multiDay = $state(
    initialMultiDay ??
      !!(initialValues?.startDate &&
        initialValues?.endDate &&
        initialValues.startDate !== initialValues.endDate)
  );

  // Single source of truth for date sync. Reactive on multiDay,
  // startDate, endDate — covers single-day mirror, the multi-day
  // backwards-clamp, and the toggle transition.
  $effect(() => {
    if (!multiDay) {
      if (endDate !== startDate) endDate = startDate;
    } else if (endDate && endDate < startDate) {
      endDate = startDate;
    }
  });

  // Bubble up on every change.
  $effect(() => {
    onChange({
      title,
      body,
      category,
      startDate,
      startTime,
      endDate,
      endTime,
      allDay,
      location,
      capacity,
      visibility,
      tags: tagsInput.trim().split(/\s+/).filter(Boolean).slice(0, 5)
    });
  });

  // Title hint with character counter (uses {n} interpolation).
  function titleHint(n: number): string {
    return ($t['cal.compose.field.titleHint'] as string).replace('{n}', String(n));
  }
</script>

<form
  class="px-4 md:px-9 lg:px-10 py-6 overflow-auto"
  onsubmit={(e) => e.preventDefault()}
>
  {#if showBreadcrumb}
    <div
      class="flex items-center mb-3 font-dmmono text-[10.5px] uppercase tracking-[0.05em] text-ink-mute"
    >
      <a href="/calendar" class="inline-flex items-center gap-2 text-wine hover:text-ink transition-colors">
        <span>{$t['cal.compose.cta.back']}</span>
      </a>
      <span aria-hidden="true" class="mx-2">·</span>
      <span class="underline decoration-dashed underline-offset-[3px]">
        {editing ? $t['cal.compose.crumb.edit'] : $t['cal.compose.crumb.new']}
      </span>
    </div>

    <h1
      class="font-bricolage font-extrabold text-[40px] md:text-[48px] tracking-[-0.03em] leading-[0.95] m-0 mb-6 pb-3 border-b border-dashed border-rule"
    >
      {editing ? $t['cal.compose.title.edit.q1'] : $t['cal.compose.title.q1']}
      <span class="font-instrument italic font-normal text-teal">
        {editing ? $t['cal.compose.title.edit.q2'] : $t['cal.compose.title.q2']}
      </span>
    </h1>
  {/if}

  <!-- 01 · Category -->
  <div class="mb-6">
    <div
      class="flex items-baseline gap-2 mb-2 pb-1 border-b border-dashed border-rule"
    >
      <span class="font-dmmono text-[9.5px] tracking-[0.1em] font-bold text-wine">01</span>
      <span class="font-bricolage text-[14px] font-bold tracking-[-0.01em]">
        {$t['cal.compose.step.category']}
      </span>
      <span class="font-instrument italic text-[12px] text-ink-mute">
        — {$t['cal.compose.step.category.hint']}
      </span>
    </div>
    <div
      use:scrollFade
      class="kiosk-scroll-fade no-scrollbar flex gap-1.5 overflow-x-auto pt-0.5 pb-3 -mx-4 md:-mx-9 lg:-mx-10 px-4 md:px-9 lg:px-10"
    >
      {#each CATEGORY_ORDER as cat (cat)}
        {@const style = CATEGORIES[cat]}
        {@const on = category === cat}
        <button
          type="button"
          onclick={() => (category = cat)}
          aria-pressed={on}
          class={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-bricolage font-semibold text-[13px] border-[1.5px] transition-all flex-shrink-0 ${
            on
              ? `${style.bgClass} ${style.borderClass} ${style.textOnFill} shadow-[2px_2px_0_var(--k-ink,#1b1a17)]`
              : `bg-transparent ${style.borderClass} ${style.textClass}`
          }`}
        >
          <span aria-hidden="true">{style.glyph}</span>
          <span>{$t[`cal.cat.${cat}.label` as const]}</span>
          <!-- Invisible hit-area extender (SaveToggle pattern) — the small
               pill is a deliberate look, so the tap target grows without it.
               The row is an overflow-x scroller, so anything outside its
               padding box would be clipped: the extender therefore grows
               DOWNWARD into the row's `pb-3`, taking only the 2px available
               above. Horizontal stays inside half the `gap-1.5`. Insets
               resolve against the padding box, hence the 1.5px border
               compensation. -->
          <span aria-hidden="true" style="position:absolute; inset:-2px -4px -12px;"></span>
        </button>
      {/each}
    </div>
  </div>

  <!-- 02 · Title -->
  <div class="mb-6">
    <div
      class="flex items-baseline gap-2 mb-2 pb-1 border-b border-dashed border-rule"
    >
      <span class="font-dmmono text-[9.5px] tracking-[0.1em] font-bold text-wine">02</span>
      <span class="font-bricolage text-[14px] font-bold tracking-[-0.01em]">
        {$t['cal.compose.step.title']}
      </span>
      <span class="font-bricolage text-[14px] font-bold text-wine" aria-hidden="true">*</span>
    </div>
    <input
      type="text"
      bind:value={title} data-ev-field="title"
      maxlength="80"
      placeholder={$t['cal.compose.field.title.placeholder']}
      class="w-full min-h-[44px] appearance-none bg-paper-warm border-[1.5px] border-ink rounded-md px-3 py-2 font-bricolage text-[15px] text-ink placeholder:text-ink-mute/55 outline-none focus:border-wine"
    />
    <div class="font-dmmono text-[10.5px] text-ink-mute mt-1">
      {titleHint(title.length)}
    </div>
  </div>

  <!-- 03 · When -->
  <div class="mb-6">
    <div
      class="flex items-baseline gap-2 mb-2 pb-1 border-b border-dashed border-rule"
    >
      <span class="font-dmmono text-[9.5px] tracking-[0.1em] font-bold text-wine">03</span>
      <span class="font-bricolage text-[14px] font-bold tracking-[-0.01em]">
        {$t['cal.compose.step.when']}
      </span>
      <span class="font-bricolage text-[14px] font-bold text-wine" aria-hidden="true">*</span>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <label class="block">
        <span class="block font-dmmono text-[9px] uppercase tracking-[0.1em] text-ink-mute mb-0.5">
          {$t['cal.compose.field.date']}
        </span>
        <input
          type="date"
          bind:value={startDate} data-ev-field="date"
          class="w-full min-h-[44px] appearance-none bg-paper border border-ink rounded-sm px-3 py-1.5 font-bricolage text-[14px]"
        />
      </label>
      <label class="block">
        <span class="block font-dmmono text-[9px] uppercase tracking-[0.1em] text-ink-mute mb-0.5">
          {$t['cal.compose.field.start']}
        </span>
        <input
          type="time"
          bind:value={startTime} data-ev-field="start"
          disabled={allDay}
          class="w-full min-h-[44px] appearance-none bg-paper border border-ink rounded-sm px-3 py-1.5 font-bricolage text-[14px] disabled:opacity-50"
        />
      </label>
      <label class="block">
        <span class="block font-dmmono text-[9px] uppercase tracking-[0.1em] text-ink-mute mb-0.5">
          {$t['cal.compose.field.end']}
        </span>
        <input
          type="time"
          bind:value={endTime} data-ev-field="end"
          disabled={allDay}
          class="w-full min-h-[44px] appearance-none bg-paper border border-ink rounded-sm px-3 py-1.5 font-bricolage text-[14px] disabled:opacity-50"
        />
      </label>
    </div>
    {#if multiDay}
      <label class="block mt-2 max-w-[260px]">
        <span class="block font-dmmono text-[9px] uppercase tracking-[0.1em] text-ink-mute mb-0.5">
          {$t['cal.compose.field.endDate']}
        </span>
        <input
          type="date"
          bind:value={endDate} data-ev-field="endDate"
          min={startDate}
          class="w-full min-h-[44px] appearance-none bg-paper border border-ink rounded-sm px-3 py-1.5 font-bricolage text-[14px]"
        />
      </label>
    {/if}

    <div class="flex gap-3.5 mt-2 font-dmmono text-[11px] text-ink-mute">
      <label class="inline-flex items-center gap-1">
        <input type="checkbox" bind:checked={allDay} data-ev-field="allDay" />
        {$t['cal.compose.field.allDay']}
      </label>
      <label class="inline-flex items-center gap-1">
        <input type="checkbox" bind:checked={multiDay} data-ev-field="multiDay" />
        {$t['cal.compose.field.multiDay']}
      </label>
    </div>
    {#if editing}
      <p class="mt-2 font-instrument italic text-[12.5px] leading-snug text-ink-mute" data-move-hint>
        {$t['cal.compose.move.hint']}
      </p>
    {/if}
  </div>

  <!-- 04 · Where -->
  <div class="mb-6">
    <div
      class="flex items-baseline gap-2 mb-2 pb-1 border-b border-dashed border-rule"
    >
      <span class="font-dmmono text-[9.5px] tracking-[0.1em] font-bold text-wine">04</span>
      <span class="font-bricolage text-[14px] font-bold tracking-[-0.01em]">
        {$t['cal.compose.step.where']}
      </span>
    </div>
    <input
      type="text"
      bind:value={location} data-ev-field="location"
      maxlength="200"
      placeholder={$t['cal.compose.field.location.placeholder']}
      class="w-full min-h-[44px] appearance-none bg-paper-warm border-[1.5px] border-ink rounded-md px-3 py-2 font-bricolage text-[14px] text-ink placeholder:text-ink-mute/55 outline-none focus:border-wine"
    />
  </div>

  <!-- 05 · Description -->
  <div class="mb-6">
    <div
      class="flex items-baseline gap-2 mb-2 pb-1 border-b border-dashed border-rule"
    >
      <span class="font-dmmono text-[9.5px] tracking-[0.1em] font-bold text-wine">05</span>
      <span class="font-bricolage text-[14px] font-bold tracking-[-0.01em]">
        {$t['cal.compose.step.description']}
      </span>
      <span class="font-bricolage text-[14px] font-bold text-wine" aria-hidden="true">*</span>
    </div>
    <textarea
      bind:value={body} data-ev-field="body"
      rows="5"
      maxlength="5000"
      placeholder={$t['cal.compose.field.body.placeholder']}
      class="w-full appearance-none bg-paper-warm border-[1.5px] border-ink rounded-md px-3 py-2 font-bricolage text-[14px] leading-relaxed text-ink placeholder:text-ink-mute/55 outline-none focus:border-wine resize-y min-h-[120px]"
    ></textarea>
  </div>

  <!-- 06 · Options (Capacity) -->
  <div class="mb-6">
    <div
      class="flex items-baseline gap-2 mb-2 pb-1 border-b border-dashed border-rule"
    >
      <span class="font-dmmono text-[9.5px] tracking-[0.1em] font-bold text-wine">06</span>
      <span class="font-bricolage text-[14px] font-bold tracking-[-0.01em]">
        {$t['cal.compose.step.options']}
      </span>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[480px]">
      <label class="block">
        <span class="block font-dmmono text-[9px] uppercase tracking-[0.1em] text-ink-mute mb-0.5">
          {$t['cal.compose.field.capacity']}
        </span>
        <input
          type="number"
          min="1"
          max="10000"
          bind:value={capacity} data-ev-field="capacity"
          placeholder={$t['cal.compose.field.capacity.placeholder']}
          class="w-full min-h-[44px] appearance-none bg-paper border border-ink rounded-sm px-3 py-1.5 font-bricolage text-[14px]"
        />
      </label>
      <!-- Sichtbarkeit select HIDDEN 2026-08-30 (was public/private): the
           read paths never filtered `visibility`, so „privat" events were
           visible to every member — the toggle lied. The field plumbing
           (state, payload, schema, landing filter) stays for the queued
           private-events feature; until the query-side enforcement is
           built, everything composes as 'public'. -->
    </div>
  </div>

  <!-- Footnote — explains the wine '*' marker on required fields. -->
  <p class="mt-4 font-dmmono text-[10px] text-ink-mute">
    <span class="text-wine font-bold" aria-hidden="true">*</span> {$t['cal.compose.requiredNote'].replace(/^\*\s*/, '')}
  </p>
</form>
