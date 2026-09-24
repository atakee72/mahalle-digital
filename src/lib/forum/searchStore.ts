// SERVER-ONLY (imports the driver). Runs the three post collections and the
// comments in parallel under the caller's moderation filter and returns
// slim rows: excerpt instead of body, allowlisted author, comment parent
// title. Regex search is fine at today's size (hundreds of posts); a text
// index is the next step when it isn't.
import type { Db, Document } from 'mongodb';
import { ObjectId } from 'mongodb';
import { buildModerationFilter, mergeModerationFilter, populateAuthors } from '../topicsQuery';
import {
  buildPostSearchFilter, buildSearchRegex, excerptAround,
  KIND_BY_COLLECTION, PATH_BY_KIND, type PostCollection, type PostKind,
  type SearchPost, type SearchComment, type SearchResult,
} from './searchQuery';
export type { SearchPost, SearchComment, SearchResult };

export const SEARCH_PER_KIND = 20;
export const SEARCH_POSTS_MAX = 30;
export const SEARCH_COMMENTS_MAX = 20;

const COLLECTIONS: PostCollection[] = ['topics', 'announcements', 'recommendations'];

function toIso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' || typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

async function searchPosts(db: Db, q: string, userId?: string): Promise<SearchPost[]> {
  const perKind = await Promise.all(
    COLLECTIONS.map(async (name) => {
      const filter = buildPostSearchFilter(q) as Record<string, any>;
      mergeModerationFilter(filter, buildModerationFilter(userId));
      const docs = await db
        .collection(name)
        .find(filter)
        .sort({ date: -1 })
        .limit(SEARCH_PER_KIND)
        .project({ title: 1, body: 1, tags: 1, author: 1, date: 1, createdAt: 1 })
        .toArray();
      return docs.map((d) => ({ ...d, __kind: KIND_BY_COLLECTION[name] }));
    })
  );
  const merged = (perKind.flat() as Document[])
    .sort((a, b) => (toIso(b.date ?? b.createdAt) ?? '').localeCompare(toIso(a.date ?? a.createdAt) ?? ''))
    .slice(0, SEARCH_POSTS_MAX);
  const populated = await populateAuthors(merged as any[]);
  return populated.map((d: any) => ({
    _id: String(d._id),
    kind: d.__kind as PostKind,
    href: `${PATH_BY_KIND[d.__kind as PostKind]}/${String(d._id)}`,
    title: typeof d.title === 'string' ? d.title : '',
    excerpt: excerptAround(d.body, q),
    tags: Array.isArray(d.tags) ? d.tags.filter((t: unknown) => typeof t === 'string') : [],
    date: toIso(d.date ?? d.createdAt),
    author: d.author && typeof d.author === 'object'
      ? { name: typeof d.author.name === 'string' ? d.author.name : null, handle: typeof d.author.handle === 'string' ? d.author.handle : null }
      : null,
  }));
}

async function searchComments(db: Db, q: string, userId?: string): Promise<SearchComment[]> {
  const rx = buildSearchRegex(q);
  const comments = await db
    .collection('comments')
    .find({
      body: rx,
      $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }],
    })
    .sort({ date: -1 })
    .limit(SEARCH_COMMENTS_MAX * 2) // headroom: some parents will be filtered out below
    .project({ body: 1, relevantPostId: 1, date: 1, createdAt: 1 })
    .toArray();
  if (comments.length === 0) return [];

  const parentIds = [...new Set(comments.map((c) => String(c.relevantPostId)).filter((id) => ObjectId.isValid(id)))]
    .map((id) => new ObjectId(id));
  // Parent must be visible to the caller — same rule as the feed. A comment
  // on a rejected or deleted post never surfaces.
  const parents = await Promise.all(
    COLLECTIONS.map(async (name) => {
      const filter: Record<string, any> = { _id: { $in: parentIds } };
      mergeModerationFilter(filter, buildModerationFilter(userId));
      const docs = await db.collection(name).find(filter).project({ title: 1 }).toArray();
      return docs.map((d) => [String(d._id), { title: String(d.title ?? ''), kind: KIND_BY_COLLECTION[name] }] as const);
    })
  );
  const parentMap = new Map(parents.flat());

  const out: SearchComment[] = [];
  for (const c of comments) {
    const p = parentMap.get(String(c.relevantPostId));
    if (!p) continue;
    out.push({
      _id: String(c._id),
      href: `${PATH_BY_KIND[p.kind]}/${String(c.relevantPostId)}#comment-${String(c._id)}`,
      excerpt: excerptAround(c.body, q),
      date: toIso(c.date ?? c.createdAt),
      parentTitle: p.title,
    });
    if (out.length >= SEARCH_COMMENTS_MAX) break;
  }
  return out;
}

export async function searchForum(db: Db, q: string, userId?: string): Promise<SearchResult> {
  const [posts, comments] = await Promise.all([searchPosts(db, q, userId), searchComments(db, q, userId)]);
  return { q, posts, comments };
}
