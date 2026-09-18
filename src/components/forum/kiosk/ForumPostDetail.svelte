<script lang="ts">
  // Forum post detail — Editorial Kiosk read view with Phase 5b inline
  // edit + delete + comment composer wiring.
  //
  // Why no @tanstack QueryClient here: the topics cache lives on `/`
  // (ForumIndex's own provider). When we delete from this page we
  // navigate back, and the home page does an SSR fetch — no client
  // cache to keep in sync. Edit + delete use plain fetch; the comment
  // composer prepends to a local `comments` state.
  //
  // Edit mode is gated on the viewer being the topic author. ESC and
  // the cancel button both use the global confirmAction() to confirm
  // discarding unsaved changes — same pattern as the React legacy
  // forum, no new dialog.

  import { t, tStr, locale } from '../../../lib/kiosk-i18n';
  import { relTime as relTimeFor } from '../../../lib/relTime';
  import { linkifySegments, displayUrl } from '../../../lib/linkify';
  import { collectionForKind, type PostKind } from '../../../lib/forum/postKind';
  import KioskAvatar from './KioskAvatar.svelte';
  import KioskBtn from './KioskBtn.svelte';
  import TranslateControl from './TranslateControl.svelte';
  import PostTypeChip from './PostTypeChip.svelte';
  import StatusBadge from './StatusBadge.svelte';
  import ForumCommentList from './ForumCommentList.svelte';
  import EditModeBanner from './compose/EditModeBanner.svelte';
  import DeleteConfirmCard from './compose/DeleteConfirmCard.svelte';
  import CommentComposer from './compose/CommentComposer.svelte';
  import CommentComposerMobile from './compose/CommentComposerMobile.svelte';
  import OwnStatusBanner from './states/OwnStatusBanner.svelte';
  import KioskReportModal from './KioskReportModal.svelte';
  import { confirmAction, showError, showToast } from '../../../utils/toast';
  import { optimizeCloudinary } from '../../../utils/cloudinary';

  let {
    initialTopic,
    initialComments = [],
    currentUserId = null,
    collectionType = 'topics',
    isOfficial = false,
    related = [],
    currentUser = null
  } = $props<{
    initialTopic: any;
    initialComments?: any[];
    currentUserId?: string | null;
    /** „Ähnliche Themen" rail items — SSR-picked by fetchRelatedForDetail()
     *  (shared tags first, newest-first fill), same collection as the post.
     *  Empty array hides the section. */
    related?: { id: string; title: string; replies: number; date: string | number }[];
    /** Trimmed session user for the reply composers' own-avatar disc — name +
     *  image only, never the raw session object. Was a hardcoded „du" disc
     *  with no photo (user, 2026-09-11). */
    currentUser?: { name?: string | null; image?: string | null } | null;
    /** Which forum sub-collection the post lives in. Drives the
     *  edit/delete fetch URLs and the comment-create `collectionType`
     *  field. Defaults to 'topics' so the existing /topics/[id] route
     *  keeps working without changes. */
    collectionType?: 'topics' | 'announcements' | 'recommendations';
    /** Mirrors the card-level prop. When true (admin official
     *  announcement), the breadcrumb chip + page header read
     *  "OFFIZIELLE ANKÜNDIGUNG · MAHALLE-TEAM"; when false, the softer
     *  "ANKÜNDIGUNG" label. Only meaningful for collectionType ===
     *  'announcements'. */
    isOfficial?: boolean;
  }>();

  // svelte-ignore state_referenced_locally
  let topic = $state(initialTopic);
  // svelte-ignore state_referenced_locally
  let comments = $state<any[]>(initialComments);

  function authorIdOf(v: any): string | null {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && v._id) return String(v._id);
    return null;
  }

  const isAuthor = $derived(
    !!currentUserId && authorIdOf(topic.author) === currentUserId
  );

  const authorId = $derived(authorIdOf(topic.author));
  const authorName = $derived(topic.author?.name ?? 'anonym');
  const viewProfileLabel = $derived(tStr($t['profile.public.viewprofile'], { name: authorName }));

  // Map plural collectionType → singular API contentType for /api/reports/submit.
  const reportContentType = $derived(
    collectionType === 'announcements'
      ? ('announcement' as const)
      : collectionType === 'recommendations'
      ? ('recommendation' as const)
      : ('topic' as const)
  );
  let reportOpen = $state(false);

  // Map sub-collection → ForumPostCard `kind` so the breadcrumb chip
  // and tone match the index.
  const kind: 'discussion' | 'recommendation' | 'announcement' = $derived(
    collectionType === 'announcements'
      ? 'announcement'
      : collectionType === 'recommendations'
      ? 'recommendation'
      : 'discussion'
  );
  const kindLabel = $derived(
    kind === 'announcement' && isOfficial
      ? ($t['pinned.banner.label'] as string)
      : kind === 'announcement'
      ? ($t['card.strap.announcement'] as string)
      : ($t[`chip.${kind}` as const] as string).toUpperCase()
  );

  // Kind chip on the meta row — direct port of the card kind-chip
  // (filled wine/moss/teal + paper text + 1px ink border + rounded-lg).
  // Distinct from `<PostTypeChip>` — that component's `selected` mode
  // adds a 2px border + print shadow for the filter pill.
  const chipBg = $derived(
    kind === 'announcement' ? 'bg-teal' : kind === 'recommendation' ? 'bg-moss' : 'bg-wine'
  );
  const chipLabel = $derived(($t[`chip.${kind}` as const] as string).toUpperCase());

  // Kind cards for edit mode — same three as the compose screen's type
  // selector (ComposeForm.svelte `types`), same i18n keys, same colour vars.
  const EDIT_KINDS: {
    k: PostKind;
    labelKey: 'compose.type.discussion' | 'compose.type.recommendation' | 'compose.type.announcement';
    colorVar: string;
  }[] = [
    { k: 'discussion',     labelKey: 'compose.type.discussion',     colorVar: '--k-wine' },
    { k: 'recommendation', labelKey: 'compose.type.recommendation', colorVar: '--k-moss' },
    { k: 'announcement',   labelKey: 'compose.type.announcement',   colorVar: '--k-teal' }
  ];
  // Official announcements never change kind (admin dashboard + pin lifecycle).
  const canChangeKind = $derived(!(kind === 'announcement' && isOfficial));

  let now = $state(new Date());
  $effect(() => {
    const id = setInterval(() => (now = new Date()), 60_000);
    return () => clearInterval(id);
  });

  const relTime = (iso?: string | number) => relTimeFor(iso, $locale);

  const memberSince = $derived.by(() => {
    const created = topic.author?.createdAt;
    if (!created) return '';
    const y = new Date(created).getFullYear();
    return Number.isFinite(y) ? ($locale === 'de' ? `seit ${y}` : `since ${y}`) : '';
  });

  // Translation overlay (Task 5) — null when no translation is showing.
  // Never feeds the edit form or any save path (see enterEdit / isDirty,
  // which read `topic.title` / `topic.body` directly, and the
  // reset-on-edit effect below).
  let translation = $state<{ title: string | null; body: string } | null>(null);
  const displayTitle = $derived(translation?.title ?? topic.title);
  const displayBody = $derived(translation?.body ?? (topic.body ?? topic.description ?? ''));

  const paragraphs = $derived(
    displayBody
      .split(/\n{2,}/)
      .map((p: string) => p.trim())
      .filter(Boolean)
  );

  const presenceCount = $derived(
    Math.min(Math.max(Math.floor((topic.views ?? 0) / 10), 1), 200)
  );

  const badgeState = $derived(
    topic.moderationStatus === 'pending' ? 'pending'
    : topic.moderationStatus === 'rejected' ? 'rejected'
    : topic.isUserReported ? 'reported'
    : topic.hasWarningLabel ? 'warning'
    : null
  );

  // Detail-page parity with the feed: when the AUTHOR lands on their
  // own community-reported pending post, surface the plum
  // OwnStatusBanner so they're informed their post got reported.
  // Non-authors see the post normally — the small ⚑ GEMELDET chip in
  // the breadcrumb's StatusBadge is enough mark for them; reports
  // stay private to author + admin until acted on (anti-stigma + matches
  // mature platform norms — HN, Reddit, X for low-severity reports).
  const showReportedBanner = $derived(
    isAuthor &&
      !!topic.isUserReported &&
      topic.moderationStatus === 'pending'
  );

  // Author-side rejected banner — parity with the index's rejected
  // branch. Shows the admin's `rejectionReason` (if they wrote one)
  // as an italic quote below the generic body copy so the author
  // sees exactly why their post was declined.
  const showRejectedBanner = $derived(
    isAuthor && topic.moderationStatus === 'rejected'
  );

  // Author-side pending banner — parity with the index. Covers BOTH
  // AI-flagged pending (`!isUserReported`) and is left out for
  // community-reported pending (which uses showReportedBanner above).
  const showPendingBanner = $derived(
    isAuthor &&
      topic.moderationStatus === 'pending' &&
      !topic.isUserReported
  );

  // Edit gate. Mirrors the server-side check in
  // /api/{collection}/edit/[id].ts — edit is only allowed when the post
  // is fully approved AND not carrying a warning label. In-review or
  // warning-labelled content can't be silently rewritten while
  // moderators are still looking at the original.
  const canEdit = $derived(
    isAuthor &&
      topic.moderationStatus === 'approved' &&
      !topic.hasWarningLabel
  );

  const replyCount = $derived(comments.length);

  // Like state — the engagement-strip heart. Initial filled state from the
  // post's likedBy (server projects it; detail findOne returns the full doc).
  // Optimistic flip with rollback; the in-flight lock is the drift guard —
  // the API's $inc isn't conditioned on $addToSet actually adding, so we must
  // never fire a redundant action. Reconcile the count from the authoritative
  // response (likeCount). Mirrors toggleBookmark() below.
  // svelte-ignore state_referenced_locally
  let liked = $state(
    !!currentUserId && (topic.likedBy ?? []).some((id: unknown) => String(id) === currentUserId)
  );
  // svelte-ignore state_referenced_locally
  let likeCount = $state(topic.likes ?? 0);
  let likeBusy = $state(false);
  async function toggleLike() {
    if (!currentUserId || likeBusy) return;
    const next = !liked;
    liked = next;
    likeCount += next ? 1 : -1;
    likeBusy = true;
    try {
      const res = await fetch('/api/likes/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          postId: String(topic._id),
          collectionType,
          action: next ? 'like' : 'unlike'
        })
      });
      if (!res.ok) throw new Error(`like failed (${res.status})`);
      const data = await res.json().catch(() => null);
      if (typeof data?.likeCount === 'number') likeCount = data.likeCount; // authoritative
    } catch {
      liked = !next; // rollback
      likeCount += next ? -1 : 1;
      showError($locale === 'de' ? 'Aktion fehlgeschlagen.' : 'Could not update like.');
    } finally {
      likeBusy = false;
    }
  }

  // Save / bookmark state — fetched once on mount via /api/posts/save (GET
  // returns the user's saved-post id list). Toggled via POST {action:
  // save|unsave}. Optimistic flip with rollback on network error.
  let bookmarked = $state(false);
  let bookmarkBusy = $state(false);
  $effect(() => {
    if (!currentUserId || !topic._id) return;
    fetch('/api/posts/save', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.savedIds) {
          bookmarked = data.savedIds.includes(String(topic._id));
        }
      })
      .catch(() => {});
  });
  async function toggleBookmark() {
    if (!currentUserId || bookmarkBusy) return;
    const next = !bookmarked;
    bookmarked = next;
    bookmarkBusy = true;
    try {
      const res = await fetch('/api/posts/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ postId: String(topic._id), action: next ? 'save' : 'unsave' })
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
    } catch {
      bookmarked = !next; // rollback
      showError($locale === 'de' ? 'Speichern fehlgeschlagen.' : 'Could not save.');
    } finally {
      bookmarkBusy = false;
    }
  }

  const heroImage = $derived(
    topic.images?.[0]?.url ? optimizeCloudinary(topic.images[0].url) : null
  );
  const firstTag = $derived(topic.tags?.[0] ?? null);
  // Kiez-verification pipeline (Aug 2026): the badge is earned (admin
  // toggle), strictly on the author's flag. `topic.author` is populated
  // server-side by populateAuthors() with `verified` in its projection.
  const isVerified = $derived(topic.author?.verified === true);
  const editHistoryCount = $derived(topic.editHistory?.length ?? 0);

  // ─── Edit mode ──────────────────────────────────────────────────────
  let editing = $state(false);
  let deleteOpen = $state(false);
  let editTitle = $state('');
  let editBody = $state('');
  let editKind = $state<PostKind>('discussion');
  let saving = $state(false);
  let deleting = $state(false);
  let editError = $state<string | null>(null);

  const isDirty = $derived(
    editing &&
      (editTitle !== topic.title ||
        editBody !== (topic.body ?? topic.description ?? '') ||
        editKind !== kind)
  );

  function enterEdit() {
    editTitle = topic.title;
    editBody = topic.body ?? topic.description ?? '';
    editKind = kind;
    editError = null;
    editing = true;
  }

  // Edit-mode guard: a translated string must never reach the edit form
  // or be saved back. enterEdit() already seeds editTitle/editBody from
  // the untranslated `topic` fields directly, but this also clears the
  // displayed translation so re-entering read mode later doesn't show a
  // stale overlay from before the edit.
  $effect(() => {
    if (editing) translation = null;
  });

  async function cancelEdit(skipConfirm = false) {
    if (!skipConfirm && isDirty) {
      const ok = await confirmAction($t['edit.confirm.discard'], {
        confirmLabel: $t['edit.cta.cancel'],
        variant: 'warning'
      });
      if (!ok) return;
    }
    editing = false;
    deleteOpen = false;
    editError = null;
  }

  async function saveEdit() {
    if (saving) return;
    if (editTitle.trim().length < 5 || editBody.trim().length < 10) {
      editError = 'Titel mind. 5, Text mind. 10 Zeichen.';
      return;
    }
    const textDirty =
      editTitle !== topic.title || editBody !== (topic.body ?? topic.description ?? '');
    const kindDirty = editKind !== kind;
    saving = true;
    editError = null;
    let navigating = false;
    try {
      // 1. Text first, against the CURRENT collection (the edit endpoint is
      //    per collection and the post is still there).
      if (textDirty) {
        const res = await fetch(`/api/${collectionType}/edit/${topic._id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            title: editTitle.trim(),
            body: editBody.trim(),
            tags: topic.tags ?? [],
            images: topic.images ?? []
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || 'Speichern fehlgeschlagen.');
        }
        const json = await res.json();
        topic = { ...topic, ...json.topic };
      }
      // 2. Kind change = cross-collection move; the post gets a new URL, so
      //    this island (fetch URLs keyed on collectionType) hands over via a
      //    hard navigation instead of re-keying itself in place.
      if (kindDirty) {
        const res = await fetch(`/api/posts/move/${topic._id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ from: collectionType, to: collectionForKind(editKind) })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          // An edit that just went back to `pending` (AI flag) locks the
          // move — say whether the text WAS saved (this edit re-triggered
          // moderation) or the post was already locked before this save.
          console.error('move failed', err);
          throw new Error(
            err.error === 'edit_blocked_by_moderation'
              ? textDirty
                ? ($t['edit.kind.blocked'] as string)
                : ($t['edit.kind.locked'] as string)
              : ($t['edit.kind.failed'] as string)
          );
        }
        const json = await res.json();
        navigating = true;
        if (typeof window !== 'undefined') window.location.href = json.href;
        return;
      }
      editing = false;
    } catch (err) {
      editError = err instanceof Error ? err.message : 'Speichern fehlgeschlagen.';
    } finally {
      if (!navigating) saving = false; // keep the buttons locked while the new page loads
    }
  }

  async function confirmDelete() {
    if (deleting) return;
    deleting = true;
    try {
      const res = await fetch(`/api/${collectionType}/delete/${topic._id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Löschen fehlgeschlagen.');
      }
      if (typeof window !== 'undefined') window.location.href = '/forum';
    } catch (err) {
      editError = err instanceof Error ? err.message : 'Löschen fehlgeschlagen.';
      deleting = false;
    }
  }

  // ESC cancels edit mode (with dirty-check confirm).
  $effect(() => {
    if (!editing) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (saving) return;
        e.preventDefault();
        cancelEdit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // ─── Comment edit / delete ──────────────────────────────────────────
  // Plain fetch (matches saveEdit / confirmDelete / submitComment patterns
  // on this page — the topics svelte-query cache lives on `/`, not here).
  // Optimistic patches operate on the local `comments` $state directly.

  async function handleEditComment(commentId: string, newBody: string) {
    const idx = comments.findIndex((c) => String(c._id) === String(commentId));
    if (idx === -1) return;
    const snapshot = comments;
    const optimisticComment = {
      ...comments[idx],
      body: newBody,
      editedAt: new Date().toISOString()
    };
    comments = [
      ...comments.slice(0, idx),
      optimisticComment,
      ...comments.slice(idx + 1)
    ];

    try {
      const res = await fetch(`/api/comments/edit/${commentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ body: newBody })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        comments = snapshot;
        if (err.error === 'edit_window_expired') {
          showToast($t['comment.toast.edit.window'], { type: 'warning' });
        } else if (err.error === 'edit_blocked_by_moderation') {
          showToast($t['comment.toast.edit.flagged'], { type: 'warning' });
        } else {
          showError($t['comment.toast.edit.error']);
        }
        throw new Error(err.error ?? 'edit_failed');
      }
      const json = await res.json();
      const returned = json.comment;
      if (returned?.moderationStatus && returned.moderationStatus !== 'approved') {
        // Re-moderation flagged it — drop from local state to match the
        // approved-only filter the GET endpoint applies on next refetch.
        comments = comments.filter((c) => String(c._id) !== String(commentId));
      } else {
        // Replace the optimistic entry with the server's authoritative copy.
        comments = comments.map((c) =>
          String(c._id) === String(commentId) ? returned : c
        );
      }
    } catch (err) {
      // Rollback already done above when !res.ok; rethrow so the child can
      // keep edit mode open on failure.
      throw err;
    }
  }

  async function handleDeleteComment(commentId: string) {
    const ok = await confirmAction($t['comment.delete.confirm.body'], {
      title: $t['comment.delete.confirm.title'],
      confirmLabel: $t['comment.delete.confirm.cta'],
      variant: 'danger'
    });
    if (!ok) return;

    const snapshot = comments;
    comments = comments.filter((c) => String(c._id) !== String(commentId));

    try {
      const res = await fetch(`/api/comments/delete/${commentId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!res.ok) {
        comments = snapshot;
        showError($t['comment.toast.delete.error']);
      }
    } catch {
      comments = snapshot;
      showError($t['comment.toast.delete.error']);
    }
  }

  // ─── Comment composer ───────────────────────────────────────────────
  let postingComment = $state(false);
  // Resolves true when the comment was posted, false otherwise — the
  // composers keep the draft on false. Refusals surface as a localized toast
  // (was a raw browser alert with the API's internal "Validation failed").
  async function submitComment(body: string): Promise<boolean> {
    if (postingComment) return false;
    postingComment = true;
    try {
      const res = await fetch('/api/comments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ body, topicId: topic._id, collectionType })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 400 && err?.details?.body) {
          showError($t['comment.toast.create.tooLong']);
        } else if (res.status === 401) {
          showError($t['comment.toast.create.login']);
        } else if (err?.error === 'account_banned') {
          showError($t['comment.toast.create.banned']);
        } else {
          showError($t['comment.toast.create.error']);
        }
        return false;
      }
      const json = await res.json();
      // Optimistically prepend (matches API sort order — newest first).
      comments = [json.comment, ...comments];
      return true;
    } catch (err) {
      console.error('comment create failed', err);
      showError($t['comment.toast.create.error']);
      return false;
    } finally {
      postingComment = false;
    }
  }
</script>

<main class="max-w-7xl mx-auto px-4 md:px-8 lg:px-10 pt-5 md:pt-8 pb-28 lg:pb-8">
  {#if editing}
    <EditModeBanner />
  {/if}

  <!-- ── Breadcrumb + presence row ─────────────────────────────── -->
  <div
    class="flex items-center justify-between gap-4 mb-5 pb-2.5 border-b border-dashed border-rule font-dmmono text-[10.5px] uppercase tracking-[0.05em] text-ink-mute"
  >
    <a href="/forum" class="inline-flex items-center gap-2 hover:text-ink transition-colors">
      <span aria-hidden="true">←</span>
      <span>FORUM</span>
      <span aria-hidden="true">·</span>
      <span class="underline decoration-dashed underline-offset-[3px]">{kindLabel}</span>
      {#if firstTag}
        <span aria-hidden="true">·</span>
        <span class="text-ink lowercase normal-case">#{firstTag}</span>
      {/if}
    </a>
    <span class="inline-flex items-center gap-1.5 text-wine">
      <span aria-hidden="true">↻</span>
      <span class="lowercase">{$t['detail.crumb.live']}</span>
      <span aria-hidden="true">·</span>
      <span>{presenceCount} <span class="lowercase">{$t['detail.crumb.reading']}</span></span>
    </span>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-8 lg:gap-10">
    <!-- ── Main column ──────────────────────────────────────────── -->
    <article>
      {#if showPendingBanner}
        <div class="mb-4">
          <OwnStatusBanner state="pending" />
        </div>
      {/if}
      {#if showReportedBanner}
        <div class="mb-4">
          <OwnStatusBanner state="reported" />
        </div>
      {/if}
      {#if showRejectedBanner}
        <div class="mb-4">
          <OwnStatusBanner state="rejected" reason={topic.rejectionReason} />
        </div>
      {/if}

      <!-- Type chip + age + tags + status + edit button -->
      <div class="flex items-center flex-wrap gap-2.5 mb-3">
        <span
          class={`inline-flex items-center font-dmmono font-medium text-[10px] tracking-[0.08em] text-paper border border-ink rounded-lg px-[9px] py-[3px] ${chipBg}`}
        >
          {chipLabel}
        </span>
        <span class="font-dmmono text-[10.5px] uppercase tracking-[0.05em] text-ink-mute">
          · {relTime(topic.date)}
        </span>
        {#if topic.tags?.length}
          <span class="font-dmmono text-[10.5px] tracking-[0.04em] text-ink-mute lowercase">
            · {topic.tags.map((tg: string) => `#${tg}`).join(' ')}
          </span>
        {/if}
        {#if badgeState}
          <StatusBadge state={badgeState} size="sm" />
        {/if}
        {#if isAuthor && !editing}
          <button
            type="button"
            onclick={canEdit ? enterEdit : undefined}
            disabled={!canEdit}
            title={canEdit
              ? undefined
              : ($locale === 'de'
                  ? 'Bearbeiten nicht möglich, solange der Beitrag geprüft wird.'
                  : 'Editing is locked while the post is under review.')}
            aria-disabled={!canEdit}
            class={`ml-auto font-dmmono text-[10.5px] uppercase tracking-[0.08em] underline-offset-2 ${
              canEdit
                ? 'text-ink-mute hover:text-ink hover:underline cursor-pointer'
                : 'text-ink-mute/50 cursor-not-allowed line-through'
            }`}
          >
            ✎ Bearbeiten
          </button>
        {/if}
      </div>

      <!-- Title (read or editable) -->
      {#if editing}
        <input
          type="text"
          bind:value={editTitle}
          maxlength="80"
          class="w-full bg-paper-warm border-[1.5px] border-ink rounded-md px-4 py-2.5 mb-3 font-bricolage font-extrabold text-2xl md:text-3xl tracking-tight leading-[1.1] text-ink outline-none focus:border-wine"
        />
      {:else}
        <h1
          class="font-bricolage font-extrabold text-3xl md:text-4xl tracking-tight leading-[1.05] text-ink mb-3.5 max-w-[760px] text-balance"
        >
          {displayTitle}
        </h1>
      {/if}

      {#if editing && canChangeKind}
        <div class="mb-4">
          <p id="edit-kind-label" class="font-dmmono text-[10px] uppercase tracking-[0.1em] text-ink-mute mb-1.5">
            {$t['edit.kind.label']}
          </p>
          <div class="flex flex-wrap gap-2" role="group" aria-labelledby="edit-kind-label">
            {#each EDIT_KINDS as opt (opt.k)}
              {@const active = editKind === opt.k}
              <button
                type="button"
                aria-pressed={active}
                disabled={saving}
                onclick={() => (editKind = opt.k)}
                class={`min-h-[44px] px-3.5 py-2 rounded-md border-[1.5px] font-bricolage font-bold text-[13px] tracking-tight transition-colors duration-[180ms] ease-out ${
                  active ? 'text-paper border-transparent' : 'bg-paper-warm text-ink border-ink hover:bg-paper-soft'
                }`}
                style={active ? `background:var(${opt.colorVar});border-color:var(${opt.colorVar});` : ''}
              >
                {$t[opt.labelKey]}
              </button>
            {/each}
          </div>
          {#if editKind !== kind}
            <p class="font-dmmono text-[10px] leading-[1.6] text-ink-mute mt-1.5 max-w-prose">
              {$t['edit.kind.hint']}
            </p>
          {/if}
        </div>
      {/if}

      <!-- Author byline + optional verified badge -->
      <div class="flex items-center gap-2.5 mb-5">
        <KioskAvatar
          name={topic.author?.name ?? '·'}
          image={topic.author?.image ?? null}
          size="md"
        />
        <div class="flex flex-col leading-tight">
          {#if authorId}
            <a
              href={`/nachbarn/id/${authorId}`}
              class="font-bricolage font-bold text-[13px] text-ink hover:underline underline-offset-2"
              aria-label={viewProfileLabel}
            >
              {authorName}
            </a>
          {:else}
            <span class="font-bricolage font-bold text-[13px] text-ink">
              {authorName}
            </span>
          {/if}
          {#if memberSince}
            <span class="font-dmmono text-[10px] uppercase tracking-[0.05em] text-ink-mute">
              {memberSince}
            </span>
          {/if}
        </div>
        {#if isVerified}
          <span
            class="ml-3 inline-flex items-center gap-1 font-dmmono text-[10px] uppercase tracking-[0.08em] text-success"
          >
            <span aria-hidden="true">●</span> {$t['detail.verified']}
          </span>
        {/if}
      </div>

      {#if heroImage && !editing}
        <div class="mb-5 rounded-md border-[1.5px] border-ink overflow-hidden max-w-prose">
          <img
            src={heroImage}
            alt={topic.title}
            class="w-full h-auto max-h-[440px] object-contain bg-paper-soft"
            loading="lazy"
          />
        </div>
      {/if}

      <!-- Body (read or editable) -->
      {#if editing}
        <textarea
          bind:value={editBody}
          maxlength="2000"
          rows="10"
          class="w-full bg-paper-soft border-[1.5px] border-ink rounded-md px-4 py-3.5 mb-5 font-bricolage text-[16px] leading-[1.55] text-ink outline-none focus:border-wine resize-y min-h-[180px]"
        ></textarea>
        <!-- Mobile edit actions: the desktop action column below is `hidden lg:block`,
             so without this row a phone user who taps „Bearbeiten" has no touch-reachable
             save/cancel/delete (mobile audit 2026-09-09). Same handlers + state as the aside. -->
        <div class="lg:hidden mb-5">
          <div class="flex flex-wrap gap-2 mb-3">
            <KioskBtn variant="primary" size="md" onclick={saveEdit} disabled={saving || !isDirty}>
              {saving ? '…' : $t['edit.cta.save']}
            </KioskBtn>
            <KioskBtn variant="secondary" size="md" onclick={() => cancelEdit()} disabled={saving}>
              {$t['edit.cta.cancel']}
            </KioskBtn>
          </div>
          {#if !deleteOpen}
            <KioskBtn variant="danger" size="sm" onclick={() => (deleteOpen = true)}>
              {$t['edit.cta.delete']}
            </KioskBtn>
          {:else}
            <DeleteConfirmCard
              replyCount={replyCount}
              deleting={deleting}
              onConfirm={confirmDelete}
              onCancel={() => (deleteOpen = false)}
            />
          {/if}
        </div>
        {#if editHistoryCount > 0}
          <div class="mb-4">
            <p class="font-dmmono text-[10px] uppercase tracking-[0.1em] text-ink-mute mb-1.5">
              {$t['edit.versions.label']}
            </p>
            <p
              class="font-dmmono text-[11px] text-ink-soft px-3 py-1.5 bg-paper-warm border border-rule rounded-sm inline-block"
            >
              {$t['edit.versions.count'].replace('{n}', String(editHistoryCount))}
            </p>
          </div>
        {/if}
        {#if editError}
          <p class="font-bricolage text-sm text-danger mb-3" role="alert">{editError}</p>
        {/if}
      {:else}
        <div class="space-y-3.5 mb-5 max-w-prose">
          {#each paragraphs as para, i (i)}
            {#if i === 0}
              <p
                class="font-bricolage text-[17px] leading-[1.55] text-ink whitespace-pre-line"
              >{#each linkifySegments(para) as seg}{#if seg.type === 'link'}<a href={seg.value} title={seg.value} target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 decoration-[1.5px] break-words hover:text-wine">{displayUrl(seg.value)}<span aria-hidden="true" class="text-[0.8em] ml-0.5">↗</span></a>{:else}{seg.value}{/if}{/each}</p>
            {:else}
              <p
                class="font-bricolage text-[16px] leading-[1.55] text-ink-soft whitespace-pre-line"
              >{#each linkifySegments(para) as seg}{#if seg.type === 'link'}<a href={seg.value} title={seg.value} target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 decoration-[1.5px] break-words hover:text-wine">{displayUrl(seg.value)}<span aria-hidden="true" class="text-[0.8em] ml-0.5">↗</span></a>{:else}{seg.value}{/if}{/each}</p>
            {/if}
          {/each}
        </div>
        <TranslateControl
          contentType={reportContentType}
          contentId={String(topic._id)}
          onTranslated={(t) => (translation = t)}
          accent="var(--k-wine, #b23a5b)"
        />
      {/if}

      {#if !editing}
        <!-- Engagement strip. `flex-wrap` is load-bearing on mobile: at
             375px the three pills already fill the line, so share + report
             (the `ml-auto` group) used to be pushed past the viewport edge
             with no scroll path — report was literally unreachable there.
             Wrapped, the group drops to its own line and stays right-aligned
             (auto margins resolve per flex line, so desktop is unchanged).

             The `aria-hidden` absolute spans inside Like / gespeichert /
             ⚑ melden are invisible hit-area extenders (the SaveToggle
             pattern) that lift those three tap targets to ≥44px without
             changing a visible box. The insets are asymmetric on purpose:
             `inset` resolves against the PADDING box, so the two pill
             buttons need 2px extra to clear their own `border-2`, and once
             the strip wraps at 375 the pills sit on stacked lines — each
             one may only claim half the 12px row gap on the side facing
             its neighbour. Horizontal insets stay inside half the flex gap
             for the same reason. „Antworten" and „↗ teilen" are
             deliberately left alone — they have no click handler yet. -->
        <div
          class="flex flex-wrap items-center gap-3 py-2.5 mb-7 border-t border-b border-dashed border-rule font-dmmono text-[11px] text-ink-soft tracking-[0.04em]"
        >
          <button
            type="button"
            onclick={toggleLike}
            disabled={!currentUserId || likeBusy}
            aria-pressed={liked}
            class="relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full border-2 border-ink transition-colors font-semibold disabled:cursor-not-allowed {liked ? 'bg-wine text-paper' : 'bg-paper-warm hover:bg-paper'}"
            aria-label="Like"
          >
            <span aria-hidden="true">♥</span>
            <span>{likeCount} {$t['detail.engagement.thanks']}</span>
            <span aria-hidden="true" style="position:absolute; inset:-13px -8px -8px;"></span>
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-transparent border-2 border-ink hover:bg-paper-warm transition-colors font-semibold"
            aria-label="Antworten"
          >
            <span aria-hidden="true">💬</span>
            <span>{replyCount} {$t['detail.engagement.replies']}</span>
          </button>
          <button
            type="button"
            onclick={toggleBookmark}
            disabled={!currentUserId || bookmarkBusy}
            aria-pressed={bookmarked}
            class={`relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full border-2 border-ink transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${
              bookmarked ? 'bg-ochre' : 'bg-transparent hover:bg-paper-warm'
            }`}
            aria-label={bookmarked ? $t['detail.engagement.saved'] : $t['detail.engagement.save']}
          >
            <span aria-hidden="true">🔖</span>
            <!-- verb while unsaved, state once saved — a constant „gespeichert" read as already-saved (user, 2026-09-10) -->
            <span>{bookmarked ? $t['detail.engagement.saved'] : $t['detail.engagement.save']}</span>
            <span aria-hidden="true" style="position:absolute; inset:-8px -8px -13px;"></span>
          </button>
          <span class="ml-auto flex gap-3.5 text-ink-mute">
            <button
              type="button"
              class="inline-flex items-center gap-1 hover:text-ink transition-colors"
            >
              <span aria-hidden="true">↗</span> {$t['detail.share']}
            </button>
            {#if currentUserId && !isAuthor}
              <button
                type="button"
                onclick={() => (reportOpen = true)}
                class="relative inline-flex items-center gap-1 hover:text-ink transition-colors"
              >
                <span aria-hidden="true">⚑</span> {$t['detail.report']}
                <span aria-hidden="true" style="position:absolute; inset:-14px -7px;"></span>
              </button>
            {/if}
          </span>
        </div>

        <!-- Comments -->
        <ForumCommentList
          comments={comments}
          topicAuthorId={topic.author?._id ?? null}
          {currentUserId}
          unreadCount={0}
          onEditComment={handleEditComment}
          onDeleteComment={handleDeleteComment}
        />
      {/if}
    </article>

    <!-- ── Right rail (switches between read mode + edit mode) ──── -->
    <!-- `-mr-10 pr-10` pushes the bg out to fill main's right padding so
         the rail sits flush with the page edge (per prototype); inner
         content position is unchanged because the same amount is added
         back as right padding on the aside. -->
    <aside class="hidden lg:block bg-paper-soft border-l border-dashed border-rule lg:-mr-10 lg:pr-10">
      <div
        class="sticky top-24 space-y-5 px-5 py-7"
      >
        {#if editing}
          <!-- Edit mode: action row + delete confirm -->
          <section class="px-5">
            <div class="flex flex-wrap gap-2 mb-4">
              <KioskBtn variant="primary" size="md" onclick={saveEdit} disabled={saving || !isDirty}>
                {saving ? '…' : $t['edit.cta.save']}
              </KioskBtn>
              <KioskBtn variant="secondary" size="md" onclick={() => cancelEdit()} disabled={saving}>
                {$t['edit.cta.cancel']}
              </KioskBtn>
            </div>
            {#if !deleteOpen}
              <KioskBtn variant="danger" size="sm" onclick={() => (deleteOpen = true)}>
                {$t['edit.cta.delete']}
              </KioskBtn>
            {/if}
          </section>

          {#if deleteOpen}
            <DeleteConfirmCard
              replyCount={replyCount}
              deleting={deleting}
              onConfirm={confirmDelete}
              onCancel={() => (deleteOpen = false)}
            />
          {/if}
        {:else}
          <!-- ◆ DEINE ANTWORT — wired CommentComposer -->
          <section>
            {#if currentUserId}
              <CommentComposer
                currentUser={{
                  name: currentUser?.name ?? 'du',
                  image: currentUser?.image ?? null
                }}
                submitting={postingComment}
                onSubmit={submitComment}
              />
            {:else}
              <p class="font-bricolage text-sm text-ink-mute">
                <a href="/login" class="text-wine hover:underline">{$t['detail.composeLogin']}</a>
              </p>
            {/if}
          </section>

          <!-- ◆ WER MITREDET -->
          <section>
            <p
              class="font-dmmono text-[10px] uppercase tracking-[0.12em] text-teal mb-2 flex items-center gap-1.5"
            >
              <span aria-hidden="true">◆</span> {$t['detail.people.heading']} · {comments.length}
            </p>
            {#if comments.length}
              <div class="flex flex-wrap gap-1.5">
                {#each comments.slice(0, 8) as c (c._id)}
                  <KioskAvatar
                    name={c.author?.name ?? '·'}
                    image={c.author?.image ?? null}
                    size="sm"
                  />
                {/each}
                {#if comments.length > 8}
                  <div
                    class="w-7 h-7 rounded-full border-[1.5px] border-dashed border-ink-mute flex items-center justify-center font-dmmono text-[9.5px] text-ink-mute"
                  >
                    +{comments.length - 8}
                  </div>
                {/if}
              </div>
            {:else}
              <p class="font-dmmono text-[10px] text-ink-mute">—</p>
            {/if}
          </section>

          <!-- ◆ ÄHNLICHE THEMEN — real siblings from the same collection
               (SSR `related` prop: shared tags first, newest-first fill).
               Hidden entirely when there is nothing to show (2026-09-10;
               was a hardcoded prototype list that readers tried to click). -->
          {#if related.length > 0}
            <section>
              <p
                class="font-dmmono text-[10px] uppercase tracking-[0.12em] text-moss mb-2 flex items-center gap-1.5"
              >
                <span aria-hidden="true">◆</span> {$t['detail.related.heading']}
              </p>
              <ul class="space-y-2.5">
                {#each related as item, i (item.id)}
                  <li
                    class={`pb-2.5 ${i < related.length - 1 ? 'border-b border-dashed border-rule' : ''}`}
                  >
                    <a href={`/${collectionType}/${item.id}`} class="block group kiosk-tap">
                      <p class="font-bricolage font-bold text-[12.5px] text-ink leading-tight group-hover:underline decoration-1 underline-offset-2">
                        {item.title}
                      </p>
                      <p class="font-dmmono text-[10px] text-ink-mute mt-0.5">
                        {item.replies} {$t['detail.engagement.replies']} · {relTime(item.date)}
                      </p>
                    </a>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}

          <!-- Trust-note serif italic quote — boxed with dashed border + lighter
               bg per prototype, sits as a contained quote on the rail surface. -->
          <section
            class="bg-paper-warm border border-dashed border-rule rounded-sm px-3 py-2.5 font-instrument italic text-[11.5px] text-ink-soft leading-[1.5]"
          >
            {$t['detail.trust.quote']}
          </section>
        {/if}
      </div>
    </aside>
  </div>
</main>

<!-- Mobile sticky comment composer (lg:hidden, fixed bottom-12 above KioskNav) -->
<CommentComposerMobile
  {currentUserId}
  currentUser={{
    name: currentUser?.name ?? 'du',
    image: currentUser?.image ?? null
  }}
  submitting={postingComment}
  onSubmit={submitComment}
/>

<KioskReportModal
  open={reportOpen}
  contentId={String(topic._id)}
  contentType={reportContentType}
  contentTitle={topic.title}
  onClose={() => (reportOpen = false)}
/>
