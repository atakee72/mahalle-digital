// src/lib/mentions/mentionsStore.ts — SERVER-ONLY (notifications, Sentry, rate limit).
// Notify rules (2026-09-21): only when the content is publicly visible; never the
// author; never twice for the same post/comment (idempotent — create, edit and
// admin approval may all call it); in comments the parent post's author already
// gets the „replied" notification, so no second one; above 20 notifying saves
// per member per hour the mention is still stored and linked, but silent.
import * as Sentry from '@sentry/astro';
import { ObjectId, type Db } from 'mongodb';
import { consumeRateLimit } from '../auth/rateLimit';
import { notify, commentTarget, moderationTarget } from '../notifications';
import type { NotificationTarget } from '../../types/notification';
import type { MentionRef } from './mentions';
import { findCommentParent, pickMentionRecipients } from './mentionsResolve';

export * from './mentionsResolve';

const POST_COLLECTION: Record<string, string> = {
  topic: 'topics', announcement: 'announcements', recommendation: 'recommendations',
};
const NOTIFYING_SAVES_PER_HOUR = 20;

async function capture(err: unknown): Promise<void> {
  console.error('[mentions]', err);
  Sentry.captureException(err);
  await Sentry.flush(2000);
}

/** Idempotent per (sourceId, recipient). Never throws. Returns how many were notified. */
export async function notifyMentions(db: Db, args: {
  actorId: string; mentions: MentionRef[]; sourceId: string; kind: 'post' | 'comment';
  target: NotificationTarget; skipUserIds?: string[];
}): Promise<number> {
  try {
    if (args.mentions.length === 0) return 0;
    const candidates = [...new Set(args.mentions.map((m) => m.userId))];
    const seen = await db.collection('notifications')
      .find({ userId: { $in: candidates }, type: 'mention', 'meta.sourceId': args.sourceId }, { projection: { userId: 1 } })
      .toArray();
    const recipients = pickMentionRecipients({
      mentions: args.mentions, actorId: args.actorId, skipUserIds: args.skipUserIds,
      alreadyNotified: seen.map((n) => String(n.userId)),
    });
    if (recipients.length === 0) return 0;
    const cap = await consumeRateLimit(`mention:${args.actorId}`, NOTIFYING_SAVES_PER_HOUR, 60 * 60 * 1000);
    if (cap.limited) return 0; // stored + linked, but silent
    for (const userId of recipients) {
      await notify({
        userId, type: 'mention', actorId: args.actorId, target: args.target,
        meta: { sourceId: args.sourceId, contentKind: args.kind },
      });
    }
    return recipients.length;
  } catch (err) {
    await capture(err);
    return 0;
  }
}

/** Called by processReviewAction after a NON-rejection. Reads the LIVE doc (the
 *  flagged snapshot can be stale after an edit). Never throws. */
export async function notifyMentionsOnApproval(
  db: Db,
  flagged: { contentType: string; contentId?: string; authorId: string; source?: string },
): Promise<void> {
  try {
    // A user REPORT is reviewed on content that was already public (and already
    // notified at publish time). The per-source check in notifyMentions would
    // catch it too, but only within the notifications' 90-day TTL.
    if (flagged.source === 'user_report') return;
    if (!flagged.contentId || !ObjectId.isValid(flagged.contentId)) return;
    const _id = new ObjectId(flagged.contentId);
    const postCollection = POST_COLLECTION[flagged.contentType];
    if (postCollection) {
      const doc = await db.collection(postCollection).findOne({ _id }, { projection: { mentions: 1, title: 1 } });
      if (!doc?.mentions?.length) return;
      await notifyMentions(db, {
        actorId: flagged.authorId, mentions: doc.mentions, sourceId: flagged.contentId, kind: 'post',
        target: moderationTarget(flagged.contentType, flagged.contentId, String(doc.title ?? '')),
      });
      return;
    }
    if (flagged.contentType === 'comment') {
      const c = await db.collection('comments').findOne({ _id }, { projection: { mentions: 1, relevantPostId: 1 } });
      if (!c?.mentions?.length || !c.relevantPostId) return;
      const parent = await findCommentParent(db, String(c.relevantPostId));
      if (!parent) return;
      await notifyMentions(db, {
        actorId: flagged.authorId, mentions: c.mentions, sourceId: flagged.contentId, kind: 'comment',
        target: commentTarget(parent.collection, String(c.relevantPostId), parent.title),
        skipUserIds: parent.author ? [parent.author] : [],
      });
    }
  } catch (err) {
    await capture(err);
  }
}
