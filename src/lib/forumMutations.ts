/**
 * Forum mutations — Svelte equivalents of the React hooks in
 * src/hooks/api/useTopicsQuery.ts and useCommentsQuery.ts.
 *
 * Built on @tanstack/svelte-query's createMutation. Each mutation owns
 * the same optimistic + rollback semantics as the React side, adapted
 * to the Svelte query key shape (`['forum', 'topics']`, not the
 * React-side `['topics']` from queryKeys.ts — the two QueryClients are
 * separate caches).
 *
 * Rate-limit branching: createTopic throws a typed RateLimitError on
 * 429 so the compose page can swap the form for the RateLimitPanel
 * without introspecting the error message.
 *
 * lastSubmittedAt: a tiny writable that flips for 6 s after a successful
 * topic create. FeedStatusFooter reads it to switch into 'live' mode.
 */

import { createMutation, useQueryClient } from '@tanstack/svelte-query';
import { writable } from 'svelte/store';

const API_URL = '/api';

// ─── Live-mode signal for FeedStatusFooter ─────────────────────────────
// Set by createTopicMutation.onSuccess; reset 6 s later. The footer reads
// `$lastSubmittedAt` and computes its mode accordingly.
export const lastSubmittedAt = writable<number | null>(null);

const LIVE_WINDOW_MS = 6_000;

function flagLive() {
  lastSubmittedAt.set(Date.now());
  if (typeof window !== 'undefined') {
    setTimeout(() => lastSubmittedAt.set(null), LIVE_WINDOW_MS);
  }
}

// ─── Typed errors ──────────────────────────────────────────────────────
// Re-exported from the shared module so existing import sites
// (`import { RateLimitError } from '../lib/forumMutations'`) keep working.
export { RateLimitError } from './errors';
import { RateLimitError } from './errors';
import { createEndpointForKind, createdDocKeyForKind, type PostKind } from './forum/postKind';

// ─── Topic create ──────────────────────────────────────────────────────

export type CreateTopicInput = {
  title: string;
  body: string;
  tags?: string[];
  images?: { url: string; publicId: string }[];
  /** Which collection the post goes to. Absent = discussion (old callers). */
  kind?: PostKind;
};

// Until 2026-09-21 this always POSTed to /topics/create: the compose page let a
// member pick Empfehlung / Ankündigung, and published a discussion anyway.
async function createTopicReq(input: CreateTopicInput) {
  const kind: PostKind = input.kind ?? 'discussion';
  const { kind: _kind, ...payload } = input;
  const res = await fetch(createEndpointForKind(kind), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    if (res.status === 429) {
      throw new RateLimitError(
        error.dailyLimit ?? 5,
        error.currentCount ?? 0,
        error.message ?? 'Daily limit reached'
      );
    }
    const details = error.details ? Object.values(error.details).join(', ') : '';
    throw new Error(details || error.error || 'Failed to create post');
  }

  const json = await res.json();
  // The three endpoints name the created doc differently; callers read `.topic`.
  // `kind` is stamped here because the merged feed decorates items with it.
  return {
    topic: { ...json[createdDocKeyForKind(kind)], kind },
    message: json.message as string,
    moderationStatus: json.moderationStatus as 'pending' | 'approved' | 'rejected' | undefined
  };
}

export function createTopicMutation(currentUser: { id: string; name?: string; image?: string | null }) {
  const queryClient = useQueryClient();
  const queryKey = ['forum', 'all'];

  return createMutation(() => ({
    mutationFn: createTopicReq,
    // Optimistic insert at the top of the feed. The temp topic mimics the
    // shape ForumPostCard expects (author populated, comments=[], likes=0)
    // so the existing render path lights up without branching on a flag.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<any[]>(queryKey);

      const tempId = `optimistic-${Date.now()}`;
      const tempTopic = {
        _id: tempId,
        title: input.title,
        body: input.body,
        tags: input.tags ?? [],
        images: input.images ?? [],
        comments: [],
        likes: 0,
        likedBy: [],
        views: 0,
        date: new Date().toISOString(),
        moderationStatus: 'pending',
        // The merged feed reads `kind` to choose the card treatment.
        kind: input.kind ?? 'discussion',
        author: {
          _id: currentUser.id,
          name: currentUser.name ?? 'du',
          image: currentUser.image ?? null
        },
        // Local marker so the index can apply the slide-in wrapper.
        optimistic: true
      };

      queryClient.setQueryData<any[]>(queryKey, (old) =>
        old ? [tempTopic, ...old] : [tempTopic]
      );

      return { prev, tempId };
    },
    onError: (_err, _input, context) => {
      if (context?.prev) queryClient.setQueryData(queryKey, context.prev);
    },
    onSuccess: (response, _input, context) => {
      // Replace the temp entry with the real topic returned by the API.
      queryClient.setQueryData<any[]>(queryKey, (old) => {
        if (!old) return [response.topic];
        return old.map((t) => (t._id === context?.tempId ? response.topic : t));
      });
      flagLive();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    }
  }));
}

// ─── Topic edit ────────────────────────────────────────────────────────

export type EditTopicInput = {
  title: string;
  body: string;
  tags: string[];
  images?: { url: string; publicId: string }[];
};

async function editTopicReq({ id, input }: { id: string; input: EditTopicInput }) {
  const res = await fetch(`${API_URL}/topics/edit/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input)
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    const details = error.details ? Object.values(error.details).join(', ') : '';
    throw new Error(details || error.error || 'Failed to update topic');
  }
  return res.json() as Promise<{
    topic: any;
    message: string;
    moderationStatus?: 'pending' | 'approved' | 'rejected';
  }>;
}

export function editTopicMutation() {
  const queryClient = useQueryClient();
  const queryKey = ['forum', 'all'];
  return createMutation(() => ({
    mutationFn: editTopicReq,
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<any[]>(queryKey);
      queryClient.setQueryData<any[]>(queryKey, (old) =>
        old?.map((t) => (t._id === id ? { ...t, ...input, isEdited: true } : t)) ?? old
      );
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(queryKey, context.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    }
  }));
}

// ─── Topic delete ──────────────────────────────────────────────────────

async function deleteTopicReq(id: string) {
  const res = await fetch(`${API_URL}/topics/delete/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete topic');
  }
  return res.json();
}

export function deleteTopicMutation() {
  const queryClient = useQueryClient();
  const queryKey = ['forum', 'all'];
  return createMutation(() => ({
    mutationFn: deleteTopicReq,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<any[]>(queryKey);
      queryClient.setQueryData<any[]>(queryKey, (old) =>
        old?.filter((t) => t._id !== id) ?? old
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      if (context?.prev) queryClient.setQueryData(queryKey, context.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    }
  }));
}

// ─── Comment create ────────────────────────────────────────────────────
// Comments don't go through the Svelte topics cache (ForumPostDetail keeps
// them as local state from SSR initialComments). The mutation here is
// fire-and-forget on the cache side; the calling page is responsible for
// optimistically inserting into its local list.

export type CreateCommentInput = {
  body: string;
  topicId: string;
};

async function createCommentReq(input: CreateCommentInput) {
  const res = await fetch(`${API_URL}/comments/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      body: input.body,
      topicId: input.topicId,
      collectionType: 'topics'
    })
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to post comment');
  }
  return res.json() as Promise<{
    comment: any;
    message: string;
    moderationStatus?: 'pending' | 'approved' | 'rejected';
  }>;
}

export function createCommentMutation() {
  return createMutation(() => ({
    mutationFn: createCommentReq
  }));
}
