<script lang="ts">
  // Konto (account) card — §03. E-MAIL row carries the "ändern" action
  // (Plan B Task 8) opening PEmailChangePanel; PASSWORT row carries its own
  // "ändern" action (Task 9) opening PPasswordChangePanel — both mounted
  // once by ProfileInner, see that file's layout comment +
  // src/components/profile/kiosk/CLAUDE.md. + the KIEZ-BRIEF row (the weekly
  // mail's on/off, 2026-10-04; state and handler upstream like everything
  // here) + Abmelden.
  // Design source: kiosk-profile.jsx (PKontoCard, PKontoRow) for the row
  // anatomy + kiosk-profile-states.jsx §08 (PMiniBanner) for the pending
  // banner rendered here whenever a change is awaiting confirmation and the
  // panel itself isn't the thing showing that same info (i.e. it's closed).
  //
  // `bare` (Task 10): mobile fold usage — skips the outer PCard + §03
  // PCardHead, PMobileFold already supplies the card chrome + "Konto" title.
  // Stateless/props-driven like the rest of this card — double-mounted
  // (desktop card + mobile fold) is safe because `pendingEmail` and the
  // resend/cancel handlers all live in ProfileInner; both mounts just
  // render off the same upstream state.
  //
  // Gefahrenzone / delete-account (Task 10): same stateless pattern —
  // `deletionScheduledAt` + `deletionDateLabel` (pre-formatted dd.MM.yyyy,
  // see ProfileInner's `deletionDateLabel` derived) live upstream, and
  // `onOpenDelete`/`onCancelDeletion` are the same function references
  // passed to both mounts (mirrors onResendEmail/onCancelEmail above — the
  // §08-style banner here and PDeleteAccountModal, mounted once by
  // ProfileInner, can never drift). Design source: kiosk-profile.jsx
  // PKontoCard's Gefahrenzone box (dashed danger border, GEFAHRENZONE
  // label, row + PBtn danger small "löschen …").

  import { signOut } from 'auth-astro/client';
  import { slide } from 'svelte/transition';
  import { t, tStr } from '../../../lib/kiosk-i18n';
  import PCard from './atoms/PCard.svelte';
  import PCardHead from './atoms/PCardHead.svelte';
  import PBtn from './atoms/PBtn.svelte';

  let {
    email,
    pendingEmail = null,
    showBanner = false,
    onChangeEmail,
    onResendEmail,
    onCancelEmail,
    onChangePassword,
    newsletterMode = null,
    newsletterVerified = false,
    newsletterBusy = false,
    onToggleNewsletter,
    deletionScheduledAt = null,
    deletionDateLabel = null,
    onOpenDelete,
    onCancelDeletion,
    bare = false,
  }: {
    email: string;
    pendingEmail?: string | null;
    showBanner?: boolean;
    onChangeEmail?: () => void;
    onResendEmail?: () => Promise<void>;
    onCancelEmail?: () => Promise<void>;
    onChangePassword?: () => void;
    /** null = not loaded yet → no row. */
    newsletterMode?: 'weekly' | 'off' | null;
    newsletterVerified?: boolean;
    newsletterBusy?: boolean;
    onToggleNewsletter?: () => void;
    deletionScheduledAt?: string | null;
    deletionDateLabel?: string | null;
    onOpenDelete?: () => void;
    onCancelDeletion?: () => Promise<void>;
    bare?: boolean;
  } = $props();

  let resendLoading = $state(false);
  let cancelLoading = $state(false);
  let cancelDelLoading = $state(false);

  // Mobile-only disclosure (design: Gefahrenzone ZU per default — one
  // deliberate tap separates routine (Abmelden) from irreversible (löschen)).
  // Local per-mount state is safe: PKontoCard is double-mounted but only one
  // mount is ever visible per breakpoint, and the fold is pure presentation.
  let dangerOpen = $state(false);
  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  async function handleCancelDeletion() {
    if (cancelDelLoading || !onCancelDeletion) return;
    cancelDelLoading = true;
    await onCancelDeletion();
    cancelDelLoading = false;
  }

  async function handleResend() {
    if (resendLoading || !onResendEmail) return;
    resendLoading = true;
    await onResendEmail();
    resendLoading = false;
  }

  async function handleCancel() {
    if (cancelLoading || !onCancelEmail) return;
    cancelLoading = true;
    await onCancelEmail();
    cancelLoading = false;
  }

  async function handleLogout() {
    try {
      await signOut({ callbackUrl: '/login?abgemeldet=1' });
    } catch {
      window.location.href = '/login?abgemeldet=1';
    }
  }
</script>

{#snippet body()}
  <div style="display: flex; align-items: center; justify-content: space-between; padding: 11px 0; border-top: 1px dashed var(--k-rule); gap: 12px;">
    <div style="min-width: 0;">
      <div style="font-family: var(--k-font-mono); font-size: 9.5px; color: var(--k-ink-mute); letter-spacing: 0.14em;">{$t['profile.konto.email']}</div>
      <div style="font-family: var(--k-font-display); font-size: 13.5px; font-weight: 600; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{email}</div>
    </div>
    {#if onChangeEmail}
      <button
        type="button"
        onclick={onChangeEmail}
        class="font-bricolage kiosk-tap"
        style="flex-shrink: 0; background: none; border: none; padding: 0 0 1px; cursor: pointer; font-size: 12.5px; font-weight: 700; color: var(--k-ink); border-bottom: 2px solid var(--k-ochre);"
      >{$t['profile.konto.change']}</button>
    {/if}
  </div>

  {#if showBanner && pendingEmail}
    <div
      style="
        margin-top: 10px; padding: 8px 11px; background: #fbf1d8;
        border: 1.5px solid var(--k-warn); border-radius: var(--k-radius-sm);
        font-family: var(--k-font-mono); font-size: 9.5px; color: var(--k-ink-soft); line-height: 1.55;
      "
    >
      <b style="color: var(--k-warn);">◐</b>
      {tStr($t['profile.email.pending'], { addr: pendingEmail })} ·
      <button
        type="button"
        onclick={handleResend}
        disabled={resendLoading}
        class="font-dmmono"
        style="background: none; border: none; padding: 0; cursor: pointer; font-size: 9.5px; font-weight: 700; color: var(--k-warn); border-bottom: 1.5px solid var(--k-warn); opacity: {resendLoading ? 0.5 : 1};"
      >{$t['profile.email.stage2.resend']}</button> ·
      <button
        type="button"
        onclick={handleCancel}
        disabled={cancelLoading}
        class="font-dmmono"
        style="background: none; border: none; padding: 0; cursor: pointer; font-size: 9.5px; font-weight: 700; color: var(--k-warn); border-bottom: 1.5px solid var(--k-warn); opacity: {cancelLoading ? 0.5 : 1};"
      >{$t['profile.email.stage2.cancel']}</button>
    </div>
  {/if}

  <div style="display: flex; align-items: center; justify-content: space-between; padding: 11px 0; border-top: 1px dashed var(--k-rule); gap: 12px;">
    <div style="min-width: 0;">
      <div style="font-family: var(--k-font-mono); font-size: 9.5px; color: var(--k-ink-mute); letter-spacing: 0.14em;">{$t['profile.konto.password']}</div>
      <div style="font-family: var(--k-font-display); font-size: 13.5px; font-weight: 600; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">••••••••••</div>
    </div>
    {#if onChangePassword}
      <button
        type="button"
        onclick={onChangePassword}
        class="font-bricolage kiosk-tap"
        style="flex-shrink: 0; background: none; border: none; padding: 0 0 1px; cursor: pointer; font-size: 12.5px; font-weight: 700; color: var(--k-ink); border-bottom: 2px solid var(--k-ochre);"
      >{$t['profile.konto.change']}</button>
    {/if}
  </div>

  {#if newsletterMode !== null && onToggleNewsletter}
    <div data-konto-newsletter style="display: flex; align-items: center; justify-content: space-between; padding: 11px 0; border-top: 1px dashed var(--k-rule); gap: 12px;">
      <div style="min-width: 0;">
        <div style="font-family: var(--k-font-mono); font-size: 9.5px; color: var(--k-ink-mute); letter-spacing: 0.14em;">{$t['profile.konto.newsletter']}</div>
        <div data-konto-newsletter-state style="font-family: var(--k-font-display); font-size: 13.5px; font-weight: 600; margin-top: 3px;">
          {$t[newsletterMode === 'off' ? 'profile.konto.newsletter.off' : 'profile.konto.newsletter.weekly']}
        </div>
        {#if newsletterMode !== 'off' && !newsletterVerified}
          <!-- The mail only goes to confirmed addresses: say so, or „every Sunday" is a promise we do not keep. -->
          <div data-konto-newsletter-hint style="font-family: var(--k-font-mono); font-size: 9.5px; color: var(--k-warn); line-height: 1.5; margin-top: 3px;">{$t['profile.konto.newsletter.unverified']}</div>
        {/if}
      </div>
      <button
        type="button"
        onclick={onToggleNewsletter}
        disabled={newsletterBusy}
        aria-busy={newsletterBusy}
        class="font-bricolage kiosk-tap"
        style="flex-shrink: 0; background: none; border: none; padding: 0 0 1px; cursor: pointer; font-size: 12.5px; font-weight: 700; color: var(--k-ink); border-bottom: 2px solid var(--k-ochre); opacity: {newsletterBusy ? 0.5 : 1};"
      >{$t[newsletterMode === 'off' ? 'profile.konto.newsletter.turnOn' : 'profile.konto.newsletter.turnOff']}</button>
    </div>
  {/if}

  <div style="display: flex; gap: 8px; margin-top: 16px;">
    <PBtn small class="kiosk-tap" onclick={handleLogout}>{$t['profile.konto.logout']}</PBtn>
  </div>

  {#if deletionScheduledAt}
    <div
      style="
        margin-top: 16px; padding: 8px 11px; background: #f6e3e3;
        border: 1.5px solid var(--k-danger); border-radius: var(--k-radius-sm);
        font-family: var(--k-font-mono); font-size: 9.5px; color: var(--k-ink-soft); line-height: 1.55;
      "
    >
      <b style="color: var(--k-danger);">✕</b>
      {tStr($t['profile.del.pending'], { d: deletionDateLabel ?? '—' })} ·
      <button
        type="button"
        onclick={handleCancelDeletion}
        disabled={cancelDelLoading}
        class="font-dmmono"
        style="background: none; border: none; padding: 0; cursor: pointer; font-size: 9.5px; font-weight: 700; color: var(--k-danger); border-bottom: 1.5px solid var(--k-danger); opacity: {cancelDelLoading ? 0.5 : 1};"
      >{$t['profile.del.widerrufen']}</button>
    </div>
  {:else if onOpenDelete}
    {#if bare}
      <!-- Mobile: collapsed disclosure (≥44px row). Desktop box below stays unchanged. -->
      <div style="margin-top: 16px; border-top: 1.5px dashed var(--k-rule);">
        <button
          type="button"
          class="font-dmmono"
          aria-expanded={dangerOpen}
          onclick={() => (dangerOpen = !dangerOpen)}
          style="width: 100%; min-height: 44px; display: flex; align-items: center; justify-content: space-between; background: none; border: none; padding: 13px 0 2px; cursor: pointer;"
        >
          <span style="font-size: 9.5px; color: var(--k-danger); letter-spacing: 0.14em;">{$t['profile.del.zone.label']}</span>
          <span style="font-size: 11px; color: var(--k-danger);">{dangerOpen ? '▾' : '▸'}</span>
        </button>
        {#if dangerOpen}
          <div
            transition:slide={{ duration: reducedMotion ? 0 : 220 }}
            style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 4px;"
          >
            <span class="font-bricolage" style="font-size: 12.5px; color: var(--k-ink-soft);">{$t['profile.del.zone.row']}</span>
            <PBtn danger small class="kiosk-tap" onclick={onOpenDelete}>{$t['profile.del.zone.cta']}</PBtn>
          </div>
        {/if}
      </div>
    {:else}
      <!-- Desktop: existing open dashed box, byte-identical to before -->
      <div style="margin-top: 16px; padding: 12px 14px; border: 1.5px dashed var(--k-danger); border-radius: var(--k-radius-md);">
        <div class="font-dmmono" style="font-size: 9.5px; color: var(--k-danger); letter-spacing: 0.14em; margin-bottom: 6px;">
          {$t['profile.del.zone.label']}
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
          <span class="font-bricolage" style="font-size: 12.5px; color: var(--k-ink-soft);">{$t['profile.del.zone.row']}</span>
          <PBtn danger small class="kiosk-tap" onclick={onOpenDelete}>{$t['profile.del.zone.cta']}</PBtn>
        </div>
      </div>
    {/if}
  {/if}
{/snippet}

{#if bare}
  {@render body()}
{:else}
  <PCard>
    <PCardHead n="03" title={$t['profile.konto.title']} />
    {@render body()}
  </PCard>
{/if}
