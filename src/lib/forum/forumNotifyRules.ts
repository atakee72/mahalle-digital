/**
 * Forum notifications — pure rules (no imports besides types; shared with the panel island).
 *
 * One preference per member, `users.forumNotify`:
 *   absent  → 'digest'  one notification each morning when the forum has new posts
 *   'each'  → one notification per new public post
 *   'off'   → none
 * A member's own posts never count. Official announcements are left out (they have their
 * own „official" notification), posts with a warning label too.
 */
import type { NotificationMeta, NotificationTarget } from '../../types/notification';

export const FORUM_NOTIFY_MODES = ['digest', 'each', 'off'] as const;
export type ForumNotifyMode = (typeof FORUM_NOTIFY_MODES)[number];

export function storedForumNotify(v: unknown): ForumNotifyMode {
  return v === 'each' || v === 'off' ? v : 'digest';
}

export type ForumPostKind = 'topic' | 'announcement' | 'recommendation';

export const FORUM_KIND_COLLECTION: Record<ForumPostKind, string> = {
  topic: 'topics',
  announcement: 'announcements',
  recommendation: 'recommendations',
};

export interface ForumPostRef {
  id: string;
  kind: ForumPostKind;
  title: string;
  authorId: string;
  dateMs: number;
}

export interface DigestMember {
  id: string;
  /** the member's last visit of the forum index (ms), or null */
  forumVisitMs: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A missed morning is caught up, but never further back than two days. */
export const DIGEST_MAX_LOOKBACK_MS = 2 * DAY_MS;
/** „Every post" is for fresh posts: a post approved (again) later than this stays silent. */
export const EACH_MAX_AGE_MS = 7 * DAY_MS;

/** Start of the digest window: where the previous digest ended, else 24 h back; capped at two days. */
export function digestWindowStart(previousUntilMs: number | null, nowMs: number): number {
  const floor = nowMs - DIGEST_MAX_LOOKBACK_MS;
  if (previousUntilMs === null || !Number.isFinite(previousUntilMs) || previousUntilMs > nowMs) return nowMs - DAY_MS;
  return Math.max(previousUntilMs, floor);
}

/** The Europe/Berlin calendar day — the once-a-day key of the digest. */
export function berlinDay(nowMs: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(nowMs));
}

export function newestFirst(posts: ForumPostRef[]): ForumPostRef[] {
  return [...posts].sort((a, b) => b.dateMs - a.dateMs || a.id.localeCompare(b.id));
}

/** The posts one member is told about: not their own, and newer than their last forum visit. */
export function digestPostsFor(member: DigestMember, posts: ForumPostRef[], windowStartMs: number): ForumPostRef[] {
  const from = Math.max(windowStartMs, member.forumVisitMs ?? -Infinity);
  return posts.filter((p) => p.authorId !== member.id && p.dateMs > from);
}

/** One post → a row that opens the post; several → one row with a count that opens the forum. */
export function forumNotification(posts: ForumPostRef[]): { target: NotificationTarget; meta?: NotificationMeta } | null {
  if (!posts.length) return null;
  const first = posts[0];
  if (posts.length === 1) {
    return {
      target: {
        contentType: first.kind, contentId: first.id, title: first.title,
        href: `/${FORUM_KIND_COLLECTION[first.kind]}/${first.id}`,
      },
    };
  }
  return {
    target: { contentType: 'forum', contentId: first.id, title: first.title, href: '/forum' },
    meta: { count: posts.length },
  };
}

export interface DigestGroup {
  userIds: string[];
  target: NotificationTarget;
  meta?: NotificationMeta;
}

/** Members who are told the same thing share one group (one insertMany, one push payload). */
export function planDigest(members: DigestMember[], posts: ForumPostRef[], windowStartMs: number): DigestGroup[] {
  const sorted = newestFirst(posts);
  const groups = new Map<string, DigestGroup>();
  for (const m of members) {
    const mine = digestPostsFor(m, sorted, windowStartMs);
    const n = forumNotification(mine);
    if (!n) continue;
    const key = mine.map((p) => p.id).join(',');
    const g = groups.get(key);
    if (g) g.userIds.push(m.id);
    else groups.set(key, { userIds: [m.id], ...n });
  }
  return [...groups.values()];
}
