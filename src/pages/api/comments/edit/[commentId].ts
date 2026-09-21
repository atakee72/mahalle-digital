import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../../../lib/mongodb';
import { PUBLIC_AUTHOR_PROJECTION, toPublicAuthor } from '../../../../lib/publicAuthor';
import { ObjectId } from 'mongodb';
import type { Comment } from '../../../../types';
import { CommentUpdateSchema } from '../../../../schemas/comment.schema';
import { parseRequestBody } from '../../../../schemas/validation.utils';
import { isOwner } from '../../../../utils/authHelpers';
import { moderateText, checkSpamWithGPT, mergeModerationResults } from '../../../../lib/moderation';
import { rejectIfBanned } from '../../../../lib/auth/banGuard';
import { alertModerationFlagged } from '../../../../lib/adminAlerts';

const EDIT_WINDOW_MS = 15 * 60 * 1000;

export const PUT: APIRoute = async ({ request, params }) => {
  try {
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
    const commentId = params.commentId;

    if (!commentId || !ObjectId.isValid(commentId)) {
      return new Response(JSON.stringify({ error: 'Invalid comment ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const validation = await parseRequestBody(request, CommentUpdateSchema);
    if (!validation.success) {
      return validation.response;
    }

    const { body } = validation.data;

    const db = await connectDB();
    const commentsCollection = db.collection<Comment>('comments');

    const existingComment = await commentsCollection.findOne({ _id: new ObjectId(commentId) });

    if (!existingComment) {
      return new Response(JSON.stringify({ error: 'Comment not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!isOwner(existingComment.author, userId)) {
      return new Response(JSON.stringify({ error: 'You can only edit your own comments' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const commentDateMs =
      typeof existingComment.date === 'number'
        ? existingComment.date
        : new Date(existingComment.date as any).getTime();
    if (Date.now() - commentDateMs >= EDIT_WINDOW_MS) {
      return new Response(JSON.stringify({ error: 'edit_window_expired' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (existingComment.moderationStatus !== 'approved' || existingComment.hasWarningLabel) {
      return new Response(JSON.stringify({ error: 'edit_blocked_by_moderation' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Admins are exempt from AI moderation (their content is auto-approved —
    // they run the review queue). Skips the OpenAI calls entirely.
    const skipModeration = session.user.role === 'admin';

    let mergedResult: ReturnType<typeof mergeModerationResults> = null;
    if (!skipModeration) {
      const [textModerationResult, spamResult] = await Promise.all([
        moderateText(body),
        checkSpamWithGPT(body, 'community forum comment')
      ]);

      mergedResult = mergeModerationResults(textModerationResult, spamResult);
    }
    const newModerationStatus = mergedResult ? 'pending' : 'approved';

    const updateResult = await commentsCollection.findOneAndUpdate(
      { _id: new ObjectId(commentId) },
      {
        $set: {
          body,
          editedAt: new Date(),
          updatedAt: new Date(),
          moderationStatus: newModerationStatus
        }
      },
      { returnDocument: 'after' }
    );

    if (!updateResult) {
      return new Response(JSON.stringify({ error: 'Failed to update comment' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (mergedResult) {
      await alertModerationFlagged({ contentType: 'comment', title: body.slice(0, 80), authorName: session.user.name });
    }

    // Populate author info to match the create endpoint's response shape.
    const usersCollection = db.collection('users');
    const authorIdStr =
      typeof existingComment.author === 'string'
        ? existingComment.author
        : (existingComment.author as any)?.toString?.() ?? String(existingComment.author);
    const author = ObjectId.isValid(authorIdStr)
      ? await usersCollection.findOne(
          { _id: new ObjectId(authorIdStr) },
          { projection: PUBLIC_AUTHOR_PROJECTION }
        )
      : null;

    const updatedComment = {
      ...updateResult,
      author: author ? toPublicAuthor(author) : existingComment.author
    };

    return new Response(
      JSON.stringify({
        comment: updatedComment,
        moderationStatus: newModerationStatus
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Comment edit error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
