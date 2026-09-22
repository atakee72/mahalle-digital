<script lang="ts">
  // Comment thread for a forum post. Header (`47 Antworten` + sort label
  // + optional `N ungelesen` mono pill) + list of ForumComment cards.
  //
  // Phase 5a: read-only. Composing replies lives in the detail page
  // right rail (desktop) / sticky bottom bar (mobile, ships in 5b);
  // there is no inline form here anymore.

  import ForumComment from './ForumComment.svelte';
  import { t } from '../../../lib/kiosk-i18n';

  let {
    comments = [],
    topicAuthorId = null,
    currentUserId = null,
    unreadCount = 0,
    onEditComment,
    onDeleteComment
  } = $props<{
    comments?: any[];
    topicAuthorId?: string | null;
    currentUserId?: string | null;
    unreadCount?: number;
    onEditComment?: (commentId: string, newBody: string) => Promise<void>;
    onDeleteComment?: (commentId: string) => Promise<void>;
  }>();

  // Author IDs come back as strings or as { _id: '…' } depending on
  // populateAuthors. Normalize both sides before comparing.
  function authorIdOf(v: any): string | null {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && v._id) return String(v._id);
    return null;
  }
  const topicAuthorIdStr = $derived(
    typeof topicAuthorId === 'object' ? authorIdOf(topicAuthorId) : topicAuthorId
  );

  function isOPComment(c: any): boolean {
    if (!topicAuthorIdStr) return false;
    return authorIdOf(c.author) === topicAuthorIdStr;
  }

  const total = $derived(comments.length);
  const headingNoun = $derived(
    total === 1 ? $t['detail.replies.heading.one'] : $t['detail.replies.heading.other']
  );
  const unreadLabel = $derived(
    unreadCount > 0 ? $t['detail.replies.unread'].replace('{n}', String(unreadCount)) : ''
  );

  // Admin-Hinweis deep link: /topics/<id>#comment-<commentId> (comments render after the page).
  $effect(() => {
    if (typeof window === 'undefined' || comments.length === 0) return;
    const m = /^#comment-([0-9a-f]{24})$/.exec(window.location.hash);
    if (!m) return;
    requestAnimationFrame(() => document.getElementById(`comment-${m[1]}`)?.scrollIntoView({ block: 'center' }));
  });
</script>

<section>
  <header
    class="flex items-center justify-between gap-3 mb-3 pb-2 border-b-[1.5px] border-ink"
  >
    <div class="flex items-baseline gap-2.5">
      <h2 class="font-bricolage font-extrabold text-lg text-ink tracking-tight">
        {total} {headingNoun}
      </h2>
      <span class="font-instrument italic text-[13px] text-ink-mute">
        {$t['detail.replies.newest']}
      </span>
    </div>
    {#if unreadLabel}
      <span class="font-dmmono text-[10.5px] uppercase tracking-[0.05em] text-ink-mute">
        {unreadLabel}
      </span>
    {/if}
  </header>

  {#if total === 0}
    <p class="font-bricolage text-sm text-ink-mute py-6 text-center">
      {$t['detail.empty.replies']}
    </p>
  {:else}
    <div>
      {#each comments as comment, i (comment._id)}
        <ForumComment
          {comment}
          isOP={isOPComment(comment)}
          isLatest={i === 0}
          {currentUserId}
          onEdit={onEditComment ? (newBody) => onEditComment(comment._id, newBody) : undefined}
          onDelete={onDeleteComment ? () => onDeleteComment(comment._id) : undefined}
        />
      {/each}
    </div>
  {/if}
</section>
