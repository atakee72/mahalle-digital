import type { APIRoute } from 'astro';
import { connectDB } from '../../../lib/mongodb';
import { notifyForumSubscribers } from '../../../lib/forum/forumNotify';
import { checkDailyLimit, limitReachedResponse } from '../../../lib/limits/dailyLimit';
import { PUBLIC_AUTHOR_PROJECTION, toPublicAuthor } from '../../../lib/publicAuthor';
import { resolveMentions, notifyMentions, applyBroadcast, notifyAdminHint } from '../../../lib/mentions/mentionsStore';
import { moderationTarget } from '../../../lib/notifications';
import { ObjectId } from 'mongodb';
import type { Topic, FlaggedContent } from '../../../types';
import { TopicCreateSchema } from '../../../schemas/forum.schema';
import { parseRequestBody } from '../../../schemas/validation.utils';
import { moderateText, checkSpamWithGPT, checkImagesWithGPT, createFlaggedContentRecord, mergeModerationResults } from '../../../lib/moderation';
import { requireMemberSession } from '../../../lib/auth';
import { alertContentNew, alertModerationFlagged } from '../../../lib/adminAlerts';

export const POST: APIRoute = async ({ request }) => {
  try {
    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { session, userId } = gate;

    // Daily limit (forum bucket: discussions + announcements + recommendations
    // together, rolling 24h) before validation to save API costs.
    const db = await connectDB();
    const limit = await checkDailyLimit(db, { userId, role: session.user.role }, 'forum');
    if (!limit.allowed) return limitReachedResponse('forum', limit);
    const topicsCollection = db.collection<Topic>('topics');

    // Validate request body with Zod
    const validation = await parseRequestBody(request, TopicCreateSchema);

    if (!validation.success) {
      return validation.response;
    }

    const { title, body, tags, images } = validation.data;

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
        checkSpamWithGPT(contentText, 'neighborhood community forum post')
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

    // Create new topic
    const newTopic: Topic = {
      title,
      body: cleanBody,
      author: userId as any, // Save author as ID string
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

    const result = await topicsCollection.insertOne(newTopic);

    // If any moderation check failed, create a single merged flagged content record
    if (mergedResult) {
      const flaggedCollection = db.collection<FlaggedContent>('flaggedContent');
      const flaggedRecord = createFlaggedContentRecord(
        'topic',
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
        await alertModerationFlagged({ contentType: 'topic', title, authorName: session.user.name });
      } else {
        await alertContentNew({ type: 'topic', title, authorName: session.user.name, pending: false });
      }
    }

    // Mentions notify only once the post is public; a pending post is picked up
    // by notifyMentionsOnApproval() in reviewAction.ts. Never throws.
    if (!mergedResult) {
      // Members who asked for every new forum post (never throws).
      await notifyForumSubscribers({
        id: result.insertedId.toString(), kind: 'topic', title, authorId: userId, dateMs: Date.now(),
      });
      await notifyMentions(db, {
        actorId: userId, mentions, sourceId: result.insertedId.toString(), kind: 'post',
        target: moderationTarget('topic', result.insertedId.toString(), title),
      });
      if (broadcast) {
        const n = await notifyAdminHint(db, {
          actorId: userId, sourceId: result.insertedId.toString(), kind: 'post',
          target: moderationTarget('topic', result.insertedId.toString(), title),
          excludedHandles: broadcast.excludedHandles,
        });
        await topicsCollection.updateOne(
          { _id: result.insertedId },
          { $set: { 'broadcast.notifiedAt': new Date(), 'broadcast.recipients': n } }
        );
      }
    }

    // Fetch author info to return with the created topic
    const usersCollection = db.collection('users');
    const author = await usersCollection.findOne(
      { _id: new ObjectId(userId) },
      { projection: PUBLIC_AUTHOR_PROJECTION }
    );

    const createdTopic = {
      ...newTopic,
      _id: result.insertedId,
      author: author ? toPublicAuthor(author) : userId // Return populated author or fallback to ID
    };

    // Return appropriate response based on moderation result
    if (mergedResult) {
      return new Response(
        JSON.stringify({
          topic: createdTopic,
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
        topic: createdTopic,
        message: 'Topic created successfully'
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Topic creation error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};