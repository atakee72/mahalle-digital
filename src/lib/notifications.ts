/**
 * Notification write + read helpers. SERVER-ONLY (imports connectDB).
 *
 * Write side is NEVER-THROW by contract: a failed notification write must
 * never fail the parent request (comment create, review action, contact
 * relay). Failures are swallowed but Sentry-captured with flush — Vercel
 * freezes the function when the response leaves, eating unflushed events.
 *
 * Actor names are a read-time join (populateSellers pattern), never stored:
 * a deleted user's tombstone doc already carries name "Ehemaliges Mitglied",
 * and hard-missing users render as null → client tombstone label.
 */
import { ObjectId } from 'mongodb';
import * as Sentry from '@sentry/astro';
import { connectDB } from './mongodb';
import { buildPushPayload, sendPushToAllExcept, sendPushToUsers } from './push';
import type {
  NotificationDoc,
  NotificationItem,
  NotificationTarget,
  NotificationType,
  NotificationMeta,
} from '../types/notification';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  actorId?: string;
  target: NotificationTarget;
  meta?: NotificationMeta;
}

const LIST_LIMIT = 30;

async function capture(err: unknown): Promise<void> {
  console.error('[notifications] write failed:', err);
  try {
    Sentry.captureException(err);
    await Sentry.flush(2000);
  } catch {
    /* best-effort */
  }
}

/** Insert one notification. Self-notifications are silently skipped. */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    if (input.actorId && input.actorId === input.userId) return;
    const db = await connectDB();
    await db.collection<NotificationDoc>('notifications').insertOne({
      ...input,
      createdAt: new Date(),
      readAt: null,
    });
    await sendPushToUsers([input.userId], buildPushPayload(input.type, input.target, input.meta));
  } catch (err) {
    await capture(err);
  }
}

/** Broadcast to every member (all non-anonymized users) except the actor. */
export async function notifyAllMembers(input: Omit<NotifyInput, 'userId'>): Promise<void> {
  try {
    const db = await connectDB();
    const users = await db
      .collection('users')
      .find({ anonymized: { $ne: true } }, { projection: { _id: 1 } })
      .toArray();
    const now = new Date();
    const docs: NotificationDoc[] = users
      .map((u) => u._id.toString())
      .filter((id) => id !== input.actorId)
      .map((userId) => ({ userId, ...input, createdAt: now, readAt: null }));
    if (!docs.length) return;
    await db.collection<NotificationDoc>('notifications').insertMany(docs, { ordered: false });
    await sendPushToAllExcept(input.actorId, buildPushPayload(input.type, input.target, input.meta));
  } catch (err) {
    await capture(err);
  }
}

/** Broadcast to every member who is not an admin (blog post announcements — the admin is the
 *  usual author, and a blog author is a plain name, not an account, so „except the author"
 *  cannot be expressed). Anonymized accounts are skipped like in notifyAllMembers(). */
export async function notifyMembersExceptAdmins(input: Omit<NotifyInput, 'userId' | 'actorId'>): Promise<void> {
  try {
    const db = await connectDB();
    const users = await db
      .collection('users')
      .find({ anonymized: { $ne: true }, role: { $ne: 'admin' } }, { projection: { _id: 1 } })
      .toArray();
    const userIds = users.map((u) => u._id.toString());
    if (!userIds.length) return;
    const now = new Date();
    const docs: NotificationDoc[] = userIds.map((userId) => ({ userId, ...input, createdAt: now, readAt: null }));
    await db.collection<NotificationDoc>('notifications').insertMany(docs, { ordered: false });
    await sendPushToUsers(userIds, buildPushPayload(input.type, input.target, input.meta));
  } catch (err) {
    await capture(err);
  }
}

// Comment hooks know the PARENT collection name ('topics' | 'announcements'
// | 'recommendations' | 'events'); events have no detail route yet, so their
// rows link to the calendar page.
const PARENT_CONTENT_TYPE: Record<string, NotificationTarget['contentType']> = {
  topics: 'topic',
  announcements: 'announcement',
  recommendations: 'recommendation',
  events: 'event',
};

export function commentTarget(
  parentCollection: string,
  parentId: string,
  title: string,
): NotificationTarget {
  const contentType = PARENT_CONTENT_TYPE[parentCollection] ?? 'topic';
  const href = contentType === 'event' ? '/calendar' : `/${parentCollection}/${parentId}`;
  return { contentType, contentId: parentId, title, href };
}

// Moderation hooks know the flaggedContent contentType (singular forms).
export function moderationTarget(
  contentType: string,
  contentId: string,
  title: string,
): NotificationTarget {
  switch (contentType) {
    case 'topic':
      return { contentType: 'topic', contentId, title, href: `/topics/${contentId}` };
    case 'announcement':
      return { contentType: 'announcement', contentId, title, href: `/announcements/${contentId}` };
    case 'recommendation':
      return { contentType: 'recommendation', contentId, title, href: `/recommendations/${contentId}` };
    case 'event':
      return { contentType: 'event', contentId, title, href: '/calendar' };
    case 'marketplace':
      return { contentType: 'listing', contentId, title, href: `/marketplace/${contentId}` };
    case 'news':
      return { contentType: 'news', contentId, title, href: '/newsboard' };
    default:
      // 'comment' without a resolvable parent, or anything unknown → forum index
      // (which lives at /forum since the Aug 2026 landing release — '/' is the
      // public landing and would bounce members through an extra redirect).
      return { contentType: 'forum', contentId, title, href: '/forum' };
  }
}

/** Newest LIST_LIMIT notifications with actor names joined (allowlist projection). */
export async function listNotifications(userId: string): Promise<NotificationItem[]> {
  const db = await connectDB();
  const docs = await db
    .collection<NotificationDoc>('notifications')
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(LIST_LIMIT)
    .toArray();

  // users._id exists in BOTH forms in this app (ObjectId for newer docs,
  // legacy hex STRINGS for older ones — and the dev seed) — an
  // ObjectId-only $in silently misses the string form, tombstoning every
  // actor. Query both forms; key the map by String(_id), which yields the
  // same hex for both.
  const actorIds = [
    ...new Set(docs.map((d) => d.actorId).filter((s): s is string => !!s)),
  ];
  let byId = new Map<string, { name?: string }>();
  if (actorIds.length) {
    const objectIds = actorIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
    const users = await db
      .collection('users')
      .find(
        { _id: { $in: [...objectIds, ...actorIds] as any[] } },
        { projection: { name: 1 } },
      )
      .toArray();
    byId = new Map(users.map((u) => [String(u._id), { name: (u as any).name }]));
  }

  return docs.map((d) => ({
    id: d._id!.toString(),
    type: d.type,
    actorName: d.actorId ? (byId.get(d.actorId)?.name ?? null) : null,
    target: d.target,
    meta: d.meta,
    createdAt: d.createdAt.toISOString(),
    readAt: d.readAt ? d.readAt.toISOString() : null,
  }));
}

export async function countUnread(userId: string): Promise<number> {
  const db = await connectDB();
  return db.collection('notifications').countDocuments({ userId, readAt: null });
}

export async function markAllRead(userId: string): Promise<void> {
  const db = await connectDB();
  await db
    .collection('notifications')
    .updateMany({ userId, readAt: null }, { $set: { readAt: new Date() } });
}
