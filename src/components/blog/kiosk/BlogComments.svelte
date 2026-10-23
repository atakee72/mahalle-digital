<script lang="ts">
  // Comments under a Beilage article (2026-10-23). Members only: without a session
  // nothing renders and nothing is fetched. Reuses the forum's comment components;
  // the parent is the post's slug (comments.blogSlug), see src/components/blog/CLAUDE.md.
  import { onMount } from 'svelte';
  import { t } from '../../../lib/kiosk-i18n';
  import { confirmAction, showError, showToast } from '../../../utils/toast';
  import CommentComposer from '../../forum/kiosk/compose/CommentComposer.svelte';
  import ForumCommentList from '../../forum/kiosk/ForumCommentList.svelte';

  let { slug, title, currentUserId, currentUser, authorId } = $props<{
    slug: string;
    title: string;
    currentUserId: string | null;
    currentUser: { name: string; image: string | null } | null;
    authorId: string | null;
  }>();

  let comments = $state<any[]>([]);
  let failed = $state(false);
  let postingComment = $state(false);

  onMount(async () => {
    if (!currentUserId) return;
    try {
      const res = await fetch(`/api/comments/blog/${slug}`, { credentials: 'include' });
      if (!res.ok) throw new Error('load_failed');
      const json = await res.json();
      comments = json.comments ?? [];
    } catch {
      failed = true;
    }
  });

  async function handleEditComment(commentId: string, newBody: string) {
    const idx = comments.findIndex((c) => String(c._id) === String(commentId));
    if (idx === -1) return;
    const snapshot = comments;
    const optimisticComment = { ...comments[idx], body: newBody, editedAt: new Date().toISOString() };
    comments = [...comments.slice(0, idx), optimisticComment, ...comments.slice(idx + 1)];

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
      comments = comments.filter((c) => String(c._id) !== String(commentId));
    } else {
      comments = comments.map((c) => (String(c._id) === String(commentId) ? returned : c));
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
      const res = await fetch(`/api/comments/delete/${commentId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        comments = snapshot;
        showError($t['comment.toast.delete.error']);
      }
    } catch {
      comments = snapshot;
      showError($t['comment.toast.delete.error']);
    }
  }

  async function submitComment(body: string): Promise<boolean> {
    if (postingComment) return false;
    postingComment = true;
    try {
      const res = await fetch('/api/comments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ body, blogSlug: slug })
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

{#if currentUserId}
  <section data-blog-comments aria-label={title} style="margin-top: 28px; border-top: 2px solid var(--k-ink); padding-top: 16px;">
    <div class="font-mono uppercase" style="font-size: 11px; letter-spacing: .12em; color: var(--k-rust);">{$t['blog.comments.kicker']}</div>
    {#if failed}
      <p class="font-bricolage" style="font-size: 14px; margin-top: 12px;">{$t['blog.comments.error']}</p>
    {:else}
      <div style="margin-top: 12px;">
        <CommentComposer
          currentUser={{ name: currentUser?.name ?? 'du', image: currentUser?.image ?? null }}
          submitting={postingComment}
          onSubmit={submitComment}
        />
      </div>
      <div style="margin-top: 20px;">
        <ForumCommentList
          {comments}
          topicAuthorId={authorId}
          {currentUserId}
          onEditComment={handleEditComment}
          onDeleteComment={handleDeleteComment}
        />
      </div>
    {/if}
  </section>
{/if}
