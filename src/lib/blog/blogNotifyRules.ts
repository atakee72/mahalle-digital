// DEPENDENCY-PURE (types only): which blog posts get announced to members, and what the
// notification says. Posts are repo files, so the app detects a new one itself — see
// blogAnnounce.ts (the claim) and blogNotify.ts (the entry point).
import type { NotificationMeta, NotificationTarget } from '../../types/notification';

/** Owner decision 2026-10-02: posts dated before this never notify (the eleven older posts stay silent).
 *  It is 2 October 2026, 00:00 in BERLIN (22:00 UTC the evening before): a date-only frontmatter
 *  date parses as UTC midnight and qualifies, and so does a post stamped 00:30+02:00 that day. */
export const BLOG_NOTIFY_FROM_ISO = '2026-10-01T22:00:00.000Z';

export interface BlogPostRef {
  id: string; // the slug, as in /blog/<id>
  title: string;
  pubDateISO: string;
}

/** Published posts dated on/after the start date whose slug is not announced yet. Order is kept. */
export function pickUnannounced(posts: BlogPostRef[], announced: ReadonlySet<string>): BlogPostRef[] {
  const from = Date.parse(BLOG_NOTIFY_FROM_ISO);
  return posts.filter((p) => {
    const t = Date.parse(p.pubDateISO);
    return Number.isFinite(t) && t >= from && !announced.has(p.id);
  });
}

/** Newest first, slug as the tiebreak — decides which post a folded notification is named after. */
export function newestFirst(posts: BlogPostRef[]): BlogPostRef[] {
  return [...posts].sort((a, b) => Date.parse(b.pubDateISO) - Date.parse(a.pubDateISO) || a.id.localeCompare(b.id));
}

/** One notification for one or several new posts; null when there is nothing to announce. */
export function blogNotification(
  posts: BlogPostRef[],
): { target: NotificationTarget; meta?: NotificationMeta } | null {
  if (!posts.length) return null;
  const first = posts[0];
  if (posts.length === 1) {
    return { target: { contentType: 'blog', contentId: first.id, title: first.title, href: `/blog/${first.id}` } };
  }
  return {
    target: { contentType: 'blog', contentId: first.id, title: first.title, href: '/blog' },
    meta: { count: posts.length },
  };
}
