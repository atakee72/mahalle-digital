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
 * Client shape of a comment: the `likedBy` id list never leaves the server;
 * the viewer gets `likedByMe` and `likes` (derived from the list when present).
 */
export function shapeCommentForViewer<T extends Record<string, any>>(
  comment: T,
  viewerId: string | null | undefined
): Omit<T, 'likedBy'> & { likes: number; likedByMe: boolean } {
  const { likedBy, ...rest } = comment;
  const list: unknown[] = Array.isArray(likedBy) ? likedBy : [];
  const likes = Array.isArray(likedBy) ? list.length : Number(comment.likes ?? 0) || 0;
  const likedByMe = !!viewerId && list.some((id) => idString(id) === viewerId);
  return { ...(rest as Omit<T, 'likedBy'>), likes, likedByMe };
}
