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

  import { untrack } from 'svelte';
  import { linkifySegments, displayUrl } from '../../../lib/linkify';
  import { restoreBroadcastText } from '../../../lib/mentions/broadcast';
  import KioskAvatar from './KioskAvatar.svelte';
  import MemberTypeTag from './MemberTypeTag.svelte';
  import MentionPopup from './compose/MentionPopup.svelte';
  import TranslateControl from './TranslateControl.svelte';
  import KioskReportModal from './KioskReportModal.svelte';
  import { t, tStr } from '../../../lib/kiosk-i18n';
  import { COMMENT_MAX_LEN } from '../../../lib/forum/commentLimits';
  import { showToast, showError } from '../../../utils/toast';

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
      author?: { name?: string; image?: string | null; _id?: string; handle?: string | null; memberType?: string } | string | null;
      date?: string | number;
      likes?: number;
      /** Server-computed for the viewer; the `likedBy` list never reaches the browser. */
      likedByMe?: boolean;
      editedAt?: string | Date | null;
      moderationStatus?: 'approved' | 'pending' | 'rejected';
      hasWarningLabel?: boolean;
      /** „@handle" mentions the server resolved at save time — linked by user id. */
      mentions?: { handle: string; userId: string }[];
      /** „@alle" Admin-Hinweis (admin only): stripped from `body`, kept here. */
      broadcast?: { token: string; excludedHandles: string[] } | null;
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
  // Like state: seeded from the server, then driven locally (optimistic flip,
  // rollback on error, authoritative count from the answer). Re-seeded when
  // the parent hands in a different comment copy (edit, refetch).
  let likeCount = $state(0);
  let liked = $state(false);
  let likeBusy = $state(false);
  $effect(() => {
    const serverLikes = comment.likes ?? 0;
    const serverLiked = !!comment.likedByMe;
    // likeBusy is read untracked: finishing a toggle must not re-seed from the stale prop.
    if (untrack(() => likeBusy)) return;
    likeCount = serverLikes;
    liked = serverLiked;
  });
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
  // Names may repeat — the handle tells two „Petra"s apart (2026-09-21).
  const commentAuthorHandle = $derived(
    typeof comment.author === 'object' ? (comment.author?.handle ?? null) : null
  );
  const commentAuthorType = $derived(
    typeof comment.author === 'object' ? (comment.author?.memberType ?? null) : null
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

  // Heart button: logged in and not the author (the server refuses own likes too).
  // A reported comment stays visible as „pending" — the server refuses a like on it,
  // so the button is not offered there (it would fail on every tap).
  const canLike = $derived(
    !!currentUserId && !isAuthor && (comment.moderationStatus ?? 'approved') === 'approved'
  );
  const likeLabel = $derived(
    (liked ? $t['comment.like.remove'] : $t['comment.like.add']) + (likeCount > 0 ? ` (${likeCount})` : '')
  );

  async function toggleLike() {
    if (!canLike || likeBusy) return;
    const next = !liked;
    liked = next;
    likeCount = Math.max(0, likeCount + (next ? 1 : -1));
    likeBusy = true;
    try {
      const res = await fetch('/api/likes/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          postId: String(comment._id),
          collectionType: 'comments',
          action: next ? 'like' : 'unlike'
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        liked = !next; // rollback
        likeCount = Math.max(0, likeCount + (next ? -1 : 1));
        // Never print the API's machine code; say what the member can do.
        showError(
          res.status === 401 ? $t['comment.like.login']
          : data?.error === 'account_banned' ? $t['comment.like.banned']
          : $t['comment.like.error']
        );
        return;
      }
      if (typeof data?.likeCount === 'number') likeCount = data.likeCount; // authoritative
    } catch {
      liked = !next; // rollback
      likeCount = Math.max(0, likeCount + (next ? -1 : 1));
      showError($t['comment.like.error']);
    } finally {
      likeBusy = false;
    }
  }

  let reportOpen = $state(false);
  // The modal's subtitle wants a short handle on what's being reported;
  // a comment has no title, so quote the (untranslated) opening words.
  const reportTitle = $derived(
    originalBody.length > 60 ? `${originalBody.slice(0, 60).trimEnd()}…` : originalBody
  );

  // ─── Edit mode ──────────────────────────────────────────────────────
  let editing = $state(false);
  let draft = $state('');
  // „@" autocomplete in the edit box (2026-09-21).
  let editEl = $state<HTMLTextAreaElement | null>(null);
  let saving = $state(false);

  function enterEdit() {
    draft = restoreBroadcastText(originalBody, comment.broadcast);
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
      showToast($t['comment.toast.edit.window'], { type: 'warning' });
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

<article id={`comment-${comment._id}`} class="flex gap-3 py-5 border-t border-dashed border-rule first:border-t-0">
  <!-- Avatar column with heart count below -->
  <div class="flex flex-col items-center gap-1.5 shrink-0">
    <KioskAvatar
      name={typeof comment.author === 'object' ? (comment.author?.name ?? '·') : '·'}
      image={typeof comment.author === 'object' ? (comment.author?.image ?? null) : null}
      size="sm"
    />
    {#if canLike}
      <!-- 32x32 box via padding + negative margin: the layout footprint stays
           the size of the old count line. -->
      <button
        type="button"
        onclick={toggleLike}
        aria-disabled={likeBusy}
        aria-pressed={liked}
        aria-label={likeLabel}
        title={liked ? $t['comment.like.remove'] : $t['comment.like.add']}
        class="-my-1.5 inline-flex min-h-8 min-w-8 items-center justify-center gap-0.5 font-dmmono text-[10.5px] tracking-[0.05em] transition-colors {liked ? 'text-wine' : 'text-ink-soft hover:text-wine'}"
      >
        <span aria-hidden="true" class="text-[17px] leading-none">{liked ? '♥' : '♡'}</span>
        {#if likeCount > 0}<span>{likeCount}</span>{/if}
      </button>
    {:else if likeCount > 0}
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
      {#if commentAuthorHandle}
        <span class="font-dmmono text-[10px] text-ink-mute">@{commentAuthorHandle}</span>
      {/if}
      <MemberTypeTag type={commentAuthorType} />
      {#if comment.broadcast}<span class="ml-2 inline-block px-1.5 py-0.5 border border-[#6f2f59] text-[#6f2f59] font-dmmono text-[10px] uppercase tracking-wide align-middle" data-admin-hint>{$t['forum.adminHint.tag']}</span>{/if}
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
      <div class="relative">
      <textarea
        bind:value={draft}
        bind:this={editEl}
        onkeydown={onTextareaKeydown}
        maxlength={COMMENT_MAX_LEN}
        rows="3"
        class="w-full bg-paper-soft border-[1.5px] border-ink rounded-md px-3 py-2 font-bricolage text-sm leading-relaxed text-ink outline-none focus:border-wine resize-y min-h-[72px]"
      ></textarea>
      <MentionPopup textarea={editEl} onPick={(v) => (draft = v)} />
      </div>
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
      {#if comment.broadcast && isAuthor}<p class="font-dmmono text-[0.85em] text-ink-mute mb-1" data-admin-hint-token>{comment.broadcast.token}</p>{/if}
      <p class="font-bricolage text-sm text-ink leading-relaxed whitespace-pre-line"
      >{#each linkifySegments(body, comment.mentions ?? []) as seg}{#if seg.type === 'link'}<a href={seg.value} title={seg.value} target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 decoration-[1.5px] break-words hover:text-wine">{displayUrl(seg.value)}<span aria-hidden="true" class="text-[0.8em] ml-0.5">↗</span></a>{:else if seg.type === 'mention'}<a href={`/nachbarn/id/${seg.userId}`} data-mention class="font-semibold text-wine hover:underline underline-offset-2">@{seg.value}</a>{:else}{seg.value}{/if}{/each}</p>
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
