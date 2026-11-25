/**
 * Comment likes — pure rules, dependency-pure (no mongodb import).
 * Used by POST /api/likes/toggle (collectionType 'comments') and by every
 * place that hands comments to the browser.
 */

export type CommentLikeDecision =
  | { kind: 'allowed' }
  | { kind: 'own' }
  | { kind: 'not_found' };

function idString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && (v as any)._id != null) return String((v as any)._id);
  return String(v);
}

/** Missing moderationStatus counts as approved (legacy comments). */
export function decideCommentLike(
  comment: { author?: unknown; moderationStatus?: string } | null | undefined,
  userId: string
): CommentLikeDecision {
  if (!comment) return { kind: 'not_found' };
  if ((comment.moderationStatus ?? 'approved') !== 'approved') return { kind: 'not_found' };
  if (idString(comment.author) === userId) return { kind: 'own' };
  return { kind: 'allowed' };
}

/**
 * A comment's parent post is visible when approved (or legacy without a status),
 * or when it is held but reported by a member (a reported post stays on the page).
 */
export function isParentVisible(
  parent: { moderationStatus?: string; isUserReported?: boolean } | null | undefined
): boolean {
  if (!parent) return false;
  const status = parent.moderationStatus ?? 'approved';
  if (status === 'approved') return true;
  return status === 'pending' && parent.isUserReported === true;
}

/**
 * Client shape of a comment: the `likedBy` id list never leaves the server;
 * the viewer gets `likedByMe` and `likes`. With a list: `legacyLikes` (the old
 * number kept from before the list existed) + list size; without: the stored number.
 */
export function shapeCommentForViewer<T extends Record<string, any>>(
  comment: T,
  viewerId: string | null | undefined
): Omit<T, 'likedBy' | 'legacyLikes'> & { likes: number; likedByMe: boolean } {
  const { likedBy, legacyLikes, ...rest } = comment;
  const list: unknown[] = Array.isArray(likedBy) ? likedBy : [];
  const likes = Array.isArray(likedBy)
    ? (Number(legacyLikes) || 0) + list.length
    : Number(comment.likes ?? 0) || 0;
  const likedByMe = !!viewerId && list.some((id) => idString(id) === viewerId);
  return { ...(rest as Omit<T, 'likedBy' | 'legacyLikes'>), likes, likedByMe };
}

/** Same contract for forum posts (topics, announcements, recommendations): no id list to the browser. */
export function shapePostForViewer<T extends Record<string, any>>(
  post: T,
  viewerId: string | null | undefined
): Omit<T, 'likedBy'> & { likes: number; likedByMe: boolean } {
  const { likedBy, ...rest } = post;
  const list: unknown[] = Array.isArray(likedBy) ? likedBy : [];
  const likes = Array.isArray(likedBy) ? list.length : Number(post.likes ?? 0) || 0;
  const likedByMe = !!viewerId && list.some((id) => idString(id) === viewerId);
  return { ...(rest as Omit<T, 'likedBy'>), likes, likedByMe };
}

/**
 * The toggle write for a COMMENT (aggregation pipeline). Old comments may carry `likes: N`
 * without a `likedBy` list: that number is parked in `legacyLikes` once (while no list
 * exists), then `likes = legacyLikes + list size`, so it is never lost.
 */
export function buildCommentLikePipeline(action: 'like' | 'unlike', userId: string): Record<string, unknown>[] {
  const likedByStage = action === 'like'
    ? { $set: { likedBy: { $setUnion: [{ $ifNull: ['$likedBy', []] }, [userId]] } } }
    : {
        $set: {
          likedBy: { $filter: { input: { $ifNull: ['$likedBy', []] }, cond: { $ne: ['$$this', userId] } } },
        },
      };
  return [
    {
      $set: {
        legacyLikes: {
          $cond: [{ $isArray: '$likedBy' }, { $ifNull: ['$legacyLikes', 0] }, { $ifNull: ['$likes', 0] }],
        },
      },
    },
    likedByStage,
    { $set: { likes: { $add: ['$legacyLikes', { $size: { $ifNull: ['$likedBy', []] } }] } } },
  ];
}

/**
 * Whether a forum list fetch owes the viewer `likes` + `likedByMe`. The field list comes
 * from the browser, so this is NOT the privacy gate: the caller removes `likedBy` from
 * every item whatever this answers (see stripLikedBy). An exclusion entry („-body")
 * means „everything else", so it counts as asking for the like fields.
 */
export function fieldsNeedLikeShape(fields: string[] | null | undefined): boolean {
  if (!fields || fields.length === 0) return true;
  if (fields.some((f) => f.startsWith('-'))) return true;
  return fields.some((f) => f === 'likes' || f === 'likedBy' || f.startsWith('likedBy.'));
}

/** Drops the id list from an item that was not shaped — the list never leaves the server. */
export function stripLikedBy<T extends Record<string, any>>(item: T): Omit<T, 'likedBy'> {
  if (!item || typeof item !== 'object' || !('likedBy' in item)) return item;
  const { likedBy: _dropped, ...rest } = item;
  return rest as Omit<T, 'likedBy'>;
}
