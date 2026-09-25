// SERVER-ONLY (driver). Five legs in parallel, each under the visibility
// filter of its own index page (research 2026-09-25, see the plan):
//   forum   → searchForum() unchanged (buildModerationFilter, comments under their parent)
//   events  → buildModerationFilter, no month window
//   listings→ buildListingsFilter(userId) = the browse grid (21-day freshness, own always)
//   news    → GET /api/news filter (approved or own pending/rejected, no window)
//   blog    → in memory over the content collection, drafts never
// A failing leg fails the request: „all or nothing" (user 2026-09-25).
import type { Db } from 'mongodb';
import { buildModerationFilter, mergeModerationFilter } from '../topicsQuery';
import { buildListingsFilter } from '../listingsQuery';
import { searchForum } from '../forum/searchStore';
import { buildSearchRegex, excerptAround } from '../forum/searchQuery';
import {
  SEARCH_PER_SECTION, eventHref, forumToHits, searchBlogEntries,
  type BlogSearchEntry, type SiteHit, type SiteSearchResult,
} from './siteSearch';

function toIso(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'number' || typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export async function searchEvents(db: Db, q: string, userId?: string): Promise<SiteHit[]> {
  const rx = buildSearchRegex(q);
  const filter: Record<string, any> = { $or: [{ title: rx }, { body: rx }, { location: rx }, { tags: rx }] };
  mergeModerationFilter(filter, buildModerationFilter(userId));
  const docs = await db.collection('events')
    .find(filter, { projection: { title: 1, body: 1, location: 1, startDate: 1, allDay: 1 } })
    .sort({ startDate: -1 }) // furthest ahead first, then the recent past — the calendar's own order reversed
    .limit(SEARCH_PER_SECTION)
    .toArray();
  return docs.map((d) => ({
    section: 'calendar', kind: 'event', id: String(d._id), href: eventHref(String(d._id), d.startDate),
    title: str(d.title), excerpt: excerptAround(d.body, q), date: toIso(d.startDate),
    sub: typeof d.location === 'string' && d.location.trim() ? d.location.trim() : null,
    allDay: d.allDay === true,
  }));
}

export async function searchListings(db: Db, q: string, userId?: string): Promise<SiteHit[]> {
  const rx = buildSearchRegex(q);
  const base = buildListingsFilter(userId ?? null) as { $and: Record<string, any>[] };
  const filter = { $and: [...base.$and, { $or: [{ title: rx }, { descriptionPlainText: rx }] }] };
  const docs = await db.collection('listings')
    .find(filter, { projection: { title: 1, descriptionPlainText: 1, price: 1, listingType: 1, updatedAt: 1, createdAt: 1 } })
    .sort({ updatedAt: -1 })
    .limit(SEARCH_PER_SECTION)
    .toArray();
  return docs.map((d) => {
    const kind = d.listingType === 'exchange' || d.listingType === 'gift' ? d.listingType : 'sell';
    return {
      section: 'marketplace', kind, id: String(d._id), href: `/marketplace/${String(d._id)}`,
      title: str(d.title), excerpt: excerptAround(d.descriptionPlainText, q), // old listings without the plain copy: '' (title still matches)
      date: toIso(d.updatedAt ?? d.createdAt), sub: null,
      price: kind === 'sell' && typeof d.price === 'number' ? d.price : null,
    };
  });
}

export async function searchNews(db: Db, q: string, userId?: string): Promise<SiteHit[]> {
  const rx = buildSearchRegex(q);
  const visible = {
    $or: [
      { moderationStatus: 'approved' },
      ...(userId ? [
        { submittedBy: userId, moderationStatus: 'pending' },
        { submittedBy: userId, moderationStatus: 'rejected' },
      ] : []),
    ],
  };
  const filter = { $and: [visible, { $or: [{ title: rx }, { description: rx }, { sourceName: rx }] }] };
  const docs = await db.collection('news')
    .find(filter, { projection: { title: 1, description: 1, sourceName: 1, publishedAt: 1 } })
    .sort({ publishedAt: -1 })
    .limit(SEARCH_PER_SECTION)
    .toArray();
  return docs.map((d) => ({
    section: 'news', kind: 'news', id: String(d._id), href: `/newsboard/${String(d._id)}`,
    title: str(d.title), excerpt: excerptAround(d.description, q), date: toIso(d.publishedAt),
    sub: str(d.sourceName) || null,
  }));
}

export async function searchSite(db: Db, q: string, userId: string | undefined, blog: BlogSearchEntry[]): Promise<SiteSearchResult> {
  const [forum, calendar, marketplace, news] = await Promise.all([
    searchForum(db, q, userId),
    searchEvents(db, q, userId),
    searchListings(db, q, userId),
    searchNews(db, q, userId),
  ]);
  return { q, hits: { forum: forumToHits(forum), calendar, marketplace, news, blog: searchBlogEntries(blog, q) } };
}
