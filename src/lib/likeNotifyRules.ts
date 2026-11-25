/**
 * Like rows in the bell — pure rules, dependency-pure (no mongodb import).
 * One row per (recipient, liked item); `likers` is server-only and never
 * leaves listNotifications(). Since 2026-11-26 the row's `actorId` is the NEWEST liker:
 * the author (and only the author) reads „Ercan und 2 weiteren Nachbarn gefällt …".
 * The name is the usual read-time join; nobody else ever sees who liked.
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

/**
 * i18n key + the number the panel fills in. With a name: one / two / many, n = the OTHER
 * likers. Without a name (rows written before 2026-11-26, or a missing actor): the
 * anonymous copy, n = all likers.
 */
export function likeRowCopy(contentKind: string | undefined, count: number | undefined, hasActor: boolean): { key: string; n: number } {
  const subject = contentKind === 'comment' ? 'comment' : 'post';
  const c = Math.max(1, count ?? 1);
  if (!hasActor) return { key: `nc.like.${subject}.${c > 1 ? 'many' : 'one'}`, n: c };
  const form = c === 1 ? 'one' : c === 2 ? 'two' : 'many';
  return { key: `nc.like.${subject}.named.${form}`, n: c - 1 };
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
        // the newest liker is the one the author reads by name
        actorId: { $cond: ['$_isNew', a.likerId, '$actorId'] },
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
    {
      $set: {
        'meta.count': { $size: '$likers' },
        // The named liker left: the row falls back to the anonymous copy. Never pick a
        // replacement name out of `likers` — it can hold people who liked while the row
        // promised no names (before 2026-11-26).
        actorId: { $cond: [{ $eq: ['$actorId', likerId] }, null, '$actorId'] },
      },
    },
  ];
}
