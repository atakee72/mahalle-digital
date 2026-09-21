import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../../lib/mongodb';
import { PUBLIC_AUTHOR_PROJECTION, toPublicAuthor } from '../../../lib/publicAuthor';
import { ObjectId } from 'mongodb';
import type { Comment, FlaggedContent } from '../../../types';
import { CommentCreateSchema } from '../../../schemas/comment.schema';
import { parseRequestBody } from '../../../schemas/validation.utils';
import { moderateText, checkSpamWithGPT, createFlaggedContentRecord, mergeModerationResults } from '../../../lib/moderation';
import { rejectIfBanned } from '../../../lib/auth/banGuard';
import { notify, commentTarget } from '../../../lib/notifications';
import { alertComment, alertModerationFlagged } from '../../../lib/adminAlerts';

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

    // Validate request body with Zod
    const validation = await parseRequestBody(request, CommentCreateSchema);
    if (!validation.success) {
      return validation.response;
    }

    const { body, topicId, collectionType } = validation.data;

    // Admins are exempt from AI moderation (their content is auto-approved —
    // they run the review queue). Skips the OpenAI calls entirely.
    const skipModeration = session.user.role === 'admin';

    let mergedResult: ReturnType<typeof mergeModerationResults> = null;
    if (!skipModeration) {
      // Run AI content moderation + spam check in parallel
      const [textModerationResult, spamResult] = await Promise.all([
        moderateText(body),
        checkSpamWithGPT(body, 'community forum comment')
      ]);

      mergedResult = mergeModerationResults(textModerationResult, spamResult);
    }
    const moderationStatus = mergedResult ? 'pending' : 'approved';

    // Connect to database
    const db = await connectDB();
    const commentsCollection = db.collection<Comment>('comments');

    // Create new comment
    const newComment: Comment = {
      body,
      author: userId as any, // Save author as ID string
      relevantPostId: new ObjectId(topicId),
      date: Date.now(),
      upvotes: 0,
      moderationStatus,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await commentsCollection.insertOne(newComment);

    // Determine parent collection name
    const parentCollection = collectionType === 'announcements'
      ? 'announcements'
      : collectionType === 'recommendations'
        ? 'recommendations'
        : collectionType === 'events'
          ? 'events'
          : 'topics';

    // If any moderation check failed, create a single merged flagged content record
    // Don't add to parent's comments array yet - will be added when approved
    if (mergedResult) {
      const flaggedCollection = db.collection<FlaggedContent>('flaggedContent');
      const flaggedRecord = createFlaggedContentRecord(
        'comment',
        { body },
        {
          id: userId,
          name: session.user.name || undefined,
          email: session.user.email || undefined
        },
        mergedResult
      );
      flaggedRecord.contentId = result.insertedId.toString();
      // Store parent info so we can add to comments array when approved
      (flaggedRecord as any).parentPostId = topicId;
      (flaggedRecord as any).parentCollection = parentCollection;
      await flaggedCollection.insertOne(flaggedRecord as FlaggedContent);
      await alertModerationFlagged({ contentType: 'comment', title: body.slice(0, 80), authorName: session.user.name });
    } else {
      // Only add to parent's comments array if approved immediately.
      // findOneAndUpdate (not updateOne) so the parent's author + title come
      // back in the same round-trip for the notification below.
      const postsCollection = db.collection(parentCollection);
      const parentDoc = await postsCollection.findOneAndUpdate(
        { _id: new ObjectId(topicId) },
        {
          $push: { comments: result.insertedId } as any,
          $set: { updatedAt: new Date() }
        },
        { projection: { author: 1, title: 1 } }
      );

      if (parentDoc?.author) {
        await notify({
          userId: String(parentDoc.author),
          type: 'comment',
          actorId: userId,
          target: commentTarget(parentCollection, topicId, parentDoc.title ?? ''),
        });
      }

      if (!skipModeration) {
        await alertComment({ authorName: session.user.name, parentTitle: parentDoc?.title ?? '' });
      }
    }

    // Fetch author info to return with the created comment
    const usersCollection = db.collection('users');
    const author = await usersCollection.findOne(
      { _id: new ObjectId(userId) },
      { projection: PUBLIC_AUTHOR_PROJECTION }
    );

    const createdComment = {
      ...newComment,
      _id: result.insertedId,
      author: author ? toPublicAuthor(author) : userId // Return populated author or fallback to ID
    };

    // Return appropriate response based on moderation result
    if (mergedResult) {
      return new Response(
        JSON.stringify({
          comment: createdComment,
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
        comment: createdComment,
        message: 'Comment added successfully'
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Comment creation error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};