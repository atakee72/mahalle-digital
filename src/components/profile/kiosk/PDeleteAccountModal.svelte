<script lang="ts">
  // Delete-account danger modal — kiosk-profile-flows.jsx §05
  // DeleteAccountModal. Native <dialog> + showModal(), mirroring
  // KioskReportModal.svelte's conventions (src/components/forum/kiosk/
  // KioskReportModal.svelte): the browser handles focus trap and
  // Escape-to-close for free via the native dialog element (scroll-lock is
  // NOT free — lockPageScroll() below); backdrop
  // click-close is a manual `onclick` check against the dialog itself.
  // Single mount by ProfileInner, gated by a local `deleteModalOpen`
  // boolean (same topology as PEmailChangePanel/PPasswordChangePanel).
  //
  // SCOPE (load-bearing): this component NEVER deletes or anonymizes data.
  // Submitting only calls POST /api/profile/delete-account/schedule, which
  // stamps a 7-day-grace `deletionScheduledAt` and returns. The actual
  // anonymization pipeline that acts on an elapsed date is Task 11.
  //
  // Design source: kiosk-profile-flows.jsx §05 — 560px paperWarm modal,
  // 2px ink border, 5px danger top-rule, 6px 6px 0 ink shadow, 6-row
  // consequences ledger (◍ ink-mute = kept/anonymized, ✕ danger =
  // deleted), handle-typing confirm gate (CTA disabled + 0.45 opacity
  // until the typed text exactly matches the caller's own handle) +
  // password field.

  import { t } from '../../../lib/kiosk-i18n';
  import { lockPageScroll } from '../../../lib/scrollLock';
  import { showError } from '../../../utils/toast';
  import PBtn from './atoms/PBtn.svelte';

  let {
    open = false,
    handle,
    onClose,
    onScheduled,
  }: {
    open?: boolean;
    handle: string;
    onClose: () => void;
    onScheduled: (deletionScheduledAt: string) => void;
  } = $props();

  // Row order + keep/delete flags are structural (design anatomy), not
  // copy — copy lives in i18n as `profile.del.ledger.{n}.what|fate`.
  const LEDGER_ROWS: { n: 1 | 2 | 3 | 4 | 5 | 6; keep: boolean }[] = [
    { n: 1, keep: true },
    { n: 2, keep: false },
    { n: 3, keep: true },
    { n: 4, keep: false },
    { n: 5, keep: false },
    { n: 6, keep: true },
  ];

  let dialog: HTMLDialogElement | undefined = $state();
  let handleInput = $state('');
  let password = $state('');
  let handleFocused = $state(false);
  let pwFocused = $state(false);
  let handleError = $state<string | null>(null);
  let pwError = $state<string | null>(null);
  let submitting = $state(false);
  let submitSeq = 0;

  // Drive the native dialog from the `open` prop — same pattern as
  // KioskReportModal.svelte.
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
    // Fires on both Escape (browser-driven, `open` still true here) and a
    // programmatic dialog.close() from the effect above (parent already
    // flipped `open` false, so this guard prevents a double onClose()).
    if (open) onClose();
    setTimeout(() => {
      handleInput = '';
      password = '';
      handleError = null;
      pwError = null;
      submitting = false;
    }, 250);
  }

  function onDialogClick(e: MouseEvent) {
    if (e.target === dialog) onClose();
  }

  const canSubmit = $derived(handleInput === handle && password.length > 0 && !submitting);

  function serverErrorCopy(code: string | null): string {
    switch (code) {
      case 'invalid_password':
        return $t['profile.del.err.invalid_password'];
      case 'handle_mismatch':
        return $t['profile.del.err.handle_mismatch'];
      case 'throttled':
        return $t['profile.del.err.throttled'];
      case 'already_scheduled':
        return $t['profile.del.err.already_scheduled'];
      default:
        // 'validation' (shouldn't happen — client already gates on the
        // exact handle match) | 'internal' | network errors.
        return $t['profile.del.err.config'];
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    handleError = null;
    pwError = null;
    const mySeq = ++submitSeq;
    submitting = true;
    try {
      const res = await fetch('/api/profile/delete-account/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, confirmHandle: handleInput }),
      });
      if (mySeq !== submitSeq) return; // stale

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (typeof data?.deletionScheduledAt === 'string') {
          onScheduled(data.deletionScheduledAt);
        }
        password = '';
        onClose();
        return;
      }

      let code: string | null = null;
      try {
        const j = await res.json();
        code = typeof j?.error === 'string' ? j.error : null;
      } catch {
        /* non-JSON error body — falls through to generic copy */
      }
      if (code === 'invalid_password') pwError = serverErrorCopy(code);
      else if (code === 'handle_mismatch') handleError = serverErrorCopy(code);
      else showError(serverErrorCopy(code));
    } catch {
      if (mySeq !== submitSeq) return;
      showError(serverErrorCopy(null));
    } finally {
      if (mySeq === submitSeq) submitting = false;
    }
  }

  const handleBorder = $derived(handleError ? 'var(--k-danger)' : handleFocused ? 'var(--k-ink)' : 'var(--k-rule)');
  const pwBorder = $derived(pwError ? 'var(--k-danger)' : pwFocused ? 'var(--k-ink)' : 'var(--k-rule)');
</script>

<dialog
  bind:this={dialog}
  onclose={onDialogClose}
  onclick={onDialogClick}
  class="bg-transparent p-0 m-auto max-w-none max-h-none backdrop:bg-[rgba(27,26,23,0.45)]"
>
  <div
    style="
      width: min(92vw, 560px); box-sizing: border-box; margin: 24px auto;
      background: var(--k-paper-warm); border: 2px solid var(--k-ink);
      border-top: 5px solid var(--k-danger); border-radius: 16px;
      box-shadow: 6px 6px 0 var(--k-ink); padding: 28px;
      max-height: calc(100dvh - 48px); overflow-y: auto;
    "
  >
    <div class="font-dmmono" style="font-size: 10px; letter-spacing: 0.16em; color: var(--k-danger); font-weight: 600;">
      {$t['profile.del.modal.eyebrow']}
    </div>
    <h3 class="font-bricolage" style="font-size: 26px; font-weight: 800; letter-spacing: -0.03em; margin: 8px 0 4px;">
      {$t['profile.del.modal.headline.pre']}<span class="font-instrument italic" style="font-weight: 400; color: var(--k-danger);">{$t['profile.del.modal.headline.accent']}</span>{$t['profile.del.modal.headline.post']}
    </h3>
    <div class="font-bricolage" style="font-size: 13px; color: var(--k-ink-soft); margin-bottom: 16px;">
      {$t['profile.del.modal.subhead']}
    </div>

    {#each LEDGER_ROWS as row (row.n)}
      <div style="display: grid; grid-template-columns: 18px 1fr 1.2fr; gap: 10px; padding: 8px 0; border-top: 1px dashed var(--k-rule); align-items: baseline;">
        <span class="font-dmmono" style="font-size: 11px; color: {row.keep ? 'var(--k-ink-mute)' : 'var(--k-danger)'};">{row.keep ? '◍' : '✕'}</span>
        <span class="font-bricolage" style="font-size: 13px; font-weight: 700;">{$t[`profile.del.ledger.${row.n}.what` as const]}</span>
        <span class="font-dmmono" style="font-size: 10.5px; color: var(--k-ink-soft); line-height: 1.5;">{$t[`profile.del.ledger.${row.n}.fate` as const]}</span>
      </div>
    {/each}

    <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
      <div style="margin-top: 16px; margin-bottom: 12px;">
        <label for="pdel-handle" class="font-dmmono" style="display: block; font-size: 9.5px; letter-spacing: 0.14em; color: var(--k-ink-mute); margin-bottom: 5px;">
          {$t['profile.del.modal.handle.label']}
        </label>
        <input
          id="pdel-handle"
          type="text"
          bind:value={handleInput}
          onfocus={() => (handleFocused = true)}
          onblur={() => (handleFocused = false)}
          placeholder={handle}
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          class="font-bricolage"
          style="width: 100%; box-sizing: border-box; padding: 10px 13px; background: var(--k-paper-soft); border: 1.5px solid {handleBorder}; border-radius: var(--k-radius-md); font-size: 14px; font-weight: 500; color: var(--k-ink);"
        />
        {#if handleError}
          <div class="font-dmmono" style="font-size: 10px; color: var(--k-danger); margin-top: 4px;">✕ {handleError}</div>
        {/if}
      </div>
      <div style="margin-bottom: 6px;">
        <label for="pdel-pw" class="font-dmmono" style="display: block; font-size: 9.5px; letter-spacing: 0.14em; color: var(--k-ink-mute); margin-bottom: 5px;">
          {$t['profile.del.modal.password.label']}
        </label>
        <input
          id="pdel-pw"
          type="password"
          bind:value={password}
          onfocus={() => (pwFocused = true)}
          onblur={() => (pwFocused = false)}
          autocomplete="current-password"
          class="font-bricolage"
          style="width: 100%; box-sizing: border-box; padding: 10px 13px; background: var(--k-paper-soft); border: 1.5px solid {pwBorder}; border-radius: var(--k-radius-md); font-size: 14px; font-weight: 500; color: var(--k-ink);"
        />
        {#if pwError}
          <div class="font-dmmono" style="font-size: 10px; color: var(--k-danger); margin-top: 4px;">✕ {pwError}</div>
        {/if}
      </div>

      <div style="display: flex; gap: 10px; margin-top: 6px; align-items: center; flex-wrap: wrap;">
        <button
          type="submit"
          disabled={!canSubmit}
          class="font-bricolage"
          style="
            padding: 10px 18px; background: var(--k-danger); color: var(--k-paper);
            border: 1.5px solid var(--k-ink); border-radius: 999px; font-size: 13.5px; font-weight: 700;
            box-shadow: 2px 2px 0 var(--k-ink); opacity: {canSubmit ? 1 : 0.45};
            cursor: {canSubmit ? 'pointer' : 'not-allowed'};
          "
        >
          {submitting ? $t['profile.del.modal.submitting'] : $t['profile.del.modal.cta']}
        </button>
        <PBtn small type="button" onclick={onClose} disabled={submitting}>{$t['profile.del.modal.cancel']}</PBtn>
        <span class="font-dmmono" style="font-size: 9.5px; color: var(--k-ink-mute);">{$t['profile.del.modal.hint']}</span>
      </div>
    </form>
  </div>
</dialog>
