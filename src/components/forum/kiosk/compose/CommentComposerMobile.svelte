<script lang="ts">
  // Mobile-only sticky comment composer for the post detail page.
  // Pinned just above KioskNav (which sits at `bottom-0` h-12 on mobile).
  // Per JSX `ForumDetailMobile` (kiosk-forum-compose.jsx, lines 998–1143).
  //
  // Resting state is a 36 px-tall pill ("Antworten…"). Tap → inline-grow
  // expansion to a 3-row textarea + cancel/send action row. No backdrop,
  // no scroll-lock — the body keeps scrolling underneath.
  //
  // Reuses ForumPostDetail's existing `submitComment` handler via the
  // `onSubmit` prop. Same optimistic-prepend behaviour as the desktop
  // right-rail composer.

  import KioskAvatar from '../KioskAvatar.svelte';
  import { t } from '../../../../lib/kiosk-i18n';
  import { COMMENT_MAX_LEN, commentCounterVisible } from '../../../../lib/forum/commentLimits';

  let {
    currentUserId = null,
    currentUser = { name: 'du', image: null },
    submitting = false,
    onSubmit,
    embedded = false,
    initialExpanded = false,
    initialDraft = ''
  } = $props<{
    currentUserId?: string | null;
    currentUser?: { name?: string; image?: string | null };
    submitting?: boolean;
    // Resolve `false` when the comment was NOT posted — the draft is then kept.
    onSubmit?: (body: string) => boolean | void | Promise<boolean | void>;
    // Sandbox-only escape hatch: render with `relative` positioning so
    // the bar stays inside its parent in /design-system. Live consumers
    // leave this false — `fixed bottom-12` pins it to the viewport.
    embedded?: boolean;
    // Sandbox-only: pre-expand with sample text so the design audit can
    // see the textarea state without clicking.
    initialExpanded?: boolean;
    initialDraft?: string;
  }>();

  // Always show on /design-system regardless of viewport (it's a sandbox).
  const visibilityClass = $derived(embedded ? '' : 'lg:hidden');
  const positionClass = $derived(embedded ? 'relative' : 'fixed bottom-12 inset-x-0 z-30');

  // svelte-ignore state_referenced_locally
  let expanded = $state(initialExpanded);
  // svelte-ignore state_referenced_locally
  let body = $state(initialDraft);
  let textareaEl: HTMLTextAreaElement | null = $state(null);

  function enterExpanded() {
    expanded = true;
    // Focus the textarea after it mounts.
    queueMicrotask(() => textareaEl?.focus());
  }

  function collapse() {
    expanded = false;
  }

  // Clear + collapse ONLY on success. The earlier effect cleared whenever
  // `submitting` flipped back to false — also after a refused comment, which
  // wiped the draft together with the error (found 2026-09-18).
  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || submitting || !onSubmit) return;
    const ok = await onSubmit(trimmed);
    if (ok !== false) {
      body = '';
      expanded = false;
    }
  }
  const counterVisible = $derived(commentCounterVisible(body.length));

  // ESC collapses. Cmd/Ctrl-Enter submits.
  function onTextareaKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      collapse();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }
</script>

<!-- Logged-out branch: a tap-to-login pill, no composer chrome. -->
{#if !currentUserId}
  <div
    class={`${visibilityClass} ${positionClass} border-t-[1.5px] border-ink bg-paper px-3.5 py-2.5 flex items-center gap-2`}
    style="padding-bottom: max(0.625rem, env(safe-area-inset-bottom));"
  >
    <a
      href="/login"
      class="flex-1 bg-paper-soft border border-rule rounded-full px-4 py-2 font-bricolage text-[13px] text-ink-mute text-center hover:text-ink hover:bg-paper-warm transition-colors"
    >
      {$t['detail.composeLogin']}
    </a>
  </div>
{:else if !expanded}
  <!-- Collapsed: avatar + pill + send button (pill triggers expand) -->
  <div
    class={`${visibilityClass} ${positionClass} border-t-[1.5px] border-ink bg-paper px-3.5 py-2.5 flex items-center gap-2`}
    style="padding-bottom: max(0.625rem, env(safe-area-inset-bottom));"
  >
    <KioskAvatar
      name={currentUser.name ?? 'du'}
      image={currentUser.image ?? null}
      size="sm"
    />
    <button
      type="button"
      onclick={enterExpanded}
      class="flex-1 bg-paper-soft border border-rule rounded-full px-4 py-2 font-bricolage text-[13px] text-ink-mute text-left hover:text-ink hover:bg-paper-warm transition-colors"
    >
      {$t['comment.composer.placeholder.short']}
    </button>
    <button
      type="button"
      onclick={enterExpanded}
      aria-label={$t['comment.composer.send']}
      class="w-9 h-9 rounded-full bg-ink text-paper border-[1.5px] border-ink flex items-center justify-center font-bricolage font-bold text-base hover:bg-ink-soft transition-colors shrink-0"
    >
      ↑
    </button>
  </div>
{:else}
  <!-- Expanded: avatar + 3-row textarea + cancel/send action row -->
  <div
    class={`${visibilityClass} ${positionClass} border-t-[1.5px] border-ink bg-paper px-3.5 pt-2.5 flex flex-col gap-2`}
    style="padding-bottom: max(0.625rem, env(safe-area-inset-bottom));"
  >
    <div class="flex gap-2">
      <KioskAvatar
        name={currentUser.name ?? 'du'}
        image={currentUser.image ?? null}
        size="sm"
      />
      <textarea
        bind:value={body}
        bind:this={textareaEl}
        onkeydown={onTextareaKeydown}
        placeholder={$t['detail.compose.placeholder']}
        rows="3"
        class="flex-1 min-w-0 bg-paper-soft border-[1.5px] border-ink rounded-md px-3 py-2 font-bricolage text-[13px] leading-relaxed text-ink placeholder:text-ink-mute/55 outline-none focus:border-wine resize-none"
        maxlength={COMMENT_MAX_LEN}
        disabled={submitting}
      ></textarea>
    </div>
    <div class="flex items-center justify-end gap-2">
      {#if counterVisible}
        <span
          class={`mr-auto font-dmmono text-[10px] ${body.length >= COMMENT_MAX_LEN ? 'text-wine' : 'text-ink-mute'}`}
          aria-live="polite"
        >
          {body.length} / {COMMENT_MAX_LEN}
        </span>
      {/if}
      <button
        type="button"
        onclick={collapse}
        disabled={submitting}
        class="px-3 py-1 rounded-full bg-transparent border-[1.5px] border-ink text-ink font-dmmono text-[10.5px] uppercase tracking-[0.08em] disabled:opacity-50"
      >
        {$t['comment.edit.cancel']}
      </button>
      <button
        type="button"
        onclick={submit}
        disabled={!body.trim() || submitting}
        aria-label={$t['comment.composer.send']}
        class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-ink text-paper border-[1.5px] border-ink font-dmmono text-[10.5px] uppercase tracking-[0.08em] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {#if submitting}
          <span class="k-spin" aria-hidden="true">◐</span>
        {/if}
        {$t['detail.compose.submit']}
      </button>
    </div>
  </div>
{/if}
