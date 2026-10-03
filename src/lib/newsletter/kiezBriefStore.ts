/**
 * Kiez-Brief — database side. Takes a Db, imports no env and no Astro module (tests use an
 * in-memory double, the dev dry-run script the real dev db). Sending lives in kiezBrief.ts.
 */
import { ObjectId, type Db } from 'mongodb';
import { PUBLIC_AUTHOR_PROJECTION } from '../publicAuthor';
import { getAirHistory } from '../kiez/airLog';
import {
  windowFor, arrangeData, excerptOf, thumb,
  type BriefData, type BriefPost, type BriefPostKind, type BriefEvent, type BriefListing, type BriefBlogPost,
} from './kiezBriefRules';

export const KIEZ_BRIEF_COLLECTION = 'kiezBriefIssues';

export interface IssueDoc {
  _id: string; // issue week, e.g. '2026-W41'
  windowFrom: Date;
  windowTo: Date;
  claimedAt: Date;
  fallback: boolean;
  recipients?: number;
  skipped?: 'quiet' | 'quota';
  sentAt?: Date;
}

/** Claim the issue BEFORE anything is rendered or sent; false = already claimed (at-most-once). */
export async function claimIssue(db: Db, week: string, nowMs: number, fallback: boolean): Promise<boolean> {
  const w = windowFor(nowMs);
  try {
    await db.collection<IssueDoc>(KIEZ_BRIEF_COLLECTION).insertOne({
      _id: week, windowFrom: new Date(w.fromMs), windowTo: new Date(w.toMs), claimedAt: new Date(nowMs), fallback,
    });
    return true;
  } catch (err) {
    if ((err as { code?: number })?.code === 11000) return false;
    throw err;
  }
}

export async function markIssue(db: Db, week: string, patch: Partial<Pick<IssueDoc, 'recipients' | 'skipped' | 'sentAt'>>): Promise<void> {
  await db.collection<IssueDoc>(KIEZ_BRIEF_COLLECTION).updateOne({ _id: week }, { $set: patch });
}

const PUBLIC = { $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }], hasWarningLabel: { $ne: true } };
const POST_COLLECTIONS: Record<BriefPostKind, string> = { topic: 'topics', announcement: 'announcements', recommendation: 'recommendations' };

const toMs = (v: unknown): number => {
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** Blog posts come from the Astro content collection — the caller passes them in (no astro:content here). */
export interface BlogInput { slug: string; title: string; description: string; pubDate: unknown; draft?: boolean; cover?: string | null }

export async function loadIssueData(db: Db, week: string, nowMs: number, blog: BlogInput[]): Promise<BriefData> {
  const w = windowFor(nowMs);
  const kinds = Object.keys(POST_COLLECTIONS) as BriefPostKind[];
  const [postLists, eventDocs, listingDocs, air] = await Promise.all([
    Promise.all(kinds.map(async (kind) => {
      const docs = await db.collection(POST_COLLECTIONS[kind])
        .find({ ...PUBLIC, date: { $gt: w.fromMs, $lte: w.toMs }, isOfficial: { $ne: true } },
          { projection: { title: 1, author: 1, comments: 1, date: 1, body: 1, images: 1 } })
        .toArray();
      return docs.map((d) => ({ kind, doc: d }));
    })),
    db.collection('events')
      .find({ ...PUBLIC, startDate: { $gte: new Date(w.toMs), $lt: new Date(w.aheadMs) }, visibility: { $ne: 'private' } },
        { projection: { title: 1, startDate: 1, allDay: 1, location: 1 } })
      .toArray(),
    db.collection('listings')
      .find({ ...PUBLIC, createdAt: { $gt: new Date(w.fromMs), $lte: new Date(w.toMs) }, status: { $in: ['available', 'reserved'] } },
        { projection: { title: 1, listingType: 1, price: 1, createdAt: 1, images: 1 } })
      .toArray(),
    getAirHistory(db, new Date(nowMs)).catch(() => null),
  ]);

  // Author names: one join through the public allowlist (tombstone-safe), never a stored name.
  const flat = postLists.flat();
  const authorIds = [...new Set(flat.map((p) => String(p.doc.author ?? '')).filter((id) => /^[a-f0-9]{24}$/.test(id)))];
  const users = authorIds.length
    ? await db.collection('users').find({ _id: { $in: authorIds.map((id) => new ObjectId(id)) } }, { projection: PUBLIC_AUTHOR_PROJECTION }).toArray()
    : [];
  const nameOf = new Map(users.map((u) => [String(u._id), typeof u.name === 'string' ? u.name : null]));

  const posts: BriefPost[] = flat.map(({ kind, doc }) => ({
    id: String(doc._id), kind, title: String(doc.title ?? ''),
    author: nameOf.get(String(doc.author ?? '')) ?? null,
    comments: Array.isArray(doc.comments) ? doc.comments.length : 0,
    dateMs: toMs(doc.date),
    excerpt: excerptOf(doc.body),
    image: thumb(Array.isArray(doc.images) ? doc.images[0]?.url : null, 160),
  }));
  const events: BriefEvent[] = eventDocs.map((e) => ({
    id: String(e._id), title: String(e.title ?? ''), startMs: toMs(e.startDate), allDay: e.allDay === true,
    location: typeof e.location === 'string' && e.location.trim() ? e.location.trim() : null,
  }));
  const listings: BriefListing[] = listingDocs.map((l) => ({
    id: String(l._id), title: String(l.title ?? ''),
    kind: l.listingType === 'exchange' || l.listingType === 'gift' ? l.listingType : 'sell',
    price: l.listingType === 'sell' && typeof l.price === 'number' ? l.price : null,
    createdMs: toMs(l.createdAt),
    image: thumb(Array.isArray(l.images) ? l.images[0] : null, 160),
  }));
  const blogPosts: BriefBlogPost[] = blog
    .filter((b) => !b.draft)
    .map((b) => ({ slug: b.slug, title: b.title, description: b.description, pubMs: toMs(b.pubDate), cover: typeof b.cover === 'string' && b.cover ? b.cover : null }))
    .filter((b) => b.pubMs > w.fromMs && b.pubMs <= w.toMs);

  return arrangeData({
    week, posts, events, listings, blog: blogPosts,
    air: air?.lastReading ? { lqi: air.lastReading.lqi } : null,
  });
}

export interface Recipient { id: string; email: string; name: string | null }

/** Verified, reachable members who did not turn the mail off. One query, allowlist projection. */
export async function loadRecipients(db: Db): Promise<Recipient[]> {
  const users = await db.collection('users')
    .find({ emailVerified: true, anonymized: { $ne: true }, isBanned: { $ne: true }, newsletter: { $ne: 'off' }, deletionScheduledAt: { $exists: false }, email: { $type: 'string' } },
      { projection: { _id: 1, email: 1, name: 1 } })
    .toArray();
  return users.map((u) => ({ id: String(u._id), email: String(u.email), name: typeof u.name === 'string' ? u.name : null }));
}
