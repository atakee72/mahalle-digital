// src/lib/newsboard/newsQuery.ts
// SERVER-ONLY (imports mongodb). Never import from a .svelte/client file.
import { ObjectId } from 'mongodb';
import { connectDB } from '../mongodb';
import type { NewsItem } from '../../types';
// NewsDetail is defined in the PURE module so the detail island can import the
// type without ever referencing this mongodb-importing file. Re-exported for
// the page's convenience.
import type { NewsDetail } from './newsTaxonomy';
export type { NewsDetail };

function toDetail(it: any): NewsDetail {
  // submittedBy may be populated (object) or a raw id string.
  const sub = it.submittedBy;
  const submittedByName =
    sub && typeof sub === 'object' ? (sub.name ?? sub.username ?? undefined) : undefined;
  return {
    id: String(it._id),
    source: it.source,
    title: it.title,
    description: it.description ?? '',
    aiSummary: it.aiSummary,
    imageUrl: it.imageUrl ?? '',
    sourceUrl: it.sourceUrl,
    sourceName: it.sourceName ?? '',
    aiCategory: it.aiCategory,
    moderationStatus: it.moderationStatus,
    warningText: it.warningText,
    submittedByName,
    publishedAt: (it.publishedAt instanceof Date ? it.publishedAt.toISOString() : it.publishedAt) ?? new Date().toISOString(),
    fetchDate: it.fetchDate,
    approvedAt: it.approvedAt instanceof Date ? it.approvedAt.toISOString() : it.approvedAt,
  };
}

// Returns the article if visible to this user (approved, OR the user's own
// pending/rejected submission). Returns null for not-found / not-visible.
export async function fetchNewsDetailForSSR(id: string, userId: string | null): Promise<NewsDetail | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await connectDB();
  const news = db.collection<NewsItem>('news');
  const item = await news.findOne({ _id: new ObjectId(id) } as any);
  if (!item) return null;

  const isApproved = item.moderationStatus === 'approved';
  const isOwn = !!userId && String((item as any).submittedBy) === String(userId);
  if (!isApproved && !isOwn) return null;

  // Populate submitter name for user-submitted articles.
  if (item.source === 'user_submitted' && item.submittedBy && typeof item.submittedBy === 'string') {
    try {
      const users = db.collection('users');
      const u = await users.findOne({ _id: new ObjectId(item.submittedBy) }, { projection: { name: 1 } });
      if (u) (item as any).submittedBy = { _id: String(u._id), name: u.name ?? null };
    } catch { /* fall through with raw id */ }
  }
  return toDetail(item);
}

// Lightweight list fetch for first-paint SSR of the index. Returns serialized
// rows shaped like the /api/news response items so the island can map them
// with the same toVM. Default window: last 7 days, newest first, limit 40.
// NOTE: this duplicates the index API's visibility filter — keep them in sync
// (both live for the same reason; a Phase-3 refactor could extract a shared
// buildNewsFilter). Acceptable duplication for now.
export async function fetchNewsForSSR(userId: string | null, days = 7, limit = 40): Promise<any[]> {
  const db = await connectDB();
  const news = db.collection<NewsItem>('news');
  const since = new Date(Date.now() - days * 86_400_000);
  const filter: Record<string, any> = {
    publishedAt: { $gte: since },
    $or: [
      { moderationStatus: 'approved' },
      ...(userId ? [
        { submittedBy: userId, moderationStatus: 'pending' },
        { submittedBy: userId, moderationStatus: 'rejected' },
      ] : []),
    ],
  };
  const items = await news.find(filter as any)
    .sort({ fetchDate: -1, source: -1, aiRelevanceScore: -1, approvedAt: -1, _id: -1 })
    .limit(limit).toArray();
  // Serialize ids/dates so the array is prop-safe across the island boundary.
  return items.map((it: any) => ({
    ...it,
    _id: String(it._id),
    submittedBy: it.submittedBy && typeof it.submittedBy === 'object' ? it.submittedBy : it.submittedBy,
    publishedAt: it.publishedAt instanceof Date ? it.publishedAt.toISOString() : it.publishedAt,
    fetchedAt: it.fetchedAt instanceof Date ? it.fetchedAt.toISOString() : it.fetchedAt,
    approvedAt: it.approvedAt instanceof Date ? it.approvedAt.toISOString() : it.approvedAt,
    createdAt: it.createdAt instanceof Date ? it.createdAt.toISOString() : it.createdAt,
    updatedAt: it.updatedAt instanceof Date ? it.updatedAt.toISOString() : it.updatedAt,
  }));
}
