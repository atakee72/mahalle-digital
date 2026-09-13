// Cross-collection move of a forum post (= kind change). SERVER-SIDE, but it
// takes a Db instead of importing connectDB so it stays unit-testable under
// tsx (src/lib/mongodb.ts throws at import when MONGODB_URI is unset).
//
// No transactions on the free Atlas tier, so the order is COPY FIRST, DELETE
// LAST and every step is idempotent: a re-run after a crash converges
// (source gone + target present → alreadyMoved; source still present →
// replaceOne/upsert overwrites the half-written copy and the delete lands).
//
// What references a post by KIND and therefore needs re-keying:
//   flaggedContent.contentType        (singular, contentId is the string id)
//   flaggedContent.parentCollection (flagged comments)
//   notifications.target.contentType + .href (href is STORED)
//   translationCache rows             (key starts with `${contentType}:${id}`) → dropped
// What does NOT: comments (relevantPostId only), likes/views (on the doc),
// savedPosts (postId only), kiezKontextCache (caller invalidates).
import { ObjectId, type Db } from 'mongodb';
import {
  POST_COLLECTIONS, buildMovedDoc, contentTypeForCollection, hrefForPost, type PostCollection,
} from './postKind';

export type MoveDb = Pick<Db, 'collection'>;

export type MoveResult =
  | { ok: true; doc: Record<string, unknown>; alreadyMoved: boolean }
  | { ok: false; reason: 'same_collection' | 'not_found' };

export async function movePost(
  db: MoveDb,
  args: { id: string; from: PostCollection; to: PostCollection; now?: Date },
): Promise<MoveResult> {
  const { id, from, to } = args;
  const now = args.now ?? new Date();
  if (from === to) return { ok: false, reason: 'same_collection' };
  if (!ObjectId.isValid(id)) return { ok: false, reason: 'not_found' };
  const _id = new ObjectId(id);

  const source = await db.collection(from).findOne({ _id });
  if (!source) {
    const already = await db.collection(to).findOne({ _id });
    return already
      ? { ok: true, doc: already as Record<string, unknown>, alreadyMoved: true }
      : { ok: false, reason: 'not_found' };
  }

  const moved = buildMovedDoc(source as Record<string, unknown>, from, to, now);
  await db.collection(to).replaceOne({ _id }, moved, { upsert: true });

  const fromCT = contentTypeForCollection(from);
  const toCT = contentTypeForCollection(to);
  await db.collection('flaggedContent').updateMany(
    { contentId: id, contentType: fromCT },
    { $set: { contentType: toCT } },
  );
  await db.collection('flaggedContent').updateMany(
    { parentPostId: id, parentCollection: from },
    { $set: { parentCollection: to } },
  );
  await db.collection('notifications').updateMany(
    { 'target.contentId': id, 'target.contentType': fromCT },
    { $set: { 'target.contentType': toCT, 'target.href': hrefForPost(to, id) } },
  );
  await db.collection('translationCache').deleteMany({ contentType: fromCT, contentId: id });

  await db.collection(from).deleteOne({ _id });
  return { ok: true, doc: moved, alreadyMoved: false };
}

/** Which OTHER forum collection holds this id, if any (detail-page redirect after a move). */
export async function locatePost(
  db: MoveDb,
  id: string,
  exclude: PostCollection,
): Promise<PostCollection | null> {
  if (!ObjectId.isValid(id)) return null;
  const _id = new ObjectId(id);
  for (const c of POST_COLLECTIONS) {
    if (c === exclude) continue;
    const hit = await db.collection(c).findOne({ _id }, { projection: { _id: 1 } });
    if (hit) return c;
  }
  return null;
}
