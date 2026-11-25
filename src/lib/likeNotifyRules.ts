/**
 * Like rows in the bell — pure rules, dependency-pure (no mongodb import).
 * One row per (recipient, liked item); `likers` is server-only and never
 * leaves listNotifications(). No names, no actorId on a like row.
 */
import type { NotificationTarget } from '../types/notification';

export type LikeContentKind = 'comment' | 'topic' | 'announcement' | 'recommendation';

/** First 80 chars of the text, whitespace collapsed. */
export function likeNoticeTitle(text: string | null | undefined): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Skip: own item, missing author id, author account anonymised or absent. */
export function shouldNotifyLike(a: { likerId: string; authorId: string | null | undefined; authorLive: boolean }): boolean {
  if (!a.authorId) return false;
  if (a.authorId === a.likerId) return false;
  return a.authorLive;
}

/** Which of the four copy variants the panel shows. */
export function likeRowVariant(contentKind: string | undefined, count: number | undefined): { subject: 'comment' | 'post'; many: boolean } {
  return { subject: contentKind === 'comment' ? 'comment' : 'post', many: (count ?? 1) > 1 };
}

/** After an unlike: an empty list means the row goes. */
export function shouldDeleteLikeRow(likers: unknown[] | null | undefined): boolean {
  return !Array.isArray(likers) || likers.length === 0;
}

/** Filter that finds the one row of a (recipient, item) pair. */
export function likeRowFilter(userId: string, sourceId: string) {
  return { userId, type: 'like' as const, 'meta.sourceId': sourceId };
}

/**
 * Upsert pipeline (one atomic update). Membership is judged on the ORIGINAL list in the
 * first stage: a NEW liker (or a new row) sets createdAt = now and readAt = null (the row
 * moves up and counts as unread again); a repeated liker changes nothing.
 */
export function buildLikeUpsertPipeline(a: {
  userId: string;
  likerId: string;
  sourceId: string;
  contentKind: LikeContentKind;
  target: NotificationTarget;
  now: Date;
}): Record<string, unknown>[] {
  return [
    { $set: { _isNew: { $not: [{ $in: [a.likerId, { $ifNull: ['$likers', []] }] }] } } },
    { $set: { likers: { $setUnion: [{ $ifNull: ['$likers', []] }, [a.likerId]] } } },
    {
      $set: {
        userId: { $literal: a.userId },
        type: 'like',
        target: { $literal: a.target },
        'meta.sourceId': { $literal: a.sourceId },
        'meta.contentKind': a.contentKind,
        'meta.count': { $size: '$likers' },
        createdAt: { $cond: ['$_isNew', a.now, '$createdAt'] },
        readAt: { $cond: ['$_isNew', null, '$readAt'] },
      },
    },
    { $unset: '_isNew' },
  ];
}

/** Unlike: pull the liker, re-derive the count. Never touches readAt / createdAt. */
export function buildUnlikePipeline(likerId: string): Record<string, unknown>[] {
  return [
    {
      $set: {
        likers: { $filter: { input: { $ifNull: ['$likers', []] }, cond: { $ne: ['$$this', likerId] } } },
      },
    },
    { $set: { 'meta.count': { $size: '$likers' } } },
  ];
}
