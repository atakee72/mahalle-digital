// Forum post kinds vs. their storage. DEPENDENCY-PURE (no mongodb, no env):
// imported by the ForumPostDetail island AND by server code.
//
// The three forum kinds are three collections. Changing a post's kind is a
// cross-collection move (src/lib/forum/movePost.ts); this file owns the
// naming so nobody hand-rolls the plural/singular maps again.

export type PostKind = 'discussion' | 'recommendation' | 'announcement';
export type PostCollection = 'topics' | 'announcements' | 'recommendations';
/** Singular form used by flaggedContent.contentType, notifications.target.contentType, translationCache. */
export type PostContentType = 'topic' | 'announcement' | 'recommendation';

export const POST_COLLECTIONS: readonly PostCollection[] = ['topics', 'announcements', 'recommendations'];

const KIND_TO_COLLECTION: Record<PostKind, PostCollection> = {
  discussion: 'topics',
  recommendation: 'recommendations',
  announcement: 'announcements',
};
const COLLECTION_TO_KIND: Record<PostCollection, PostKind> = {
  topics: 'discussion',
  recommendations: 'recommendation',
  announcements: 'announcement',
};
const COLLECTION_TO_CONTENT_TYPE: Record<PostCollection, PostContentType> = {
  topics: 'topic',
  announcements: 'announcement',
  recommendations: 'recommendation',
};

export function isPostCollection(x: unknown): x is PostCollection {
  return typeof x === 'string' && (POST_COLLECTIONS as readonly string[]).includes(x);
}
export function collectionForKind(kind: PostKind): PostCollection {
  return KIND_TO_COLLECTION[kind];
}
export function kindForCollection(c: PostCollection): PostKind {
  return COLLECTION_TO_KIND[c];
}
export function contentTypeForCollection(c: PostCollection): PostContentType {
  return COLLECTION_TO_CONTENT_TYPE[c];
}
export function hrefForPost(c: PostCollection, id: string): string {
  return `/${c}/${id}`;
}

/**
 * The document as it should look in the target collection. Keeps _id,
 * author, engagement (likes/likedBy/views/comments), moderation state and
 * editHistory; strips fields that only mean something in one collection
 * (`isOfficial`/`pinnedUntil`/`editCount` are announcement-only and
 * server-controlled, `category` is recommendation-only); a recommendation
 * always carries a category, so the move gives it the schema default.
 * Stamps `movedFrom`/`movedAt` as provenance.
 */
export function buildMovedDoc(
  source: Record<string, unknown>,
  from: PostCollection,
  to: PostCollection,
  now: Date,
): Record<string, unknown> {
  const { isOfficial: _o, pinnedUntil: _p, editCount: _e, category: _c, ...rest } = source;
  const doc: Record<string, unknown> = { ...rest, updatedAt: now, movedFrom: from, movedAt: now };
  if (to === 'recommendations') doc.category = 'other';
  return doc;
}
