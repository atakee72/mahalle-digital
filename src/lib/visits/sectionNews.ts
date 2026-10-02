/**
 * Tab dots: is there public content of OTHER members in a section that is younger than the
 * member's last visit of it? SERVER-ONLY (takes a Db). One cheap existence query per collection,
 * all in parallel; a section the member never opened has no dot.
 */
import type { Db } from 'mongodb';
import {
  NO_NEWS, toMs, forumNewsFilter, eventNewsFilter, listingNewsFilter, blogHasNews,
  type SectionNews, type VisitSection,
} from './visitRules';

export type LastVisit = Partial<Record<VisitSection, unknown>>;

const ID_ONLY = { projection: { _id: 1 } } as const;

export async function getSectionNews(
  db: Db,
  userId: string,
  lastVisit: LastVisit | null | undefined,
  blogPubDates: unknown[],
  nowMs: number,
): Promise<SectionNews> {
  const since = (s: VisitSection) => toMs(lastVisit?.[s]);
  const forum = since('forum');
  const kalender = since('kalender');
  const markt = since('markt');
  const blog = since('blog');

  const exists = async (collection: string, filter: Record<string, unknown>) =>
    (await db.collection(collection).findOne(filter, ID_ONLY)) !== null;

  const [topics, announcements, recommendations, events, listings] = await Promise.all([
    forum === null ? false : exists('topics', forumNewsFilter(forum, userId)),
    forum === null ? false : exists('announcements', forumNewsFilter(forum, userId)),
    forum === null ? false : exists('recommendations', forumNewsFilter(forum, userId)),
    kalender === null ? false : exists('events', eventNewsFilter(kalender, userId, nowMs)),
    markt === null ? false : exists('listings', listingNewsFilter(markt, userId)),
  ]);

  return {
    ...NO_NEWS,
    forum: topics || announcements || recommendations,
    kalender: events,
    markt: listings,
    blog: blog === null ? false : blogHasNews(blogPubDates, blog, nowMs),
  };
}
