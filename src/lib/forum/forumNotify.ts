/**
 * Forum notifications — the sending side. SERVER-ONLY. Everything here is NEVER-THROW:
 * a failed notification must not fail a post, a review or the morning job.
 * Rules: forumNotifyRules.ts · database: forumNotifyStore.ts.
 */
import { ObjectId } from 'mongodb';
import * as Sentry from '@sentry/astro';
import { connectDB } from '../mongodb';
import { buildPushPayload, sendPushToUsers } from '../push';
import {
  EACH_MAX_AGE_MS, FORUM_KIND_COLLECTION, forumNotification, planDigest,
  type ForumPostKind, type ForumPostRef,
} from './forumNotifyRules';
import {
  claimDigestDay, eachRecipients, insertForumRows, loadDigestMembers, loadDigestPosts,
} from './forumNotifyStore';

async function capture(err: unknown): Promise<void> {
  console.error('[forum-notify] failed:', err);
  try {
    Sentry.captureException(err);
    await Sentry.flush(2000);
  } catch {
    /* best-effort */
  }
}

/** Tell the „every post" members about one post that just became public. */
export async function notifyForumSubscribers(post: ForumPostRef): Promise<void> {
  try {
    const db = await connectDB();
    const userIds = await eachRecipients(db, post);
    const n = forumNotification([post]);
    if (!userIds.length || !n) return;
    const meta = { sourceId: post.id };
    await insertForumRows(db, userIds, n.target, meta, new Date());
    await sendPushToUsers(userIds, buildPushPayload('forum', n.target, meta));
  } catch (err) {
    await capture(err);
  }
}

/**
 * A post that waited in the review queue becomes public on approval. Skipped: user reports
 * (the post was public already), deleted content, a warning label, anything that is not a
 * forum post, official announcements, and posts older than EACH_MAX_AGE_MS.
 */
export async function notifyForumSubscribersOnApproval(
  flagged: { contentType: string; contentId?: string; source?: string; contentDeleted?: boolean },
  hasWarning: boolean,
): Promise<void> {
  try {
    if (hasWarning || flagged.contentDeleted || flagged.source === 'user_report') return;
    const collection = FORUM_KIND_COLLECTION[flagged.contentType as ForumPostKind];
    if (!collection || !flagged.contentId || !ObjectId.isValid(flagged.contentId)) return;
    const db = await connectDB();
    const doc = await db.collection(collection).findOne(
      { _id: new ObjectId(flagged.contentId) },
      { projection: { title: 1, author: 1, date: 1, isOfficial: 1 } },
    );
    if (!doc || doc.isOfficial === true) return;
    const dateMs = Number(doc.date);
    if (!Number.isFinite(dateMs) || Date.now() - dateMs > EACH_MAX_AGE_MS) return;
    await notifyForumSubscribers({
      id: flagged.contentId, kind: flagged.contentType as ForumPostKind,
      title: String(doc.title ?? ''), authorId: String(doc.author ?? ''), dateMs,
    });
  } catch (err) {
    await capture(err);
  }
}

/** The morning digest: once per Berlin day, only to members with something new to read. */
export async function sendForumDigest(): Promise<void> {
  try {
    const db = await connectDB();
    const nowMs = Date.now();
    const claim = await claimDigestDay(db, nowMs);
    if (!claim) return;
    const posts = await loadDigestPosts(db, claim.startMs, nowMs);
    if (!posts.length) return;
    const groups = planDigest(await loadDigestMembers(db), posts, claim.startMs);
    const now = new Date(nowMs);
    for (const g of groups) {
      await insertForumRows(db, g.userIds, g.target, g.meta, now);
      await sendPushToUsers(g.userIds, buildPushPayload('forum', g.target, g.meta));
    }
  } catch (err) {
    await capture(err);
  }
}
