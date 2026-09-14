// src/lib/comments/cascade.ts — delete a post's comment thread when the post
// is deleted. Dependency-pure apart from the mongodb driver types (never
// imports connectDB) so it is unit-testable against a fake Db.
//
// Comments reference their parent ONLY via `relevantPostId` (ObjectId) —
// see src/pages/api/comments/create.ts. Two self-delete routes used to filter
// on a `topic` field that no comment ever had (announcements,
// recommendations), and the admin delete of official announcements never
// cascaded at all — every one of those left an orphaned thread behind.
//
// Reported comments keep their moderation-queue record, marked deleted
// (same shape as the comment self-delete route, "self-delete keeps the
// report", 2026-09-08). flaggedContent rows are never deleted here.
import { ObjectId, type Db } from 'mongodb';

export type CascadeDb = Pick<Db, 'collection'>;

export interface CascadeResult {
  deletedComments: number;
  flaggedMarked: number;
}

export async function deleteCommentsForPost(db: CascadeDb, postId: string): Promise<CascadeResult> {
  if (!ObjectId.isValid(postId)) throw new Error(`deleteCommentsForPost: invalid post id "${postId}"`);
  const parent = new ObjectId(postId);
  const comments = db.collection('comments');

  // Ids first: the flag stamp needs them after the rows are gone.
  const ids = (await comments.find({ relevantPostId: parent }, { projection: { _id: 1 } }).toArray())
    .map((c) => String(c._id));
  if (ids.length === 0) return { deletedComments: 0, flaggedMarked: 0 };

  const del = await comments.deleteMany({ relevantPostId: parent });

  const flagged = await db.collection('flaggedContent').updateMany(
    { contentType: 'comment', contentId: { $in: ids } },
    { $set: { contentDeleted: true, contentDeletedAt: new Date() } }
  );

  return { deletedComments: del.deletedCount ?? 0, flaggedMarked: flagged.modifiedCount ?? 0 };
}
