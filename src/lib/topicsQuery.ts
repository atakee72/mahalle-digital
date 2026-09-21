import type { Collection, Document, Filter } from 'mongodb';
import { ObjectId } from 'mongodb';
import { connectDB } from './mongodb';
import { PUBLIC_AUTHOR_PROJECTION } from './publicAuthor';
import {
  applyQueryOptions,
  buildFilter,
  getTotalCount,
  buildPaginationMeta,
  parseQueryParams,
} from './queryUtils';
import { FORUM_QUERY_OPTIONS } from './forumQueryOptions';

export { FORUM_QUERY_OPTIONS };

export interface FetchCollectionResult<T> {
  items: T[];
  pagination: ReturnType<typeof buildPaginationMeta>;
}

/**
 * Build the standard moderation $or filter used by forum collections.
 * Shows approved content + legacy content + user-reported pending
 * + the current user's own pending/rejected posts.
 */
export function buildModerationFilter(currentUserId?: string) {
  return {
    $or: [
      { moderationStatus: 'approved' },
      { moderationStatus: { $exists: false } },
      { moderationStatus: 'pending', isUserReported: true },
      ...(currentUserId
        ? [
            { author: currentUserId, moderationStatus: 'pending' },
            { author: currentUserId, moderationStatus: 'rejected' },
          ]
        : []),
    ],
  };
}

/**
 * Merge a moderation filter into an existing query filter, handling the
 * $and / plain-object / empty-filter cases consistently.
 */
export function mergeModerationFilter(filter: Record<string, any>, moderationFilter: Record<string, any>) {
  if (filter.$and) {
    filter.$and.push(moderationFilter);
  } else if (Object.keys(filter).length > 0) {
    const existingFilter = { ...filter };
    Object.keys(existingFilter).forEach((key) => delete filter[key]);
    filter.$and = [existingFilter, moderationFilter];
  } else {
    Object.assign(filter, moderationFilter);
  }
  return filter;
}

/**
 * Populate authors for a batch of docs using a single $in query
 * (instead of N+1 findOne calls).
 *
 * Handles:
 *  - author already populated (object with userName) → kept as-is
 *  - author stored as ObjectId
 *  - author stored as string (valid ObjectId hex)
 */
export async function populateAuthors<T extends { author?: any }>(docs: T[]): Promise<T[]> {
  if (docs.length === 0) return docs;

  const db = await connectDB();
  const usersCollection = db.collection('users');

  // Collect unique author ids that need lookup
  const idSet = new Set<string>();
  for (const doc of docs) {
    const a = doc.author;
    if (!a) continue;
    if (typeof a === 'object' && 'userName' in a) continue; // already populated
    if (typeof a === 'string') {
      if (ObjectId.isValid(a)) idSet.add(a);
    } else if (a instanceof ObjectId) {
      idSet.add(a.toString());
    } else if (typeof a === 'object' && a._id) {
      idSet.add(a._id.toString());
    }
  }

  if (idSet.size === 0) return docs;

  // SECURITY (Plan B Task 3, Decision 10): narrowed from `{ password: 0 }`
  // (which returned every field except password — email, isBanned,
  // pendingEmail, strikes, etc.) to an explicit allowlist. This data is
  // serialized into client-visible payloads (SSR props for client:only
  // islands, JSON API responses) — see /topics/[id].astro's initialTopic.
  // Only widen this list after auditing every `.author?.<field>` /
  // `.author.<field>` access across forum + calendar consumers.
  // `role` is included: ForumIndexInner displays public "Mahalle-Team" admin
  // badge from it — public-by-display data, unlike email.
  const objectIds = Array.from(idSet).map((id) => new ObjectId(id));
  const users = await usersCollection
    .find(
      { _id: { $in: objectIds } },
      { projection: PUBLIC_AUTHOR_PROJECTION } // + handle since 2026-09-21 (shown next to names)
    )
    .toArray();

  // Avatar uploads land in `userPicture` (src/pages/api/profile/avatar.ts) while
  // every consumer reads `author.image` — normalize here, the same
  // `image || userPicture` the session callback does, so cards, comments and
  // the „Wer mitredet" discs show the photo instead of initials (2026-09-11).
  const userMap = new Map<string, any>();
  for (const u of users) userMap.set(u._id.toString(), { ...u, image: u.image || u.userPicture || null });

  return docs.map((doc) => {
    const a = doc.author;
    if (!a) return doc;
    if (typeof a === 'object' && 'userName' in a) return doc;

    let key: string | null = null;
    if (typeof a === 'string' && ObjectId.isValid(a)) key = a;
    else if (a instanceof ObjectId) key = a.toString();
    else if (typeof a === 'object' && a._id) key = a._id.toString();

    const author = key ? userMap.get(key) ?? null : null;
    return { ...doc, author };
  });
}

/**
 * Standard forum-collection fetch: parses query params, applies the
 * moderation filter, runs paginated find + count in parallel, and
 * batch-populates authors when not projected out.
 */
export async function fetchCollectionWithAuthors<T extends Document>(
  collection: Collection<T>,
  url: URL,
  currentUserId?: string
): Promise<FetchCollectionResult<T>> {
  const options = parseQueryParams(url);
  const filter = buildFilter(options) as Filter<T>;

  mergeModerationFilter(filter as Record<string, any>, buildModerationFilter(currentUserId));

  const [items, total] = await Promise.all([
    applyQueryOptions<T>(collection, options, filter),
    getTotalCount(collection, filter),
  ]);

  const limit = parseInt(options.limit as unknown as string) || 20;
  const offset = parseInt(options.offset as unknown as string) || 0;
  const pagination = buildPaginationMeta(total, limit, offset);

  const shouldPopulateAuthor =
    !options.fields || options.fields.length === 0 || options.fields.includes('author');

  const populated = shouldPopulateAuthor ? await populateAuthors(items as any[]) : items;
  await attachSavedCounts(populated as any[]);
  await attachLastCommentAt(populated as any[]);

  return { items: populated as T[], pagination };
}

/**
 * `savedCount` per feed item — how many members bookmarked it (one batched
 * `$group` over `savedPosts`, whose `postId` is the string id). Read-time
 * join like authors: never denormalized onto the post. Cards render it
 * next to likes/replies (user request, 2026-09-10).
 */
export async function attachSavedCounts(items: Array<{ _id: any; savedCount?: number }>): Promise<void> {
  if (!items.length) return;
  const ids = items.map((it) => String(it._id));
  const db = await connectDB();
  const rows = await db
    .collection('savedPosts')
    .aggregate<{ _id: string; n: number }>([
      { $match: { postId: { $in: ids } } },
      { $group: { _id: '$postId', n: { $sum: 1 } } },
    ])
    .toArray();
  const counts = new Map(rows.map((r) => [String(r._id), r.n]));
  for (const it of items) it.savedCount = counts.get(String(it._id)) ?? 0;
}

/**
 * Server-side fetch helper for hydrating the forum with initialData.
 * Builds a synthetic URL from the shared options and reuses
 * fetchCollectionWithAuthors so the shape matches the client hook's fetch.
 */
export async function fetchForumItemsForSSR(
  type: 'topics' | 'announcements' | 'recommendations',
  currentUserId: string | undefined,
  opts: { fields?: string[]; sortBy?: string; sortOrder?: string } = FORUM_QUERY_OPTIONS
) {
  const db = await connectDB();
  const collection = db.collection(type) as unknown as Collection<Document>;

  const params = new URLSearchParams();
  if (opts.fields?.length) params.set('fields', opts.fields.join(','));
  if (opts.sortBy) params.set('sortBy', opts.sortBy);
  if (opts.sortOrder) params.set('sortOrder', opts.sortOrder);

  const url = new URL(`http://ssr.local/api/${type}?${params.toString()}`);
  const result = await fetchCollectionWithAuthors(collection, url, currentUserId);
  // Serialize for client hydration: Date/ObjectId → string
  return JSON.parse(JSON.stringify(result.items));
}


/**
 * „Ähnliche Themen" for the detail rail — up to `max` sibling posts from
 * the same collection, ranked by shared-tag count (desc) then newest-first,
 * filled with the newest public posts when fewer than `max` share a tag
 * (same recipe as the blog's `relatedFor`). Visibility is the strict public
 * gate (approved or legacy-absent) — never the viewer's own pending/rejected
 * posts, never reported items. Serialized for the client island.
 */
export interface RelatedPost {
  id: string;
  title: string;
  replies: number;
  date: string | number;
}

export async function fetchRelatedForDetail(
  type: 'topics' | 'announcements' | 'recommendations',
  current: { _id: ObjectId | string; tags?: string[] },
  max = 3
): Promise<RelatedPost[]> {
  const db = await connectDB();
  const collection = db.collection(type);
  const selfId = typeof current._id === 'string' ? new ObjectId(current._id) : current._id;
  const tags = (current.tags ?? []).filter((t) => typeof t === 'string' && t.length > 0);
  const publicGate = { $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }] };
  const projection = { title: 1, tags: 1, comments: 1, date: 1 };

  const byTag = tags.length
    ? await collection
        .find({ _id: { $ne: selfId }, tags: { $in: tags }, ...publicGate }, { projection })
        .sort({ date: -1 })
        .limit(24)
        .toArray()
    : [];
  const tagSet = new Set(tags);
  const ranked = byTag
    .map((d) => ({ d, shared: (d.tags ?? []).filter((t: string) => tagSet.has(t)).length }))
    .sort((a, b) => b.shared - a.shared || Number(b.d.date ?? 0) - Number(a.d.date ?? 0))
    .map((x) => x.d);

  const picked = ranked.slice(0, max);
  if (picked.length < max) {
    const exclude = [selfId, ...picked.map((d) => d._id)];
    const fill = await collection
      .find({ _id: { $nin: exclude }, ...publicGate }, { projection })
      .sort({ date: -1 })
      .limit(max - picked.length)
      .toArray();
    picked.push(...fill);
  }

  return picked.map((d) => ({
    id: String(d._id),
    title: String(d.title ?? ''),
    replies: Array.isArray(d.comments) ? d.comments.length : 0,
    date: d.date instanceof Date ? d.date.toISOString() : (d.date ?? 0),
  }));
}

/**
 * `lastCommentAt` per feed item — newest visible comment (approved or
 * legacy-absent moderation) on the post, as a ms timestamp. One batched
 * `$group` over `comments` (`relevantPostId` is an ObjectId, `date` a number).
 * Feeds the forum title-block „diskutiert heute" counter (2026-09-11) —
 * before this the counter read comment IDS for dates and was always 0.
 */
export async function attachLastCommentAt(items: Array<{ _id: any; lastCommentAt?: number | null }>): Promise<void> {
  if (!items.length) return;
  const ids = items
    .map((it) => (it._id instanceof ObjectId ? it._id : ObjectId.isValid(String(it._id)) ? new ObjectId(String(it._id)) : null))
    .filter((id): id is ObjectId => id !== null);
  const db = await connectDB();
  const rows = await db
    .collection('comments')
    .aggregate<{ _id: ObjectId; last: number | Date }>([
      { $match: { relevantPostId: { $in: ids }, $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }] } },
      { $group: { _id: '$relevantPostId', last: { $max: '$date' } } },
    ])
    .toArray();
  const last = new Map(rows.map((r) => [String(r._id), r.last instanceof Date ? r.last.getTime() : Number(r.last)]));
  for (const it of items) it.lastCommentAt = last.get(String(it._id)) ?? null;
}
