<script lang="ts">
  // Kiosk-styled community report modal. Single shared component for
  // every kiosk surface that lets a user flag content (forum posts,
  // calendar events, comments — anything `/api/reports/submit` accepts).
  //
  // Built on the native <dialog> + showModal() pattern established by
  // EventDetailModal.svelte. Stacks correctly above another open dialog
  // because the browser handles top-layer ordering automatically.

  import { ReportReasonSchema } from '../../../schemas/moderation.schema';
  import type { ReportReason } from '../../../schemas/moderation.schema';
  import type { ModeratedContentType } from '../../../types';
  import { t } from '../../../lib/kiosk-i18n';
  import { lockPageScroll } from '../../../lib/scrollLock';
  import { showSuccess } from '../../../utils/toast';
  import KioskBtn from './KioskBtn.svelte';

  let {
    open = false,
    contentId,
    contentType,
    contentTitle,
    onClose
  } = $props<{
    open?: boolean;
    contentId: string;
    contentType: ModeratedContentType;
    contentTitle?: string;
    onClose: () => void;
  }>();

  // Source the ordered reason list from the Zod enum (so the modal stays
  // in sync if the enum grows). Labels resolve via $t['report.reason.*'].
  const REASONS = ReportReasonSchema.options;

  let dialog: HTMLDialogElement | undefined = $state();
  let reason = $state<ReportReason | ''>('');
  let details = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  // Drive the native dialog from the `open` prop — same pattern as
  // EventDetailModal:42-48.
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  // Native showModal() makes the page inert but does NOT stop it scrolling
  // (verified 2026-09-09 at 390×844) — lock html+body while open.
  $effect(() => {
    if (!open) return;
    return lockPageScroll();
  });

  function onDialogClose() {
    if (open) onClose();
    // Reset internal state after the dialog dismiss animation finishes
    // so the fields don't visibly flash blank during the close.
    setTimeout(() => {
      reason = '';
      details = '';
      error = null;
      submitting = false;
    }, 250);
  }

  function onDialogClick(e: MouseEvent) {
    if (e.target === dialog) onClose();
  }

  const canSubmit = $derived(
    !!reason && details.trim().length >= 10 && !submitting
  );

  async function handleSubmit() {
    if (!canSubmit) return;
    submitting = true;
    error = null;
    try {
      const res = await fetch('/api/reports/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ contentId, contentType, reason, details })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.alreadyReported) {
          error = $t['report.error.duplicate'] as string;
        } else if (typeof data.error === 'string' && data.error.toLowerCase().includes('your own')) {
          error = $t['report.error.self'] as string;
        } else {
          error = (data.error as string) || ($t['report.error.generic'] as string);
        }
        return;
      }
      showSuccess($t['report.toast.submitted'] as string);
      onClose();
    } catch (e) {
      error = e instanceof Error ? e.message : ($t['report.error.generic'] as string);
    } finally {
      submitting = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  onclose={onDialogClose}
  onclick={onDialogClick}
  class="bg-transparent p-0 m-auto max-w-none max-h-none backdrop:bg-ink/40"
>
  <div
    class="bg-paper border-[1.5px] border-ink rounded-md shadow-[3px_3px_0_var(--k-wine,#b23a5b)] w-[min(92vw,520px)] mx-auto my-6 md:my-[40px] max-h-[calc(100dvh-48px)] overflow-y-auto"
  >
    <!-- Header -->
    <header class="px-5 py-4 border-b border-dashed border-rule flex items-start justify-between gap-3">
      <div>
        <p class="font-dmmono text-[10px] uppercase tracking-[0.12em] text-wine mb-1">
          ⚑ {$t['report.modal.title']}
        </p>
        {#if contentTitle}
          <p class="font-instrument italic text-[13px] text-ink-soft leading-snug">
            {$t['report.modal.subtitle']} <span class="text-ink not-italic font-bricolage font-semibold">{contentTitle}</span>
          </p>
        {/if}
      </div>
      <button
        type="button"
        onclick={onClose}
        aria-label={$t['report.modal.cancel'] as string}
        class="shrink-0 w-9 h-9 rounded-full bg-paper border-[1.5px] border-ink flex items-center justify-center text-[18px] leading-none font-dmmono shadow-[2px_2px_0_var(--k-ink,#0e1033)]"
      >×</button>
    </header>

    <div class="px-5 py-5 flex flex-col gap-5">
      <!-- Reason radios -->
      <fieldset>
        <legend class="font-dmmono text-[10px] uppercase tracking-[0.12em] text-ink-mute mb-2">
          ◆ {$t['report.modal.reasonLabel']}
        </legend>
        <div class="flex flex-col gap-1.5">
          {#each REASONS as opt (opt)}
            <label
              class={`flex items-center gap-3 px-3 py-2 rounded-md border-[1.5px] cursor-pointer transition-colors ${
                reason === opt
                  ? 'border-ochre bg-ochre/10'
                  : 'border-ink bg-paper hover:bg-paper-warm'
              }`}
            >
              <input
                type="radio"
                name="report-reason"
                value={opt}
                checked={reason === opt}
                onchange={() => (reason = opt)}
                class="accent-ochre"
              />
              <span class="font-bricolage text-[13px] text-ink">
                {$t[`report.reason.${opt}` as const]}
              </span>
            </label>
          {/each}
        </div>
      </fieldset>

      <!-- Details textarea -->
      <div>
        <label for="kiosk-report-details" class="block font-dmmono text-[10px] uppercase tracking-[0.12em] text-ink-mute mb-2">
          ◆ {$t['report.modal.detailsLabel']}
        </label>
        <textarea
          id="kiosk-report-details"
          bind:value={details}
          placeholder={$t['report.modal.detailsPlaceholder'] as string}
          rows="4"
          maxlength="500"
          class="w-full px-3 py-2 rounded-md border-[1.5px] border-ink bg-paper font-bricolage text-[13.5px] text-ink leading-[1.5] resize-none focus:outline-none focus:ring-2 focus:ring-ochre"
        ></textarea>
        <p class={`font-dmmono text-[10px] mt-1 ${details.trim().length >= 10 ? 'text-ink-mute' : 'text-warn'}`}>
          {($t['report.modal.charCount'] as string).replace('{n}', String(details.length))}
        </p>
      </div>

      <!-- Inline error -->
      {#if error}
        <div class="px-3 py-2 rounded-md bg-danger/10 border border-danger font-bricolage text-[12.5px] text-danger" role="alert">
          {error}
        </div>
      {/if}

      <!-- Actions -->
      <div class="flex gap-3 justify-end pt-1">
        <KioskBtn variant="secondary" size="md" onclick={onClose} disabled={submitting}>
          {$t['report.modal.cancel']}
        </KioskBtn>
        <KioskBtn variant="primary" size="md" onclick={handleSubmit} disabled={!canSubmit}>
          {submitting ? $t['report.modal.submitting'] : $t['report.modal.submit']}
        </KioskBtn>
      </div>
    </div>
  </div>
</dialog>
