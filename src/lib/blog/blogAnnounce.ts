// The once-only step of blog notifications. Takes the Db as a parameter (no connectDB, no
// astro:content) so it runs against a fake in the unit test.
// Collection `blogAnnouncements`: { _id: <post slug>, announcedAt: Date } — the _id index IS the
// uniqueness guard, no extra index needed. A slug is claimed BEFORE anything is sent: two requests
// that see the same new post race on the insert, the loser gets a duplicate key and stays silent.
// At-most-once on purpose — a send that fails after the claim is not retried.
import type { Db } from 'mongodb';
import { pickUnannounced, type BlogPostRef } from './blogNotifyRules';

export const BLOG_ANNOUNCEMENTS_COLLECTION = 'blogAnnouncements';

interface AnnouncementDoc {
  _id: string;
  announcedAt: Date;
}

/** Returns the posts THIS call claimed. Throws on any error that is not a duplicate key. */
export async function claimNewBlogPosts(db: Db, posts: BlogPostRef[], now: Date): Promise<BlogPostRef[]> {
  const col = db.collection<AnnouncementDoc>(BLOG_ANNOUNCEMENTS_COLLECTION);
  const announced = new Set((await col.find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id));
  const fresh = pickUnannounced(posts, announced);
  const claimed: BlogPostRef[] = [];
  for (const p of fresh) {
    try {
      await col.insertOne({ _id: p.id, announcedAt: now });
      claimed.push(p);
    } catch (err) {
      if ((err as { code?: number })?.code !== 11000) throw err;
    }
  }
  return claimed;
}
