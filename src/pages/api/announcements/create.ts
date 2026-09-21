import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../../lib/mongodb';
import { PUBLIC_AUTHOR_PROJECTION, toPublicAuthor } from '../../../lib/publicAuthor';
import { ObjectId } from 'mongodb';
import type { Announcement, FlaggedContent } from '../../../types';
import { AnnouncementCreateSchema } from '../../../schemas/forum.schema';
import { parseRequestBody } from '../../../schemas/validation.utils';
import { moderateText, checkSpamWithGPT, checkImagesWithGPT, createFlaggedContentRecord, mergeModerationResults } from '../../../lib/moderation';
import { rejectIfBanned } from '../../../lib/auth/banGuard';
import { alertContentNew, alertModerationFlagged } from '../../../lib/adminAlerts';

export const POST: APIRoute = async ({ request }) => {
  try {
    // Get session from NextAuth
    const session = await getSession(request);

    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized - Please login' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Ban enforcement: banned accounts are read-only (3-strike Sperre).
    const bannedRes = await rejectIfBanned(session.user.id);
    if (bannedRes) return bannedRes;

    const userId = session.user.id;

    // Check daily announcement limit (5 per rolling 24h) before validation to save API costs
    const db = await connectDB();
    const announcementsCollection = db.collection<Announcement>('announcements');
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const todayCount = await announcementsCollection.countDocuments({
      author: userId,
      createdAt: { $gte: dayAgo }
    });

    // Admins are exempt from the daily limit (they post official content in bursts).
    if (session.user.role !== 'admin' && todayCount >= 5) {
      return new Response(JSON.stringify({
        error: 'Daily announcement limit reached',
        message: 'You can create up to 5 announcements per day. Please try again tomorrow.',
        dailyLimit: 5,
        currentCount: todayCount
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate request body with Zod
    const validation = await parseRequestBody(request, AnnouncementCreateSchema);

    if (!validation.success) {
      return validation.response;
    }

    const { title, body, tags, images } = validation.data;

    // Admins are exempt from AI moderation (their content is auto-approved —
    // they run the review queue). Skips the OpenAI calls entirely.
    const skipModeration = session.user.role === 'admin';

    let mergedResult: ReturnType<typeof mergeModerationResults> = null;
    if (!skipModeration) {
      // Run content moderation + spam check + image moderation in parallel
      const contentText = `${title}\n\n${body}`;
      const moderationChecks: Promise<any>[] = [
        moderateText(contentText),
        checkSpamWithGPT(contentText, 'neighborhood community announcement')
      ];
      if (tags?.length) {
        moderationChecks.push(moderateText(tags.join(' ')));
      }
      if (images?.length) {
        moderationChecks.push(checkImagesWithGPT(images.map(img => img.url)));
      }

      const [mainModerationResult, spamResult, tagsModerationResult, imageModerationResult] = await Promise.all(moderationChecks);

      // Merge all moderation results — returns null if all passed
      const resultsToMerge = [mainModerationResult, spamResult];
      if (tagsModerationResult) resultsToMerge.push(tagsModerationResult);
      if (imageModerationResult) resultsToMerge.push(imageModerationResult);
      mergedResult = mergeModerationResults(...resultsToMerge);
    }

    // Determine moderation status
    const moderationStatus = mergedResult ? 'pending' : 'approved';

    // Create new announcement
    const newAnnouncement: Announcement = {
      title,
      body,
      author: userId as any, // Save author as ID string
      tags: tags || [],
      images: images || [],
      comments: [],
      views: 0,
      likes: 0,
      likedBy: [],
      date: Date.now(),
      moderationStatus,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await announcementsCollection.insertOne(newAnnouncement);

    // If any moderation check failed, create a single merged flagged content record
    if (mergedResult) {
      const flaggedCollection = db.collection<FlaggedContent>('flaggedContent');
      const flaggedRecord = createFlaggedContentRecord(
        'announcement',
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
        await alertModerationFlagged({ contentType: 'announcement', title, authorName: session.user.name });
      } else {
        await alertContentNew({ type: 'announcement', title, authorName: session.user.name, pending: false });
      }
    }

    // Fetch author info to return with the created announcement
    const usersCollection = db.collection('users');
    const author = await usersCollection.findOne(
      { _id: new ObjectId(userId) },
      { projection: PUBLIC_AUTHOR_PROJECTION }
    );

    const createdAnnouncement = {
      ...newAnnouncement,
      _id: result.insertedId,
      author: author ? toPublicAuthor(author) : userId // Return populated author or fallback to ID
    };

    // Return appropriate response based on moderation result
    if (mergedResult) {
      return new Response(
        JSON.stringify({
          announcement: createdAnnouncement,
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
        announcement: createdAnnouncement,
        message: 'Announcement created successfully'
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Announcement creation error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};