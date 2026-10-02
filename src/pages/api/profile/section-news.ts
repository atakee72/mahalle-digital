import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { getCollection } from 'astro:content';
import { ObjectId } from 'mongodb';
import * as Sentry from '@sentry/astro';
import { connectDB } from '../../../lib/mongodb';
import { getSectionNews } from '../../../lib/visits/sectionNews';
import { NO_NEWS } from '../../../lib/visits/visitRules';

// Tab dots for the nav: which sections hold something newer than the member's
// last visit. A failure answers „nothing new" — a dot is never worth an error.
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id || !ObjectId.isValid(session.user.id)) return json({ error: 'Unauthorized' }, 401);
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(session.user.id) },
      { projection: { lastVisit: 1 } },
    );
    const posts = await getCollection('blog', ({ data }) => !data.draft);
    const news = await getSectionNews(
      db, session.user.id, user?.lastVisit, posts.map((p) => p.data.pubDate), Date.now(),
    );
    return json(news);
  } catch (err) {
    console.error('[section-news] failed:', err);
    Sentry.captureException(err);
    await Sentry.flush(2000);
    return json(NO_NEWS);
  }
};
