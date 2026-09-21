<script lang="ts">
  // Right-rail comment composer for the post detail page. Replaces the
  // visual stub that landed in Phase 5a.
  //
  // Comments don't run the full ModeratingModal — submit shows a small
  // inline spinner and the optimistic insert lands in the parent's
  // local state immediately. The actual moderation pipeline runs
  // server-side and the comment may come back with `moderationStatus:
  // 'pending'`; for now the optimistic insert displays it as already
  // visible (matches the React legacy behaviour). A future polish pass
  // could surface a small "in Prüfung" pill on the optimistic comment.
  //
  // Auth-gated by the API. If the user isn't logged in, the parent
  // shows the login prompt copy from `detail.composeLogin` instead of
  // mounting this component.

  import KioskAvatar from '../KioskAvatar.svelte';
  import MentionPopup from './MentionPopup.svelte';
  import KioskBtn from '../KioskBtn.svelte';
  import { t } from '../../../../lib/kiosk-i18n';
  import { COMMENT_MAX_LEN, commentCounterVisible } from '../../../../lib/forum/commentLimits';

  let {
    currentUser,
    submitting = false,
    onSubmit
  } = $props<{
    currentUser: { name?: string; image?: string | null };
    submitting?: boolean;
    // Resolve `false` when the comment was NOT posted — the draft is then kept.
    onSubmit: (body: string) => boolean | void | Promise<boolean | void>;
  }>();

  let body = $state('');
  // „@" autocomplete (2026-09-21) — the popup listens on this element.
  let taEl = $state<HTMLTextAreaElement | null>(null);
  const counterVisible = $derived(commentCounterVisible(body.length));

  // Clear the draft ONLY on success. The earlier version cleared whenever
  // `submitting` flipped back to false, i.e. also after a refused comment —
  // which wiped a long answer together with the error (found 2026-09-18).
  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || submitting) return;
    const ok = await onSubmit(trimmed);
    if (ok !== false) body = '';
  }

  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }
</script>

<div>
  <p class="font-dmmono text-[10px] uppercase tracking-[0.12em] text-wine mb-2">
    ◆ {$t['detail.compose.heading']}
  </p>

  <div class="flex gap-2">
    <KioskAvatar
      name={currentUser.name ?? 'du'}
      image={currentUser.image ?? null}
      size="sm"
    />
    <div class="relative flex-1 min-w-0">
      <textarea
        bind:value={body}
        bind:this={taEl}
        onkeydown={onKey}
        placeholder={$t['detail.compose.placeholder']}
        rows="3"
        class="w-full appearance-none bg-paper-warm border-[1.5px] border-ink rounded-md px-3 py-2 font-bricolage text-[13px] leading-relaxed text-ink placeholder:text-ink-mute/55 outline-none focus:border-wine resize-y min-h-[72px]"
        maxlength={COMMENT_MAX_LEN}
        disabled={submitting}
      ></textarea>
      <MentionPopup textarea={taEl} onPick={(v) => (body = v)} />
    </div>
  </div>

  <div class="flex items-center justify-between mt-2 gap-2">
    <span class="font-dmmono text-[10px] text-ink-mute">
      {#if counterVisible}
        <span class={body.length >= COMMENT_MAX_LEN ? 'text-wine' : ''} aria-live="polite">
          {body.length} / {COMMENT_MAX_LEN}
        </span>
        ·
      {/if}
      {$t['detail.compose.modNote']}
    </span>
    <KioskBtn
      variant="primary"
      size="sm"
      onclick={submit}
      disabled={!body.trim() || submitting}
    >
      {submitting ? '…' : $t['detail.compose.submit']}
    </KioskBtn>
  </div>
</div>
