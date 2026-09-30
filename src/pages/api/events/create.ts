import type { APIRoute } from 'astro';
import { connectDB } from '../../../lib/mongodb';
import { PUBLIC_AUTHOR_PROJECTION, toPublicAuthor } from '../../../lib/publicAuthor';
import { ObjectId } from 'mongodb';
import type { Event, FlaggedContent } from '../../../types';
import { EventCreateSchema } from '../../../schemas/forum.schema';
import { parseRequestBody } from '../../../schemas/validation.utils';
import { moderateText, checkSpamWithGPT, createFlaggedContentRecord, mergeModerationResults } from '../../../lib/moderation';
import { requireMemberSession } from '../../../lib/auth';
import { alertContentNew, alertModerationFlagged } from '../../../lib/adminAlerts';

export const POST: APIRoute = async ({ request }) => {
  try {
    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { session, userId } = gate;

    // Check daily event limit (5 per rolling 24h) before validation to save API costs
    const db = await connectDB();
    const eventsCollection = db.collection<any>('events');
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const todayCount = await eventsCollection.countDocuments({
      author: userId,
      createdAt: { $gte: dayAgo }
    });

    // Admins are exempt from the daily limit (they post official content in bursts).
    if (session.user.role !== 'admin' && todayCount >= 5) {
      return new Response(JSON.stringify({
        error: 'Daily event limit reached',
        message: 'You can create up to 5 events per day. Please try again tomorrow.',
        dailyLimit: 5,
        currentCount: todayCount
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate request body with Zod
    const validation = await parseRequestBody(request, EventCreateSchema);

    if (!validation.success) {
      return validation.response;
    }

    const { title, body, startDate, endDate, location, category, capacity, allDay, visibility, tags } = validation.data;

    // Admins are exempt from AI moderation (their content is auto-approved —
    // they run the review queue). Skips the OpenAI calls entirely.
    const skipModeration = session.user.role === 'admin';

    let mergedResult: ReturnType<typeof mergeModerationResults> = null;
    if (!skipModeration) {
      // Run content moderation + spam check in parallel (FAIL-SAFE: queues for review on any error)
      const contentText = `${title}\n\n${body || ''}\n\n${location || ''}`;
      const moderationChecks: Promise<any>[] = [
        moderateText(contentText),
        checkSpamWithGPT(contentText, 'neighborhood community event')
      ];
      if (tags?.length) {
        moderationChecks.push(moderateText(tags.join(' ')));
      }

      const [mainModerationResult, spamResult, tagsModerationResult] = await Promise.all(moderationChecks);

      // Merge all moderation results — returns null if all passed
      const resultsToMerge = [mainModerationResult, spamResult];
      if (tagsModerationResult) resultsToMerge.push(tagsModerationResult);
      mergedResult = mergeModerationResults(...resultsToMerge);
    }

    // Determine moderation status
    const moderationStatus = mergedResult ? 'pending' : 'approved';

    // Create new event
    const newEvent = {
      title,
      body,
      author: userId, // Save author as ID string
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      location: location || null,
      category: category || 'kiez',
      capacity: capacity ?? null,
      allDay: allDay ?? false,
      visibility: visibility ?? 'public',
      tags: tags || [],
      comments: [],
      views: 0,
      likes: 0,
      likedBy: [],
      rsvps: { going: [], maybe: [] },
      date: Date.now(),
      moderationStatus,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await eventsCollection.insertOne(newEvent);

    // If any moderation check failed, create a single merged flagged content record
    if (mergedResult) {
      const flaggedCollection = db.collection<FlaggedContent>('flaggedContent');
      const flaggedRecord = createFlaggedContentRecord(
        'event',
        { title, body, tags },
        {
          id: userId,
          name: session.user.name || undefined,
          email: session.user.email || undefined
        },
        mergedResult
      );
      flaggedRecord.contentId = result.insertedId.toString();
      await flaggedCollection.insertOne(flaggedRecord as FlaggedContent);
    }

    // Operational admin alert (never-throw, no-op without env). Admin's own
    // posts are exempt from moderation AND from self-alerting.
    if (!skipModeration) {
      if (mergedResult) {
        await alertModerationFlagged({ contentType: 'event', title, authorName: session.user.name });
      } else {
        await alertContentNew({ type: 'event', title, authorName: session.user.name, pending: false });
      }
    }

    // Fetch author info to return with the created event
    const usersCollection = db.collection('users');
    const author = await usersCollection.findOne(
      { _id: new ObjectId(userId) },
      { projection: PUBLIC_AUTHOR_PROJECTION }
    );

    const createdEvent = {
      ...newEvent,
      _id: result.insertedId,
      author: author ? toPublicAuthor(author) : userId // Return populated author or fallback to ID
    };

    // Return appropriate response based on moderation result
    if (mergedResult) {
      return new Response(
        JSON.stringify({
          event: createdEvent,
          message: mergedResult.userMessage,
          moderationStatus: 'pending'
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify({
        event: createdEvent,
        message: 'Event created successfully'
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Event creation error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
