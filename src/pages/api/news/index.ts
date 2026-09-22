import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../../lib/mongodb';
import { ObjectId } from 'mongodb';
import type { NewsItem } from '../../../types';
import { NewsQuerySchema } from '../../../schemas/news.schema';

export const GET: APIRoute = async ({ url, request }) => {
  try {
    const session = await getSession(request);
    const currentUserId = session?.user?.id;

    const db = await connectDB();
    const newsCollection = db.collection<NewsItem>('news');

    // Parse query parameters
    const params = Object.fromEntries(url.searchParams);
    const validation = NewsQuerySchema.safeParse(params);

    if (!validation.success) {
      return new Response(JSON.stringify({ error: 'Invalid query parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { limit, offset, sortBy, sortOrder, source, search, dateFrom, dateTo } = validation.data;

    // Build filter: only show approved news (+ user's own pending submissions)
    const filter: Record<string, any> = {
      $or: [
        { moderationStatus: 'approved' },
        ...(currentUserId ? [
          { submittedBy: currentUserId, moderationStatus: 'pending' },
          { submittedBy: currentUserId, moderationStatus: 'rejected' }
        ] : [])
      ]
    };

    if (source) filter.source = source;

    if (dateFrom || dateTo) {
      filter.publishedAt = {};
      if (dateFrom) filter.publishedAt.$gte = new Date(dateFrom);
      if (dateTo) filter.publishedAt.$lt = new Date(dateTo);
    }

    if (search) {
      filter.$and = [
        { $or: filter.$or },
        {
          $or: [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
            { sourceName: { $regex: search, $options: 'i' } }
          ]
        }
      ];
      delete filter.$or;
    }

    // Fetch news
    const [items, total] = await Promise.all([
      newsCollection
        .find(filter)
        // Day (fetchDate) first, then the article's real publish time; the GPT
        // score is only a tiebreak since 2026-09-22 — before, every item of one
        // cron run tied on fetchDate and the score alone ordered the day, so a
        // 4-day-old score-90 item outranked a 4-hour-old score-85 one. The
        // „user-submitted first" rule (source: -1) went with it.
        .sort({ fetchDate: -1, publishedAt: -1, aiRelevanceScore: -1, [sortBy]: sortOrder === 'asc' ? 1 : -1, _id: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      newsCollection.countDocuments(filter)
    ]);

    // The combined sort leads with `fetchDate: -1`, but user-submitted pending/
    // rejected items have NO fetchDate (it's only set at admin approval). So a
    // missing fetchDate sorts last, sinking the author's own submissions below
    // the page limit — they'd never reach the feed where the status strap renders.
    // The $or above already INTENDS to show the author their own pending/rejected;
    // surface them explicitly at the top of page 1 (no date window) so the intent
    // actually holds. Tiny set (≤5/day), so an extra query + prepend is cheap.
    let ownPending: NewsItem[] = [];
    if (currentUserId && offset === 0) {
      ownPending = await newsCollection
        .find({ submittedBy: currentUserId, moderationStatus: { $in: ['pending', 'rejected'] } })
        .sort({ createdAt: -1 })
        .toArray();
    }
    const ownIds = new Set(ownPending.map((i) => String(i._id)));
    const mergedItems = [...ownPending, ...items.filter((i) => !ownIds.has(String(i._id)))];

    // Populate submitter info for user-submitted news
    const usersCollection = db.collection('users');
    const populatedItems = await Promise.all(
      mergedItems.map(async (item) => {
        if (item.source === 'user_submitted' && item.submittedBy && typeof item.submittedBy === 'string') {
          try {
            const submitter = await usersCollection.findOne(
              { _id: new ObjectId(item.submittedBy) },
              { projection: { name: 1 } } // the feed shows the submitter's NAME only — never the full user doc
            );
            return { ...item, submittedBy: submitter ? { _id: String(submitter._id), name: submitter.name ?? null } : item.submittedBy };
          } catch {
            return item;
          }
        }
        return item;
      })
    );

    return new Response(
      JSON.stringify({
        news: populatedItems,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + items.length < total
        }
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      }
    );
  } catch (error) {
    console.error('Error fetching news:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch news' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
