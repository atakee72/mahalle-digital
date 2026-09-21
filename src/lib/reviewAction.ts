/**
 * Shared review action processing logic.
 * Used by both single review (review.ts) and bulk review (bulk-review.ts) endpoints.
 */

import { ObjectId, type Db } from 'mongodb';
import type { FlaggedContent, User } from '../types';
import { notify, commentTarget, moderationTarget } from './notifications';
import { notifyMentionsOnApproval } from './mentions/mentionsStore';
import { invalidateKiezKontext } from './kiez/kontext';

const MAX_STRIKES = 3;

const COLLECTION_MAP: Record<string, string> = {
  topic: 'topics',
  announcement: 'announcements',
  recommendation: 'recommendations',
  comment: 'comments',
  event: 'events',
  marketplace: 'listings',
  news: 'news'
};

export interface ReviewResult {
  reviewStatus: 'approved' | 'rejected';
  strikeCount?: number;
  userBanned?: boolean;
}

export async function processReviewAction(
  db: Db,
  flaggedContent: FlaggedContent,
  action: 'approve' | 'reject' | 'approve_with_warning',
  reviewerId: string,
  options?: { rejectionReason?: string; warningText?: string; notes?: string }
): Promise<ReviewResult> {
  const flaggedCollection = db.collection<FlaggedContent>('flaggedContent');
  const usersCollection = db.collection<User>('users');

  const isRejection = action === 'reject';
  const hasWarning = action === 'approve_with_warning';
  const newReviewStatus = isRejection ? 'rejected' : 'approved';

  // Update flagged content record
  await flaggedCollection.updateOne(
    { _id: new ObjectId(flaggedContent._id as string) },
    {
      $set: {
        reviewStatus: newReviewStatus,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewNotes: options?.notes || undefined,
        rejectionReason: isRejection ? (options?.rejectionReason || undefined) : undefined,
        hasWarningLabel: hasWarning,
        warningText: hasWarning ? (options?.warningText || undefined) : undefined,
        updatedAt: new Date()
      }
    }
  );

  // Update the original content's moderation status
  let userBanned = false;
  let newStrikeCount = 0;

  if (flaggedContent.contentId && flaggedContent.contentType) {
    const collectionName = COLLECTION_MAP[flaggedContent.contentType];
    if (collectionName) {
      const contentCollection = db.collection(collectionName);

      const updateData: Record<string, any> = {
        moderationStatus: isRejection ? 'rejected' : 'approved',
        updatedAt: new Date()
      };

      // Set approvedAt timestamp and fetchDate for news items
      if (!isRejection && flaggedContent.contentType === 'news') {
        updateData.approvedAt = new Date();
        updateData.fetchDate = new Date().toISOString().split('T')[0];
      }

      if (isRejection && options?.rejectionReason) {
        updateData.rejectionReason = options.rejectionReason;
      }

      if (hasWarning) {
        updateData.hasWarningLabel = true;
        updateData.warningText = options?.warningText;
      }

      await contentCollection.updateOne(
        { _id: new ObjectId(flaggedContent.contentId) },
        {
          $set: updateData,
          $unset: { isUserReported: '' }
        }
      );

      // A rejected topic drops out of public view — same dead-chip hazard
      // as topic delete/edit, so drop the Kiez-Daten Anwohner-Kontext
      // cache (best-effort by contract, never fails the review).
      if (isRejection && flaggedContent.contentType === 'topic') {
        await invalidateKiezKontext();
      }

      // Handle comment array updates for parent posts
      if (flaggedContent.contentType === 'comment') {
        const flaggedAny = flaggedContent as any;

        if (!isRejection) {
          // APPROVED: Add comment to parent's comments array
          let parentPostId = flaggedAny.parentPostId;
          let parentCollection = flaggedAny.parentCollection;

          if (!parentPostId) {
            const comment = await contentCollection.findOne({ _id: new ObjectId(flaggedContent.contentId) });
            if (comment && comment.relevantPostId) {
              parentPostId = comment.relevantPostId.toString();
              parentCollection = 'topics';
            }
          }

          if (parentPostId && parentCollection) {
            const parentCollectionRef = db.collection(parentCollection);
            const parentDoc = await parentCollectionRef.findOneAndUpdate(
              { _id: new ObjectId(parentPostId) },
              {
                $addToSet: { comments: new ObjectId(flaggedContent.contentId) },
                $set: { updatedAt: new Date() }
              },
              { projection: { author: 1, title: 1 } }
            );

            // The comment just became visible — fire the "someone replied"
            // notification that create.ts skipped while it was pending. A flagged
            // EDIT (`fromEdit`) was already announced when the comment was created.
            if (parentDoc?.author && !flaggedAny.fromEdit) {
              await notify({
                userId: String(parentDoc.author),
                type: 'comment',
                actorId: flaggedContent.authorId,
                target: commentTarget(parentCollection, parentPostId, parentDoc.title ?? ''),
              });
            }
          }
        } else {
          // REJECTED: Remove comment from parent's comments array
          const comment = await contentCollection.findOne({ _id: new ObjectId(flaggedContent.contentId) });
          if (comment && comment.relevantPostId) {
            const parentCollections = ['topics', 'announcements', 'recommendations', 'events'];
            for (const pc of parentCollections) {
              await db.collection(pc).updateOne(
                { _id: comment.relevantPostId },
                { $pull: { comments: new ObjectId(flaggedContent.contentId) } }
              );
            }
          }
        }
      }
    }

    // „@handle" mentions were held back while the item was pending (create/edit
    // notify only when public). Reads the LIVE doc, skips user reports, is
    // idempotent and never throws — see src/lib/mentions/mentionsStore.ts.
    if (!isRejection) {
      await notifyMentionsOnApproval(db, flaggedContent);
    }

    // Handle strike system on rejection
    if (isRejection && flaggedContent.authorId) {
      const strikeRecord = {
        date: new Date(),
        reason: options?.rejectionReason || 'Content violated community guidelines',
        contentType: flaggedContent.contentType,
        contentId: flaggedContent.contentId,
        reviewedBy: reviewerId
      };

      const userUpdate = await usersCollection.findOneAndUpdate(
        { _id: new ObjectId(flaggedContent.authorId) },
        {
          $inc: { moderationStrikes: 1 },
          $push: { strikeHistory: strikeRecord },
          $set: { updatedAt: new Date() }
        },
        { returnDocument: 'after' }
      );

      if (userUpdate) {
        newStrikeCount = userUpdate.moderationStrikes || 1;

        // Bans are counted per TRANSITION (not-banned -> banned), mirroring
        // the bulk Folgen-Vorschau acknowledgment (computeBulkDeltas flags
        // only the first item that crosses the threshold for a given
        // author). Without the `isBanned !== true` guard, every subsequent
        // rejection of an already-banned author's content would re-set
        // userBanned = true, over-counting bansTriggered in bulk-review.ts.
        if (newStrikeCount >= MAX_STRIKES && userUpdate.isBanned !== true) {
          await usersCollection.updateOne(
            { _id: new ObjectId(flaggedContent.authorId) },
            {
              $set: {
                isBanned: true,
                bannedAt: new Date(),
                bannedReason: `Automatically banned after ${MAX_STRIKES} content violations`,
                updatedAt: new Date()
              }
            }
          );
          userBanned = true;
        }
      }
    }
  }

  // Notify the author of the decision — every reviewed item, including clean
  // approvals (silent rejection was the dark pattern this feature fixes; an
  // approved item reads as „ist veröffentlicht" per the CD copy).
  if (flaggedContent.contentId && flaggedContent.contentType && flaggedContent.authorId) {
    const excerpt = (flaggedContent.title ?? flaggedContent.body ?? '').slice(0, 80);
    const flaggedAny = flaggedContent as any;
    // A moderated COMMENT deep-links to its parent post when we know it
    // (approve path stores parentPostId/parentCollection on the flagged
    // record); otherwise moderationTarget's fallback links to the forum.
    const target =
      flaggedContent.contentType === 'comment' && flaggedAny.parentPostId && flaggedAny.parentCollection
        ? commentTarget(flaggedAny.parentCollection, flaggedAny.parentPostId, excerpt)
        : moderationTarget(flaggedContent.contentType, flaggedContent.contentId, excerpt);
    await notify({
      userId: flaggedContent.authorId,
      type: 'moderation',
      target,
      meta: {
        outcome: isRejection ? 'rejected' : hasWarning ? 'warned' : 'approved',
        // The moderated thing itself — target.contentType can't carry this for
        // comments (it points at the parent page). Drives Beitrag/Kommentar copy.
        contentKind: flaggedContent.contentType,
        // CD copy renders „{n}. Verwarnung" — the strike NUMBER, not a flag.
        // newStrikeCount is populated by the strike block above: ≥1 when the
        // author doc was found and updated, 0 if the lookup missed (stale/
        // legacy authorId) — hence the > 0 guard below.
        // Omit strikeCount when the strike update found no user doc
        // (newStrikeCount stays 0 on stale/legacy authorIds) — the client
        // falls back to a generic „1. Verwarnung" rather than rendering „0.".
        ...(isRejection && newStrikeCount > 0 ? { strikeCount: newStrikeCount } : {}),
      },
    });
  }

  return {
    reviewStatus: newReviewStatus,
    strikeCount: isRejection ? newStrikeCount : undefined,
    userBanned: isRejection ? userBanned : undefined
  };
}
