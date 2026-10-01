/**
 * Centralized query key factory for TanStack Query.
 *
 * Convention: list keys MUST prefix-extend their `.all` tuple so that
 * `invalidateQueries({ queryKey: qk.<namespace>.all })` matches every variant
 * (TanStack Query does prefix matching by default).
 *
 *   e.g. qk.events.all         === ['events']
 *        qk.events.list(opts)  === ['events', opts]
 *        qk.events.detail(id)  === ['event', id]   // different namespace!
 *
 * Detail keys use their own namespace (singular) because they hit a different
 * endpoint and should NOT be invalidated alongside list keys.
 *
 * Dependency-free: this file is imported from both SSR (server) and client
 * code paths. Do NOT add imports that pull in MongoDB, fs, auth-astro, etc.
 * See CLAUDE.md "Server-only modules bleeding into client bundles".
 */

type ForumNamespace = 'topics' | 'announcements' | 'recommendations';

// Shape is intentionally loose — TanStack hashes via JSON.stringify, so any
// serializable object works. We don't `as const` list args because deep-const
// on mutable option objects is a type-safety lie.
type Opts = Record<string, unknown>;

function forumKeys(namespace: ForumNamespace) {
  return {
    all: [namespace] as const,
    list: (opts: Opts) => [namespace, opts] as const,
  };
}

export const qk = {
  // Forum collections — polymorphic hooks look these up by name via qk.forum(type)
  topics: {
    ...forumKeys('topics'),
    detail: (id: string) => ['topic', id] as const,
  },
  announcements: forumKeys('announcements'),
  recommendations: forumKeys('recommendations'),

  // Events
  events: {
    all: ['events'] as const,
    list: (opts: Opts) => ['events', opts] as const,
    detail: (id: string) => ['event', id] as const,
  },

  // News
  news: {
    all: ['news'] as const,
    list: (opts: Opts) => ['news', opts] as const,
    saved: ['savedNews'] as const,
  },

  // User-scoped sets
  savedPosts: ['savedPosts'] as const,
  savedEvents: ['savedEvents'] as const,
  myReportedIds: ['my-reported-ids'] as const,

  // Comments (keyed by postId)
  comments: (postId: string) => ['comments', postId] as const,
} as const;
