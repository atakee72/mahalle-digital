<script lang="ts">
  // Single threaded comment — Editorial Kiosk treatment.
  //   ┌─────────────────────────────────────────────────────┐
  //   │ [avatar] Lena K. [OP]   · vor 4 min · bearbeitet ✎🗑 │
  //   │ ♥ 3                                                  │
  //   │ Body text (1-2 lines)                                │
  //   └─────────────────────────────────────────────────────┘
  //
  // Actions row is author-XOR-reader: the author sees pencil + trash, any
  // other logged-in viewer sees the ⚑ report trigger instead (the two
  // guards are mutually exclusive, so they share one slot).
  // Pencil is gated by:
  //   • isLatest — this is the newest comment on the thread (no later
  //     comment from anyone has landed yet).
  //   • inTimeWindow — under 15 min since `comment.date`.
  //   • isApproved — `moderationStatus === 'approved'` AND not warning-
  //     labelled (admin-set; editing around moderation is blocked).
  // Trash is visible whenever the viewer is the author (no time window).

  import { linkifySegments, displayUrl } from '../../../lib/linkify';
  import KioskAvatar from './KioskAvatar.svelte';
  import TranslateControl from './TranslateControl.svelte';
  import KioskReportModal from './KioskReportModal.svelte';
  import { t, tStr } from '../../../lib/kiosk-i18n';

  let {
    comment,
    isOP = false,
    isLatest = false,
    currentUserId = null,
    onEdit,
    onDelete
  } = $props<{
    comment: {
      _id: string;
      body?: string;
      content?: string;
      author?: { name?: string; image?: string | null; _id?: string } | string | null;
      date?: string | number;
      likes?: number;
      editedAt?: string | Date | null;
      moderationStatus?: 'approved' | 'pending' | 'rejected';
      hasWarningLabel?: boolean;
    };
    isOP?: boolean;
    isLatest?: boolean;
    currentUserId?: string | null;
    onEdit?: (newBody: string) => Promise<void>;
    onDelete?: () => Promise<void>;
  }>();

  const EDIT_WINDOW_MS = 15 * 60 * 1000;

  function authorIdOf(v: any): string | null {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && v._id) return String(v._id);
    return null;
  }

  function commentDateMs(d?: string | number): number {
    if (d == null) return 0;
    if (typeof d === 'number') return d;
    return new Date(d).getTime();
  }

  function relTime(d?: string | number): string {
    const ms = commentDateMs(d);
    if (!ms) return '';
    const min = Math.floor((Date.now() - ms) / 60_000);
    if (min < 1) return 'gerade eben';
    if (min < 60) return `vor ${min} min`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `vor ${hr} std`;
    return `vor ${Math.floor(hr / 24)} t`;
  }

  // Different schemas use `body` vs `content` — accept both.
  const originalBody = $derived(comment.body ?? comment.content ?? '');
  // Translation overlay (Task 5) — null when no translation is showing.
  // `enterEdit`/`saveEdit` below read `originalBody` directly, never this,
  // so a translated string can never reach the edit form or a save path.
  let translation = $state<{ title: string | null; body: string } | null>(null);
  const body = $derived(translation?.body ?? originalBody);
  const likeCount = $derived(comment.likes ?? 0);
  const isEdited = $derived(!!comment.editedAt);

  const isAuthor = $derived(
    !!currentUserId && authorIdOf(comment.author) === currentUserId
  );
  const commentAuthorId = $derived(authorIdOf(comment.author));
  const commentAuthorName = $derived(
    typeof comment.author === 'object' ? (comment.author?.name ?? 'anonym') : 'anonym'
  );
  const viewProfileLabel = $derived(
    tStr($t['profile.public.viewprofile'], { name: commentAuthorName })
  );
  const inTimeWindow = $derived(
    Date.now() - commentDateMs(comment.date) < EDIT_WINDOW_MS
  );
  const isApproved = $derived(
    (comment.moderationStatus ?? 'approved') === 'approved' && !comment.hasWarningLabel
  );
  const canEdit = $derived(isAuthor && isLatest && inTimeWindow && isApproved && !!onEdit);
  const canDelete = $derived(isAuthor && !!onDelete);
  // Mirrors the post-level guard in ForumPostDetail: logged in, not your own.
  const canReport = $derived(!!currentUserId && !isAuthor);

  let reportOpen = $state(false);
  // The modal's subtitle wants a short handle on what's being reported;
  // a comment has no title, so quote the (untranslated) opening words.
  const reportTitle = $derived(
    originalBody.length > 60 ? `${originalBody.slice(0, 60).trimEnd()}…` : originalBody
  );

  // ─── Edit mode ──────────────────────────────────────────────────────
  let editing = $state(false);
  let draft = $state('');
  let saving = $state(false);

  function enterEdit() {
    draft = originalBody;
    editing = true;
  }
  function cancelEdit() {
    editing = false;
    draft = '';
  }

  // Edit-mode guard: a translated string must never reach the edit form
  // or be saved back. enterEdit() already seeds `draft` from
  // `originalBody` directly, but this also clears the displayed
  // translation so re-entering read mode later doesn't show a stale
  // overlay from before the edit.
  $effect(() => {
    if (editing) translation = null;
  });

  async function saveEdit() {
    if (saving || !onEdit) return;
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    if (trimmed === originalBody.trim()) {
      // No-op: skip the moderation API call entirely.
      cancelEdit();
      return;
    }
    // Re-check the time window at save time (no reactive timer; the user
    // could have sat in edit mode after the window closed). Server enforces
    // this too, but the client check avoids a wasted round-trip.
    if (Date.now() - commentDateMs(comment.date) >= EDIT_WINDOW_MS) {
      // Parent shows the toast via its error handler; we just close edit mode
      // and let the parent's onEdit catch the rejection. Simpler: ask parent
      // to handle by passing the body — parent sees the rejection via the
      // server response. But we already know it'll fail, so short-circuit.
      cancelEdit();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('app:toast', {
            detail: { type: 'warning', message: $t['comment.toast.edit.window'] }
          })
        );
      }
      return;
    }
    saving = true;
    try {
      await onEdit(trimmed);
      editing = false;
    } catch {
      // Parent surfaces the toast; keep edit mode open so user can retry.
    } finally {
      saving = false;
    }
  }

  // ESC cancels edit mode.
  $effect(() => {
    if (!editing) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // Cmd/Ctrl-Enter saves.
  function onTextareaKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    }
  }

  async function handleDeleteClick() {
    if (!onDelete) return;
    await onDelete();
  }
</script>

<article class="flex gap-3 py-5 border-t border-dashed border-rule first:border-t-0">
  <!-- Avatar column with heart count below -->
  <div class="flex flex-col items-center gap-1.5 shrink-0">
    <KioskAvatar
      name={typeof comment.author === 'object' ? (comment.author?.name ?? '·') : '·'}
      image={typeof comment.author === 'object' ? (comment.author?.image ?? null) : null}
      size="sm"
      isOP={isOP}
    />
    {#if likeCount > 0}
      <span class="font-dmmono text-[9.5px] tracking-[0.05em] text-ink-mute flex items-center gap-0.5">
        <span aria-hidden="true">♥</span> {likeCount}
      </span>
    {/if}
  </div>

  <!-- Body column -->
  <div class="flex-1 min-w-0">
    <header class="flex items-center flex-wrap gap-2 mb-1">
      {#if commentAuthorId}
        <a
          href={`/nachbarn/id/${commentAuthorId}`}
          class="font-bricolage font-bold text-sm text-ink hover:underline underline-offset-2"
          aria-label={viewProfileLabel}
        >
          {commentAuthorName}
        </a>
      {:else}
        <span class="font-bricolage font-bold text-sm text-ink">
          {commentAuthorName}
        </span>
      {/if}
      {#if isOP}
        <span class="inline-flex items-center px-1.5 py-0.5 rounded font-dmmono text-[9px] uppercase tracking-[0.1em] bg-wine text-paper font-medium">
          OP
        </span>
      {/if}
      <span class="font-dmmono text-[10px] uppercase tracking-[0.08em] text-ink-mute">
        · {relTime(comment.date)}
      </span>
      {#if isEdited}
        <span class="font-instrument italic text-[11px] text-ink-mute">
          · {$t['comment.edited']}
        </span>
      {/if}
      {#if (canEdit || canDelete || canReport) && !editing}
        <!-- Hit-area extenders (the `aria-hidden` absolute spans) grow each
             control's tap target without touching its visible box — the
             SaveToggle pattern. Vertical is free (the header row has room
             above and below); horizontal is capped at half the 10px
             `gap-2.5` so two adjacent extenders meet but never overlap —
             which lands the tap targets at ~42px rather than a full 44,
             the deliberate trade for not restructuring the row. -->
        <span
          class="ml-auto inline-flex items-center gap-2.5"
        >
          {#if canEdit}
            <button
              type="button"
              onclick={enterEdit}
              class="relative font-dmmono text-[10.5px] uppercase tracking-[0.08em] text-ink-mute hover:text-ink underline-offset-2 hover:underline"
              aria-label={$t['comment.actions.edit']}
            >
              ✎ {$t['comment.actions.edit']}
              <span aria-hidden="true" style="position:absolute; inset:-13px -5px;"></span>
            </button>
          {/if}
          {#if canDelete}
            <button
              type="button"
              onclick={handleDeleteClick}
              class="relative font-dmmono text-[10.5px] uppercase tracking-[0.08em] text-ink-mute hover:text-danger underline-offset-2 hover:underline"
              aria-label={$t['comment.actions.delete']}
            >
              🗑 {$t['comment.actions.delete']}
              <span aria-hidden="true" style="position:absolute; inset:-13px -5px;"></span>
            </button>
          {/if}
          {#if canReport}
            <button
              type="button"
              onclick={() => (reportOpen = true)}
              class="relative font-dmmono text-[10.5px] uppercase tracking-[0.08em] text-ink-mute hover:text-danger underline-offset-2 hover:underline"
              aria-label={$t['comment.actions.report']}
            >
              ⚑ {$t['comment.actions.report']}
              <span aria-hidden="true" style="position:absolute; inset:-13px -5px;"></span>
            </button>
          {/if}
        </span>
      {/if}
    </header>

    {#if editing}
      <textarea
        bind:value={draft}
        onkeydown={onTextareaKeydown}
        maxlength="1000"
        rows="3"
        class="w-full bg-paper-soft border-[1.5px] border-ink rounded-md px-3 py-2 font-bricolage text-sm leading-relaxed text-ink outline-none focus:border-wine resize-y min-h-[72px]"
      ></textarea>
      <div class="mt-2 flex items-center gap-2">
        <button
          type="button"
          onclick={saveEdit}
          disabled={saving || draft.trim().length === 0}
          class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-ink text-paper border-2 border-ink font-dmmono text-[10.5px] uppercase tracking-[0.08em] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {#if saving}
            <span class="k-spin" aria-hidden="true">◐</span>
          {/if}
          {$t['comment.edit.save']}
        </button>
        <button
          type="button"
          onclick={cancelEdit}
          disabled={saving}
          class="inline-flex items-center px-3 py-1 rounded-full bg-transparent border-2 border-ink text-ink font-dmmono text-[10.5px] uppercase tracking-[0.08em] disabled:opacity-50"
        >
          {$t['comment.edit.cancel']}
        </button>
      </div>
    {:else}
      <p class="font-bricolage text-sm text-ink leading-relaxed whitespace-pre-line"
      >{#each linkifySegments(body) as seg}{#if seg.type === 'link'}<a href={seg.value} title={seg.value} target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 decoration-[1.5px] break-words hover:text-wine">{displayUrl(seg.value)}<span aria-hidden="true" class="text-[0.8em] ml-0.5">↗</span></a>{:else}{seg.value}{/if}{/each}</p>
      <div class="mt-1.5">
        <TranslateControl
          contentType="comment"
          contentId={String(comment._id)}
          onTranslated={(t) => (translation = t)}
        />
      </div>
    {/if}
  </div>
</article>

<KioskReportModal
  open={reportOpen}
  contentId={String(comment._id)}
  contentType="comment"
  contentTitle={reportTitle}
  onClose={() => (reportOpen = false)}
/>
