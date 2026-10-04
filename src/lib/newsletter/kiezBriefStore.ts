/**
 * Kiez-Brief — database side. Takes a Db, imports no env and no Astro module (tests use an
 * in-memory double, the dev dry-run script the real dev db). Sending lives in kiezBrief.ts.
 */
import { ObjectId, type Db } from 'mongodb';
import { PUBLIC_AUTHOR_PROJECTION } from '../publicAuthor';
import { getAirHistory } from '../kiez/airLog';
import {
  windowFor, arrangeData, excerptOf, thumb, storedMailLocale, isIssueWeekKey, groupDue, GROUP_SIZE, PENDING_MAX_AGE_MS, type MailLocale,
  type BriefData, type BriefPost, type BriefPostKind, type BriefEvent, type BriefListing, type BriefBlogPost, type BriefOfficial,
} from './kiezBriefRules';

export const KIEZ_BRIEF_COLLECTION = 'kiezBriefIssues';

export interface IssueDoc {
  _id: string; // issue week, e.g. '2026-W41'
  windowFrom: Date;
  windowTo: Date;
  claimedAt: Date;
  fallback: boolean;
  /** Mails sent so far, all groups together. */
  recipients?: number;
  /** 'quota' only on rows older than the groups (2026-10-04): then a too-large issue was not sent at all. */
  skipped?: 'quiet' | 'quota';
  /** When the FIRST group went out — from then on the issue has a browser page. */
  sentAt?: Date;
  /** Groups claimed so far (0 right after the claim). Absent on rows older than the groups. */
  groups?: number;
  /** The id of the last member of the last claimed group; the next group starts after it. */
  cursor?: string | null;
  /** true while members are still waiting for their group. */
  more?: boolean;
  /** When the last group was claimed — the next one is due on a later UTC day. */
  lastGroupAt?: Date;
}

/** Claim the issue BEFORE anything is rendered or sent; false = already claimed (at-most-once). */
export async function claimIssue(db: Db, week: string, nowMs: number, fallback: boolean): Promise<boolean> {
  const w = windowFor(nowMs);
  try {
    await db.collection<IssueDoc>(KIEZ_BRIEF_COLLECTION).insertOne({
      _id: week, windowFrom: new Date(w.fromMs), windowTo: new Date(w.toMs), claimedAt: new Date(nowMs), fallback,
      groups: 0, cursor: null, more: false,
    });
    return true;
  } catch (err) {
    if ((err as { code?: number })?.code === 11000) return false;
    throw err;
  }
}

export async function markIssue(db: Db, week: string, patch: Partial<Pick<IssueDoc, 'recipients' | 'skipped' | 'sentAt' | 'more'>>): Promise<void> {
  await db.collection<IssueDoc>(KIEZ_BRIEF_COLLECTION).updateOne({ _id: week }, { $set: patch });
}

const PUBLIC = { $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }], hasWarningLabel: { $ne: true } };
const POST_COLLECTIONS: Record<BriefPostKind, string> = { topic: 'topics', announcement: 'announcements', recommendation: 'recommendations' };

/** News carries its day as a UTC 'YYYY-MM-DD' string (`fetchDate`). */
const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

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
  const [postLists, eventDocs, listingDocs, air, officialDocs, newsCount] = await Promise.all([
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
    // „Neu bei Mahalle": the team's own announcements of the week (kept OUT of the forum section above).
    db.collection('announcements')
      .find({ ...PUBLIC, date: { $gt: w.fromMs, $lte: w.toMs }, isOfficial: true },
        { projection: { title: 1, date: 1, body: 1 } })
      .toArray(),
    // The Kurier teaser needs one number: approved articles of the last seven days. Garnish — a
    // failing count drops the line, never the issue.
    db.collection('news')
      .countDocuments({ moderationStatus: 'approved', fetchDate: { $gt: dayKey(w.fromMs), $lte: dayKey(w.toMs) } })
      .catch(() => 0),
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

  const official: BriefOfficial[] = officialDocs.map((o) => ({
    id: String(o._id), title: String(o.title ?? ''), excerpt: excerptOf(o.body, 100), dateMs: toMs(o.date),
  }));

  return arrangeData({
    week, posts, events, listings, blog: blogPosts, official, newsCount,
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

/** `verified` = the member confirmed the address; an unconfirmed one gets the mail WITH the „confirm it" note. */
export interface Recipient { id: string; email: string; name: string | null; locale: MailLocale; verified: boolean }

/** Who gets the mail: every reachable member who did not turn it off — confirmed address or not (owner, 2026-10-04). */
const RECIPIENT_FILTER = { anonymized: { $ne: true }, isBanned: { $ne: true }, newsletter: { $ne: 'off' }, deletionScheduledAt: { $exists: false }, email: { $type: 'string' } };

/**
 * Recipients in a STABLE order (by id = by joining date, oldest first). `afterId` + `limit` cut one
 * group out of that order: a member who joins later sorts behind everyone and lands in a later
 * group, one who unsubscribes simply drops out — nobody is skipped, nobody gets the issue twice.
 */
export async function loadRecipients(db: Db, opts: { afterId?: string | null; limit?: number } = {}): Promise<Recipient[]> {
  const after = typeof opts.afterId === 'string' && ObjectId.isValid(opts.afterId) ? { _id: { $gt: new ObjectId(opts.afterId) } } : {};
  let cursor = db.collection('users')
    .find({ ...RECIPIENT_FILTER, ...after }, { projection: { _id: 1, email: 1, name: 1, locale: 1, emailVerified: 1 } })
    .sort({ _id: 1 });
  if (typeof opts.limit === 'number') cursor = cursor.limit(opts.limit);
  const users = await cursor.toArray();
  return users.map((u) => ({
    id: String(u._id), email: String(u.email), name: typeof u.name === 'string' ? u.name : null,
    locale: storedMailLocale(u.locale), verified: u.emailVerified === true,
  }));
}

export async function countRecipients(db: Db): Promise<number> {
  return db.collection('users').countDocuments(RECIPIENT_FILTER);
}

/** The newest issue with members still waiting for their group; null when there is none (or it is too old to be news). */
export async function findPendingIssue(db: Db, nowMs: number): Promise<IssueDoc | null> {
  const docs = await db.collection<IssueDoc>(KIEZ_BRIEF_COLLECTION)
    .find({ more: true, claimedAt: { $gte: new Date(nowMs - PENDING_MAX_AGE_MS) } })
    .sort({ claimedAt: -1 })
    .limit(1)
    .toArray();
  const doc = docs[0];
  return doc && doc.more === true && doc.skipped === undefined && doc.windowTo instanceof Date ? doc : null;
}

export interface GroupTake { index: number; recipients: Recipient[]; more: boolean }

/**
 * Take the next group of an issue: load the members after the stored cursor, then CLAIM the group
 * with one conditional update (the row must still show the group count we read) BEFORE anything
 * is sent — two runs can never send the same group, and a failed send is not retried.
 * null = nothing to take: not due yet (one group per UTC day), or another run took it.
 * An empty group is claimed too (it closes the issue: `more: false`).
 */
export async function takeNextGroup(db: Db, issue: Pick<IssueDoc, '_id' | 'groups' | 'cursor' | 'lastGroupAt'>, nowMs: number, size = GROUP_SIZE): Promise<GroupTake | null> {
  const index = typeof issue.groups === 'number' ? issue.groups : 0;
  if (index > 0 && !groupDue(issue.lastGroupAt instanceof Date ? issue.lastGroupAt.getTime() : null, nowMs)) return null;
  const batch = await loadRecipients(db, { afterId: issue.cursor ?? null, limit: size + 1 });
  const recipients = batch.slice(0, size);
  const more = batch.length > size;
  const res = await db.collection<IssueDoc>(KIEZ_BRIEF_COLLECTION).updateOne(
    { _id: issue._id, groups: index },
    { $set: { groups: index + 1, cursor: recipients.length ? recipients[recipients.length - 1].id : issue.cursor ?? null, more, lastGroupAt: new Date(nowMs) } },
  );
  return res.modifiedCount === 1 ? { index, recipients, more } : null;
}
