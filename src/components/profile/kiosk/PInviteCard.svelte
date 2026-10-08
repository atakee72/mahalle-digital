<script lang="ts">
  // Einladen card — the member's personal invitation link (2026-10-07). Stateless/props-driven
  // like PKontoCard: it is double-mounted (desktop card + mobile fold), so the data, the one
  // fetch and the renew call live in ProfileInner. Reachable only through ProfileInner → no
  // <style> block (a scoped style would be orphaned in the production build); inline styles.
  //
  // What the member sees: who may not invite yet reads why (block); everyone else gets the
  // link as text, a QR code (server-rendered SVG of OUR url), three ways to pass it on —
  // the phone's share sheet, their own mail program (mailto:, prefilled), the clipboard —
  // the budget line and the members who joined through the link. Mahalle sends nothing.
  import { t, tStr, locale } from '../../../lib/kiosk-i18n';
  import { showSuccess, showError, confirmAction } from '../../../utils/toast';
  import { formatDdMmYyyy } from '../../../lib/profile/profileShared';
  import { INVITE_USES, inviteMailto, type InviteState } from '../../../lib/invites/inviteRules';
  import PCard from './atoms/PCard.svelte';
  import PCardHead from './atoms/PCardHead.svelte';
  import PBtn from './atoms/PBtn.svelte';

  // Prop is `invite`, not `state`: a prop called `state` would shadow the `$state` rune.
  let {
    invite = null,
    failed = false,
    busy = false,
    memberName = '',
    onRegenerate,
    onRetry,
    bare = false,
  }: {
    /** null = not loaded yet. */
    invite?: InviteState | null;
    failed?: boolean;
    busy?: boolean;
    memberName?: string;
    onRegenerate?: () => Promise<void>;
    onRetry?: () => void;
    bare?: boolean;
  } = $props();

  // The share sheet exists on phones and some desktops; decided after mount (SSR has no navigator).
  let canShare = $state(false);
  $effect(() => {
    canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  });

  const loc = $derived($locale === 'de' ? 'de' : 'en');
  const mailBody = $derived(invite?.url ? tStr($t['profile.invite.mail.body'], { url: invite.url, name: memberName }) : '');
  const mailHref = $derived(invite?.url ? inviteMailto($t['profile.invite.mail.subject'], mailBody) : '');

  async function share() {
    if (!invite?.url) return;
    try {
      await navigator.share({ title: $t['profile.invite.mail.subject'], text: $t['profile.invite.share.text'], url: invite.url });
    } catch {
      // Cancelled share sheets reject too — nothing to report.
    }
  }

  async function copy() {
    if (!invite?.url) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      showSuccess($t['profile.invite.copied']);
    } catch {
      showError($t['profile.invite.copyFailed']);
    }
  }

  async function renew() {
    if (busy || !onRegenerate) return;
    const ok = await confirmAction($t['profile.invite.renew.confirm'], {
      title: $t['profile.invite.renew.cta'],
      confirmLabel: $t['profile.invite.renew.cta'],
    });
    if (!ok) return;
    await onRegenerate();
  }
</script>

{#snippet body()}
  {#if failed}
    <div class="font-dmmono" data-invite-state="failed" style="font-size: 10.5px; color: var(--k-ink-mute); line-height: 1.55; padding-top: 10px;">
      {$t['profile.invite.error']}
      {#if onRetry}
        <button
          type="button"
          onclick={onRetry}
          style="font-family: var(--k-font-mono); font-size: 10.5px; font-weight: 700; color: var(--k-ink-mute); background: none; border: none; border-bottom: 1.5px solid var(--k-ink-mute); padding: 0; cursor: pointer;"
        >{$t['profile.save.retry']}</button>
      {/if}
    </div>
  {:else if !invite}
    <div data-invite-state="loading" aria-busy="true" style="height: 72px; margin-top: 10px; border-radius: var(--k-radius-sm); background: var(--k-rule); opacity: 0.35;"></div>
  {:else if invite.block}
    <div class="font-bricolage" data-invite-state="blocked" data-invite-block={invite.block} style="font-size: 13px; line-height: 1.5; color: var(--k-ink-soft); padding-top: 10px;">
      {#if invite.block === 'too_new'}
        {tStr($t['profile.invite.block.too_new'], { d: invite.unlockAt ? formatDdMmYyyy(invite.unlockAt, loc) : '—' })}
      {:else if invite.block === 'unverified'}
        {$t['profile.invite.block.unverified']}
      {:else if invite.block === 'paused'}
        {$t['profile.invite.block.paused']}
      {:else if invite.block === 'banned'}
        {$t['profile.invite.block.banned']}
      {:else}
        {$t['profile.invite.block.paused_all']}
      {/if}
    </div>
  {:else}
    <p class="font-bricolage" data-invite-state="ready" style="font-size: 12.5px; line-height: 1.5; color: var(--k-ink-soft); margin: 10px 0 0;">
      {tStr($t['profile.invite.intro'], { max: INVITE_USES })}
    </p>

    <div style="display: flex; gap: 14px; align-items: flex-start; margin-top: 14px;">
      {#if invite.qrSvg}
        <div data-invite-qr role="img" aria-label={$t['profile.invite.qr.alt']} style="flex-shrink: 0; width: 96px; height: 96px; padding: 6px; background: var(--k-paper); border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-sm);">
          {@html invite.qrSvg}
        </div>
      {/if}
      <div style="min-width: 0; flex: 1;">
        <div class="font-dmmono" style="font-size: 9.5px; color: var(--k-ink-mute); letter-spacing: 0.14em;">LINK</div>
        <div data-invite-url class="font-dmmono" style="font-size: 11.5px; line-height: 1.45; margin-top: 4px; overflow-wrap: anywhere; user-select: all;">{invite.url}</div>
        <div data-invite-left class="font-dmmono" style="font-size: 10px; color: {invite.left === 0 ? 'var(--k-warn)' : 'var(--k-ink-mute)'}; margin-top: 8px; letter-spacing: 0.05em;">
          {tStr($t['profile.invite.left'], { left: invite.left, max: INVITE_USES })}
          {#if invite.left === 0 && invite.nextFreeAt}
            &nbsp;·&nbsp;{tStr($t['profile.invite.nextFree'], { d: formatDdMmYyyy(invite.nextFreeAt, loc) })}
          {/if}
        </div>
      </div>
    </div>

    <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px;">
      {#if canShare}
        <PBtn primary small class="kiosk-tap" onclick={share}><span data-invite-share>{$t['profile.invite.share']}</span></PBtn>
      {/if}
      <PBtn small class="kiosk-tap" href={mailHref}><span data-invite-mail>{$t['profile.invite.mail']}</span></PBtn>
      <PBtn small class="kiosk-tap" onclick={copy}><span data-invite-copy>{$t['profile.invite.copy']}</span></PBtn>
    </div>

    {#if invite.invitees.length > 0}
      <div style="margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--k-rule);">
        <div class="font-dmmono" style="font-size: 9.5px; color: var(--k-ink-mute); letter-spacing: 0.14em;">{$t['profile.invite.invitees']}</div>
        <ul data-invite-invitees style="list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px;">
          {#each invite.invitees as person (person.handle ?? person.name + person.joinedAt)}
            <li class="font-bricolage" style="font-size: 12.5px; display: flex; gap: 8px; align-items: baseline; min-width: 0;">
              <span style="font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{person.name || '—'}</span>
              {#if person.handle}<span class="font-dmmono" style="font-size: 10px; color: var(--k-ink-mute);">@{person.handle}</span>{/if}
              <span class="font-dmmono" style="font-size: 10px; color: var(--k-ink-mute); margin-left: auto; white-space: nowrap;">{formatDdMmYyyy(person.joinedAt, loc)}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div style="margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--k-rule);">
      <button
        type="button"
        data-invite-renew
        onclick={renew}
        disabled={busy}
        aria-busy={busy}
        class="font-dmmono"
        style="background: none; border: none; padding: 0; cursor: pointer; font-size: 10.5px; font-weight: 700; color: var(--k-ink-mute); border-bottom: 1.5px solid var(--k-ink-mute); opacity: {busy ? 0.5 : 1};"
      >{$t['profile.invite.renew']}</button>
    </div>
  {/if}
{/snippet}

{#if bare}
  {@render body()}
{:else}
  <PCard>
    <PCardHead n="04" title={$t['profile.invite.title']} />
    {@render body()}
  </PCard>
{/if}
