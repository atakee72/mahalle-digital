/**
 * „New since your last visit" — pure rules shared by the server routes and the islands.
 * NO imports: this file ends up in client bundles (see root CLAUDE.md, „Server-only modules").
 *
 * A member's last visit of a section is stored as `users.lastVisit.<section>: Date`.
 * No stamp ⇒ nothing is „new" (the first visit only sets the baseline).
 * A member's own content never counts.
 */
export const VISIT_SECTIONS = ['forum', 'kalender', 'markt', 'blog'] as const;
export type VisitSection = (typeof VISIT_SECTIONS)[number];
export type SectionNews = Record<VisitSection, boolean>;
export const NO_NEWS: SectionNews = { forum: false, kalender: false, markt: false, blog: false };

/** How long one visit lasts for the card markers: a reload inside it keeps the same baseline. */
export const VISIT_SESSION_MS = 30 * 60 * 1000;

/** Milliseconds of a stored date in any of the shapes the collections use (number, Date, ISO string). */
export function toMs(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === 'string' && v !== '') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** Does a card get the „neu" marker? `since` = the baseline of this visit, `me` = the viewer's id. */
export function isNewItem(
  created: unknown,
  authorId: string | null | undefined,
  since: string | null | undefined,
  me: string | null | undefined,
): boolean {
  const sinceMs = toMs(since);
  const at = toMs(created);
  if (sinceMs === null || at === null) return false;
  if (me && authorId && authorId === me) return false;
  return at > sinceMs;
}

export interface Baseline {
  /** ISO time of the PREVIOUS visit, or null when there was none. */
  since: string | null;
  /** When this visit began (ms). */
  at: number;
  /** Id of the member this baseline belongs to (an account switch must not reuse it). */
  me: string;
}

/** Keep the baseline of a running visit; otherwise start a new visit from the server's previous stamp. */
export function pickBaseline(stored: Baseline | null, serverPrevious: string | null, nowMs: number, me: string): Baseline {
  if (stored && stored.me === me && Number.isFinite(stored.at) && nowMs >= stored.at && nowMs - stored.at < VISIT_SESSION_MS) {
    return stored;
  }
  return { since: serverPrevious, at: nowMs, me };
}

export function parseBaseline(raw: string | null): Baseline | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { since?: unknown; at?: unknown; me?: unknown };
    if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
    if (v.since !== null && (typeof v.since !== 'string' || toMs(v.since) === null)) return null;
    if (typeof v.me !== 'string' || v.me === '') return null;
    return { since: v.since as string | null, at: v.at, me: v.me };
  } catch {
    return null;
  }
}

// ── Query filters for the tab dots (public content only, never the member's own) ──────────

const PUBLIC_OR = [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }];

/** topics / announcements / recommendations: `date` is Date.now() at creation, `author` a user-id string. */
export function forumNewsFilter(sinceMs: number, me: string) {
  return { date: { $gt: sinceMs }, author: { $ne: me }, $or: PUBLIC_OR };
}

/** events: created since the visit and not over yet. */
export function eventNewsFilter(sinceMs: number, me: string, nowMs: number) {
  return { date: { $gt: sinceMs }, author: { $ne: me }, endDate: { $gte: new Date(nowMs) }, $or: PUBLIC_OR };
}

/** listings: published since the visit and still on offer. */
export function listingNewsFilter(sinceMs: number, me: string) {
  return {
    createdAt: { $gt: new Date(sinceMs) },
    sellerId: { $ne: me },
    status: { $in: ['available', 'reserved'] },
    $or: PUBLIC_OR,
  };
}

/** blog: any published post dated after the visit (and not in the future). */
export function blogHasNews(pubDates: unknown[], sinceMs: number, nowMs: number): boolean {
  return pubDates.some((d) => {
    const t = toMs(d);
    return t !== null && t > sinceMs && t <= nowMs;
  });
}
