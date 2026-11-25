import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../../lib/mongodb';
import { ObjectId } from 'mongodb';
import { rejectIfBanned } from '../../../lib/auth/banGuard';
import { decideCommentLike } from '../../../lib/forum/commentLike';

export const POST: APIRoute = async ({ request }) => {
  try {
    // Get the NextAuth session
    const session = await getSession(request);

    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Ban enforcement: banned accounts are read-only (3-strike Sperre).
    const bannedRes = await rejectIfBanned(session.user.id);
    if (bannedRes) return bannedRes;

    const body = await request.json();
    const { postId, collectionType, action } = body;

    if (!postId || !collectionType || !action) {
      return new Response(JSON.stringify({ error: 'Post ID, collection type, and action are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate collection type
    const validCollections = ['topics', 'announcements', 'recommendations', 'comments'];
    if (!validCollections.includes(collectionType)) {
      return new Response(JSON.stringify({ error: 'Invalid collection type' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate action
    if (action !== 'like' && action !== 'unlike') {
      return new Response(JSON.stringify({ error: 'Invalid action. Must be "like" or "unlike"' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const userId = session.user.id; // NextAuth user ID

    // Connect to database
    const db = await connectDB();
    const collection = db.collection(collectionType);

    // Toggle like/unlike.
    // We store userId in likedBy using the ID from the NextAuth session, and
    // derive `likes` from likedBy.length in the SAME update (aggregation
    // pipeline) so the count can never drift from the array: a repeated like
    // (already in likedBy) or repeated unlike (already absent) is idempotent,
    // and any pre-existing drift self-heals on the next toggle. This replaces
    // the old $addToSet/$pull + unconditional $inc, where a double-fire would
    // bump `likes` without changing likedBy.
    const updateOperation = action === 'like'
      ? [
          { $set: { likedBy: { $setUnion: [{ $ifNull: ['$likedBy', []] }, [userId]] } } },
          { $set: { likes: { $size: { $ifNull: ['$likedBy', []] } } } },
        ]
      : [
          {
            $set: {
              likedBy: {
                $filter: {
                  input: { $ifNull: ['$likedBy', []] },
                  cond: { $ne: ['$$this', userId] },
                },
              },
            },
          },
          { $set: { likes: { $size: { $ifNull: ['$likedBy', []] } } } },
        ];

    // Comments: must exist + be approved (404), never your own (400).
    if (collectionType === 'comments') {
      if (!ObjectId.isValid(postId)) {
        return new Response(JSON.stringify({ error: 'Post not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const target = await collection.findOne(
        { _id: new ObjectId(postId) },
        { projection: { author: 1, moderationStatus: 1 } }
      );
      const decision = decideCommentLike(target as any, userId);
      if (decision.kind === 'not_found') {
        return new Response(JSON.stringify({ error: 'Post not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (decision.kind === 'own') {
        return new Response(JSON.stringify({ error: 'own_comment' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // For a comment the rules checked above are repeated in the write filter, so a
    // report or rejection landing between the check and the write cannot slip a like in.
    const writeFilter: Record<string, unknown> = collectionType === 'comments'
      ? {
          _id: new ObjectId(postId),
          $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }],
          author: { $nin: ObjectId.isValid(userId) ? [userId, new ObjectId(userId)] : [userId] },
        }
      : { _id: new ObjectId(postId) };

    const result = await collection.updateOne(writeFilter, updateOperation);

    if (result.matchedCount === 0) {
      return new Response(JSON.stringify({ error: 'Post not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get updated post to return current like count
    const updatedPost = await collection.findOne({ _id: new ObjectId(postId) });

    return new Response(JSON.stringify({
      success: true,
      action,
      likeCount: updatedPost?.likes || 0,
      isLiked: action === 'like'
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error) {
    console.error('Error toggling like:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};