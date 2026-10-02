// SERVER-ONLY (astro:content + mongodb). Announces new blog posts to members.
// Posts are repo MDX files — nothing „publishes" them inside the app — so the app looks for
// itself: called from the blog index, the blog detail page and the daily news cron. Cheap when
// nothing is new (one small read, skipped entirely for a minute per instance after a check).
// NEVER THROWS: a failure here must not break a page render or the cron.
import * as Sentry from '@sentry/astro';
import { getCollection } from 'astro:content';
import { connectDB } from '../mongodb';
import { notifyMembersExceptAdmins } from '../notifications';
import { claimNewBlogPosts } from './blogAnnounce';
import { blogNotification, newestFirst, type BlogPostRef } from './blogNotifyRules';

const RECHECK_MS = 60_000;
// The blog pages call this inside the request. With the database up a connect takes well under a
// second; during an outage it would hold a visitor's page for ~20 s (two server-selection attempts).
// So the CONNECT gets a budget — nothing has been claimed yet at that point, the next check (a
// minute later, or the daily cron) simply tries again. Once connected, claim + send run to the end:
// cutting those short could mark a post announced without anyone having been told.
const CONNECT_BUDGET_MS = 2500;
const TIMED_OUT = Symbol('timed out');
let lastCheck = 0;

export async function announceNewBlogPosts(): Promise<void> {
  const nowMs = Date.now();
  if (nowMs - lastCheck < RECHECK_MS) return;
  lastCheck = nowMs;
  try {
    const entries = await getCollection('blog', ({ data }) => !data.draft);
    const posts: BlogPostRef[] = newestFirst(
      entries.map((e) => ({ id: e.id, title: e.data.title, pubDateISO: e.data.pubDate.toISOString() })),
    );
    const connecting = connectDB();
    connecting.catch(() => {}); // a late rejection after the budget must not be unhandled
    const db = await Promise.race([
      connecting,
      new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), CONNECT_BUDGET_MS)),
    ]);
    if (db === TIMED_OUT) return;
    const claimed = await claimNewBlogPosts(db, posts, new Date(nowMs));
    const notification = blogNotification(claimed);
    if (!notification) return;
    await notifyMembersExceptAdmins({ type: 'blog', ...notification });
  } catch (err) {
    console.error('[blog-notify] failed:', err);
    try {
      Sentry.captureException(err);
      await Sentry.flush(2000);
    } catch {
      /* best-effort */
    }
  }
}
