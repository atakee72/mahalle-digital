import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../../lib/mongodb';
import { PUBLIC_AUTHOR_PROJECTION, toPublicAuthor } from '../../../lib/publicAuthor';
import { ObjectId } from 'mongodb';

export const GET: APIRoute = async ({ params, request }) => {
  try {
    const { postId } = params;

    if (!postId) {
      return new Response(JSON.stringify({ error: 'Post ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get current user for moderation filtering
    const session = await getSession(request);
    const currentUserId = session?.user?.id;

    // Connect to database
    const db = await connectDB();
    const commentsCollection = db.collection('comments');
    const usersCollection = db.collection('users');

    // Build moderation filter:
    // - Show approved comments to everyone
    // - Show comments without moderationStatus (legacy) to everyone
    // - Show user-reported comments (pending + isUserReported) to everyone
    // - Show author's own pending/rejected comments only to them
    const moderationFilter = {
      relevantPostId: new ObjectId(postId),
      $or: [
        { moderationStatus: 'approved' },
        { moderationStatus: { $exists: false } },
        { moderationStatus: 'pending', isUserReported: true },
        ...(currentUserId ? [
          { author: currentUserId, moderationStatus: 'pending' },
          { author: currentUserId, moderationStatus: 'rejected' }
        ] : [])
      ]
    };

    // Fetch comments for this post with moderation filter
    const comments = await commentsCollection
      .find(moderationFilter)
      .sort({ date: -1 })
      .toArray();

    // Populate author information for each comment
    const populatedComments = await Promise.all(
      comments.map(async (comment) => {
        let author = null;

        // If author is already an object (populated), return as is
        if (typeof comment.author === 'object' && 'userName' in comment.author) {
          return comment;
        }

        // Try to find author by ID (string or ObjectId)
        if (typeof comment.author === 'string') {
          // Try as ObjectId first
          try {
            author = await usersCollection.findOne(
              { _id: new ObjectId(comment.author) },
              { projection: PUBLIC_AUTHOR_PROJECTION }
            );
          } catch {
            // If not valid ObjectId, skip
            author = null;
          }
        } else {
          // Old MongoDB ObjectId lookup for backwards compatibility
          author = await usersCollection.findOne(
            { _id: comment.author },
            { projection: PUBLIC_AUTHOR_PROJECTION }
          );
        }

        return { ...comment, author: author ? toPublicAuthor(author) : null };
      })
    );

    return new Response(
      JSON.stringify({
        comments: populatedComments,
        count: populatedComments.length
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Error fetching comments:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};