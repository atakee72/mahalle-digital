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
import { blogNotification, type BlogPostRef } from './blogNotifyRules';

const RECHECK_MS = 60_000;
let lastCheck = 0;

export async function announceNewBlogPosts(): Promise<void> {
  const nowMs = Date.now();
  if (nowMs - lastCheck < RECHECK_MS) return;
  lastCheck = nowMs;
  try {
    const entries = await getCollection('blog', ({ data }) => !data.draft);
    const posts: BlogPostRef[] = entries
      .map((e) => ({ id: e.id, title: e.data.title, pubDateISO: e.data.pubDate.toISOString() }))
      .sort((a, b) => b.pubDateISO.localeCompare(a.pubDateISO) || a.id.localeCompare(b.id));
    const db = await connectDB();
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
