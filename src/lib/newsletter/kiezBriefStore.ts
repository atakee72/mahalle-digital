/**
 * Kiez-Brief — database side. Takes a Db, imports no env and no Astro module (tests use an
 * in-memory double, the dev dry-run script the real dev db). Sending lives in kiezBrief.ts.
 */
import { ObjectId, type Db } from 'mongodb';
import { PUBLIC_AUTHOR_PROJECTION } from '../publicAuthor';
import { getAirHistory } from '../kiez/airLog';
import {
  windowFor, arrangeData, excerptOf, thumb, storedMailLocale, isIssueWeekKey, type MailLocale,
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

export interface LoadOptions {
  /** Our Cloudinary cloud name; without it no thumbnail passes. */
  cloud?: string | null;
  /** false = no air line (the browser view of a past issue: „today's" reading would be the wrong day). */
  air?: boolean;
}

export async function loadIssueData(db: Db, week: string, nowMs: number, blog: BlogInput[], opts: LoadOptions = {}): Promise<BriefData> {
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
    opts.air === false ? null : getAirHistory(db, new Date(nowMs)).catch(() => null),
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
    image: thumb(Array.isArray(doc.images) ? doc.images[0]?.url : null, 160, opts.cloud),
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
    image: thumb(Array.isArray(l.images) ? l.images[0] : null, 160, opts.cloud),
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

/** A SENT issue by its week key; null for a malformed key and for unknown, skipped or never-sent weeks. */
export async function findSentIssue(db: Db, week: unknown): Promise<IssueDoc | null> {
  if (!isIssueWeekKey(week)) return null;
  const doc = await db.collection<IssueDoc>(KIEZ_BRIEF_COLLECTION).findOne({ _id: week, sentAt: { $type: 'date' } });
  return doc && doc.windowTo instanceof Date ? doc : null;
}

/**
 * A sent issue for the browser view, rebuilt from TODAY's data for the window stored at its claim.
 * Deliberately no snapshot of the mail: a post deleted since is gone here too, a member who left
 * reads „Ehemaliges Mitglied", a sold listing is out. No air line (see LoadOptions.air).
 */
export async function loadSentIssue(db: Db, doc: IssueDoc, blog: BlogInput[], opts: LoadOptions = {}): Promise<BriefData> {
  return loadIssueData(db, doc._id, doc.windowTo.getTime(), blog, { ...opts, air: false });
}

export interface IssueListItem { week: string; sentAtMs: number }

/** The sent issues, newest first — the list page. Skipped (quiet, quota) and failed weeks have no `sentAt`. */
export async function listSentIssues(db: Db, limit = 60): Promise<IssueListItem[]> {
  const docs = await db.collection<IssueDoc>(KIEZ_BRIEF_COLLECTION)
    .find({ sentAt: { $type: 'date' } }, { projection: { sentAt: 1 } })
    .sort({ sentAt: -1 })
    .limit(limit)
    .toArray();
  return docs
    .filter((d) => isIssueWeekKey(d._id) && d.sentAt instanceof Date)
    .map((d) => ({ week: d._id, sentAtMs: (d.sentAt as Date).getTime() }));
}

export interface Recipient { id: string; email: string; name: string | null; locale: MailLocale }

/** Verified, reachable members who did not turn the mail off. One query, allowlist projection. */
export async function loadRecipients(db: Db): Promise<Recipient[]> {
  const users = await db.collection('users')
    .find({ emailVerified: true, anonymized: { $ne: true }, isBanned: { $ne: true }, newsletter: { $ne: 'off' }, deletionScheduledAt: { $exists: false }, email: { $type: 'string' } },
      { projection: { _id: 1, email: 1, name: 1, locale: 1 } })
    .toArray();
  return users.map((u) => ({ id: String(u._id), email: String(u.email), name: typeof u.name === 'string' ? u.name : null, locale: storedMailLocale(u.locale) }));
}
