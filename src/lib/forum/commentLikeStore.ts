/**
 * Comment likes — parent lookup with the db INJECTED (imports only the mongodb package,
 * so node:test can load it). The visibility rule itself is isParentVisible() in commentLike.ts.
 */
import { ObjectId, type Db } from 'mongodb';

const PARENT_COLLECTIONS = ['topics', 'announcements', 'recommendations', 'events'] as const;

export interface LikeParent {
  collection: string;
  doc: { _id: unknown; author?: unknown; title?: string; moderationStatus?: string; isUserReported?: boolean };
}

/** Where does the post behind a comment's `relevantPostId` live? null = nowhere. */
export async function findLikeParent(db: Pick<Db, 'collection'>, postId: unknown): Promise<LikeParent | null> {
  const id = String(postId ?? '');
  if (!ObjectId.isValid(id)) return null;
  const _id = new ObjectId(id);
  for (const collection of PARENT_COLLECTIONS) {
    const doc = await db.collection(collection).findOne(
      { _id },
      { projection: { author: 1, title: 1, moderationStatus: 1, isUserReported: 1 } },
    );
    if (doc) return { collection, doc: doc as LikeParent['doc'] };
  }
  return null;
}
