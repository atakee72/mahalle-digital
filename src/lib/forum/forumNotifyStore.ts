/**
 * Forum notifications — database side. Takes a Db, imports no env and no Astro module, so it
 * runs in tests (fake Db) and in dev scripts. Sending (push, Sentry) lives in forumNotify.ts.
 */
import type { Db } from 'mongodb';
import type { NotificationDoc, NotificationMeta, NotificationTarget } from '../../types/notification';
import {
  FORUM_KIND_COLLECTION, berlinDay, digestWindowStart,
  type DigestMember, type ForumPostKind, type ForumPostRef,
} from './forumNotifyRules';

export const FORUM_DIGESTS_COLLECTION = 'forumDigests';

interface DigestDoc {
  _id: string; // Berlin day, e.g. '2026-10-03' — the once-a-day guard
  until: Date; // end of the window this digest covered
  sentAt: Date;
}

const toMs = (v: unknown): number | null => {
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * Claim today's digest BEFORE anything is sent (at-most-once: a second caller of the same
 * Berlin day loses on the duplicate key and gets null). Returns the window start.
 */
export async function claimDigestDay(db: Db, nowMs: number): Promise<{ startMs: number } | null> {
  const col = db.collection<DigestDoc>(FORUM_DIGESTS_COLLECTION);
  const previous = await col.find({}, { projection: { until: 1 } }).sort({ until: -1 }).limit(1).toArray();
  const startMs = digestWindowStart(toMs(previous[0]?.until), nowMs);
  try {
    await col.insertOne({ _id: berlinDay(nowMs), until: new Date(nowMs), sentAt: new Date(nowMs) });
  } catch (err) {
    if ((err as { code?: number })?.code === 11000) return null;
    throw err;
  }
  return { startMs };
}

/** Public, unlabelled, non-official posts created in (startMs, nowMs]. */
export async function loadDigestPosts(db: Db, startMs: number, nowMs: number): Promise<ForumPostRef[]> {
  const filter = {
    date: { $gt: startMs, $lte: nowMs },
    $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }],
    isOfficial: { $ne: true },
    hasWarningLabel: { $ne: true },
  };
  const kinds = Object.keys(FORUM_KIND_COLLECTION) as ForumPostKind[];
  const lists = await Promise.all(kinds.map(async (kind) => {
    const docs = await db.collection(FORUM_KIND_COLLECTION[kind])
      .find(filter, { projection: { title: 1, author: 1, date: 1 } }).toArray();
    return docs.map((d): ForumPostRef => ({
      id: String(d._id), kind, title: String(d.title ?? ''), authorId: String(d.author ?? ''), dateMs: Number(d.date),
    }));
  }));
  return lists.flat();
}

const REACHABLE = { anonymized: { $ne: true }, isBanned: { $ne: true } };

/** Everyone on the digest: no preference stored (or an unknown one), not banned, not anonymized. */
export async function loadDigestMembers(db: Db): Promise<DigestMember[]> {
  const users = await db.collection('users')
    .find({ ...REACHABLE, forumNotify: { $nin: ['each', 'off'] } }, { projection: { _id: 1, 'lastVisit.forum': 1 } })
    .toArray();
  return users.map((u) => ({ id: String(u._id), forumVisitMs: toMs(u.lastVisit?.forum) }));
}

/**
 * Who hears about ONE new post at once: the „each" members except the author.
 * Idempotent per post: when a forum row for this post exists already, nobody is told again.
 */
export async function eachRecipients(db: Db, post: ForumPostRef): Promise<string[]> {
  const already = await db.collection('notifications')
    .findOne({ type: 'forum', 'meta.sourceId': post.id }, { projection: { _id: 1 } });
  if (already) return [];
  const users = await db.collection('users')
    .find({ ...REACHABLE, forumNotify: 'each' }, { projection: { _id: 1 } }).toArray();
  return users.map((u) => String(u._id)).filter((id) => id !== post.authorId);
}

export async function insertForumRows(
  db: Db,
  userIds: string[],
  target: NotificationTarget,
  meta: NotificationMeta | undefined,
  now: Date,
): Promise<void> {
  if (!userIds.length) return;
  const docs: NotificationDoc[] = userIds.map((userId) => ({
    userId, type: 'forum', target, ...(meta ? { meta } : {}), createdAt: now, readAt: null,
  }));
  await db.collection<NotificationDoc>('notifications').insertMany(docs, { ordered: false });
}
