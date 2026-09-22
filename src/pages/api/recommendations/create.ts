import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../../lib/mongodb';
import { PUBLIC_AUTHOR_PROJECTION, toPublicAuthor } from '../../../lib/publicAuthor';
import { resolveMentions, notifyMentions, applyBroadcast, notifyAdminHint } from '../../../lib/mentions/mentionsStore';
import { moderationTarget } from '../../../lib/notifications';
import { ObjectId } from 'mongodb';
import type { Recommendation, FlaggedContent } from '../../../types';
import { RecommendationCreateSchema } from '../../../schemas/forum.schema';
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

    // Check daily recommendation limit (5 per rolling 24h) before validation to save API costs
    const db = await connectDB();
    const recommendationsCollection = db.collection<Recommendation>('recommendations');
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const todayCount = await recommendationsCollection.countDocuments({
      author: userId,
      createdAt: { $gte: dayAgo }
    });

    // Admins are exempt from the daily limit (they post official content in bursts).
    if (session.user.role !== 'admin' && todayCount >= 5) {
      return new Response(JSON.stringify({
        error: 'Daily recommendation limit reached',
        message: 'You can create up to 5 recommendations per day. Please try again tomorrow.',
        dailyLimit: 5,
        currentCount: todayCount
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate request body with Zod
    const validation = await parseRequestBody(request, RecommendationCreateSchema);

    if (!validation.success) {
      return validation.response;
    }

    const { title, body, tags, category, images } = validation.data;

    // „@alle" Admin-Hinweis (2026-09-22): admin-only broadcast. The span is
    // removed from the stored body; non-admin text is untouched.
    const isAdmin = session.user.role === 'admin';
    const { body: cleanBody, broadcast } = applyBroadcast(body, isAdmin);

    // Admins are exempt from AI moderation (their content is auto-approved —
    // they run the review queue). Skips the OpenAI calls entirely.
    const skipModeration = isAdmin;

    let mergedResult: ReturnType<typeof mergeModerationResults> = null;
    if (!skipModeration) {
      // Run content moderation + spam check + image moderation in parallel
      const contentText = `${title}\n\n${cleanBody}`;
      const moderationChecks: Promise<any>[] = [
        moderateText(contentText),
        checkSpamWithGPT(contentText, 'neighborhood place/business recommendation')
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

    // „@handle" mentions are resolved NOW and stored by user id (src/lib/mentions).
    const mentions = await resolveMentions(db, cleanBody);

    // Determine moderation status
    const moderationStatus = mergedResult ? 'pending' : 'approved';

    // Create new recommendation
    const newRecommendation: Recommendation = {
      title,
      body: cleanBody,
      author: userId as any, // Save author as ID string
      category: category || 'other',
      tags: tags || [],
      images: images || [],
      mentions,
      ...(broadcast ? { broadcast } : {}),
      comments: [],
      views: 0,
      likes: 0,
      likedBy: [],
      date: Date.now(),
      moderationStatus,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await recommendationsCollection.insertOne(newRecommendation);

    // If any moderation check failed, create a single merged flagged content record
    if (mergedResult) {
      const flaggedCollection = db.collection<FlaggedContent>('flaggedContent');
      const flaggedRecord = createFlaggedContentRecord(
        'recommendation',
        { title, body: cleanBody, tags },
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
        await alertModerationFlagged({ contentType: 'recommendation', title, authorName: session.user.name });
      } else {
        await alertContentNew({ type: 'recommendation', title, authorName: session.user.name, pending: false });
      }
    }

    // Mentions notify only once the post is public; a pending post is picked up
    // by notifyMentionsOnApproval() in reviewAction.ts. Never throws.
    if (!mergedResult) {
      await notifyMentions(db, {
        actorId: userId, mentions, sourceId: result.insertedId.toString(), kind: 'post',
        target: moderationTarget('recommendation', result.insertedId.toString(), title),
      });
      if (broadcast) {
        const n = await notifyAdminHint(db, {
          actorId: userId, sourceId: result.insertedId.toString(), kind: 'post',
          target: moderationTarget('recommendation', result.insertedId.toString(), title),
          excludedHandles: broadcast.excludedHandles,
        });
        await recommendationsCollection.updateOne(
          { _id: result.insertedId },
          { $set: { 'broadcast.notifiedAt': new Date(), 'broadcast.recipients': n } }
        );
      }
    }

    // Fetch author info to return with the created recommendation
    const usersCollection = db.collection('users');
    const author = await usersCollection.findOne(
      { _id: new ObjectId(userId) },
      { projection: PUBLIC_AUTHOR_PROJECTION }
    );

    const createdRecommendation = {
      ...newRecommendation,
      _id: result.insertedId,
      author: author ? toPublicAuthor(author) : userId // Return populated author or fallback to ID
    };

    // Return appropriate response based on moderation result
    if (mergedResult) {
      return new Response(
        JSON.stringify({
          recommendation: createdRecommendation,
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
        recommendation: createdRecommendation,
        message: 'Recommendation created successfully'
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Recommendation creation error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};