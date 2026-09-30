// src/lib/notificationPurge.ts — remove the notification rows that point at
// content which is being deleted. Dependency-pure apart from the mongodb
// driver TYPES (never imports connectDB) so it is unit-testable against a
// fake Db, like src/lib/comments/cascade.ts.
//
// Two keys, both strings (src/types/notification.ts):
//   target.contentId — the page the row deep-links to. Every row about a
//     COMMENT targets its PARENT post (commentTarget()), so purging a post by
//     its id sweeps the whole thread: „replied", mentions, @alle hints and
//     moderation rows alike.
//   meta.sourceId   — the post/comment that CONTAINS a mention / @alle hint,
//     and (since 2026-09-30) the comment behind a „replied" row. This is what a
//     single comment delete matches on.
//
// No index: the collection is 90-day TTL-bounded and small; a $or over two
// string fields is fine. Throws only on a driver error (the calling route's
// catch answers 500 — the content is already gone, same as the cascade).
import type { Db } from 'mongodb';

export type PurgeDb = Pick<Db, 'collection'>;

export async function purgeNotificationsFor(db: PurgeDb, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await db.collection('notifications').deleteMany({
    $or: [{ 'target.contentId': { $in: ids } }, { 'meta.sourceId': { $in: ids } }],
  });
  return r.deletedCount ?? 0;
}
