import type { APIRoute } from 'astro';
import { requireMemberSession } from '../../../../lib/auth';
import { connectDB } from '../../../../lib/mongodb';
import { purgeNotificationsFor } from '../../../../lib/notificationPurge';
import { ObjectId } from 'mongodb';

// Helper function to extract author ID from various formats
function extractAuthorId(author: any): string | null {
  if (!author) return null;
  if (typeof author === 'string') return author;
  if (author.id) return author.id;
  if (author._id) return typeof author._id === 'string' ? author._id : author._id.toString();
  return null;
}

export const DELETE: APIRoute = async ({ params, request }) => {
  try {
    const { commentId } = params;

    if (!commentId || !ObjectId.isValid(commentId)) {
      return new Response(JSON.stringify({ error: 'Invalid comment ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Session + LIVE ban check (401 / 403 pre-shaped) — a banned member
    // may read but not remove their content either. See requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { userId } = gate;

    // Connect to database
    const db = await connectDB();
    const commentsCollection = db.collection('comments');

    // Find the comment to verify ownership
    const comment = await commentsCollection.findOne({ _id: new ObjectId(commentId) });

    if (!comment) {
      return new Response(JSON.stringify({ error: 'Comment not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if user is the author of the comment
    const commentAuthorId = extractAuthorId(comment.author);

    if (!commentAuthorId || commentAuthorId !== userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized to delete this comment' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Delete the comment
    await commentsCollection.deleteOne({ _id: new ObjectId(commentId) });

    // Remove comment reference from the parent post
    // We need to check all collections since we don't know the parent type
    const collections = ['topics', 'announcements', 'recommendations', 'events'];
    for (const coll of collections) {
      await db.collection(coll).updateMany(
        { comments: new ObjectId(commentId) },
        { $pull: { comments: new ObjectId(commentId) } }
      );
    }

    // A pending report/flag on now-deleted content stays in the moderation
    // queue, marked deleted (still strikeable from the stored snapshot).
    await db.collection('flaggedContent').updateMany(
      { contentId: commentId, contentType: 'comment' },
      { $set: { contentDeleted: true, contentDeletedAt: new Date() } }
    );

    // Mention / @alle / „replied" rows that name this comment as their source.
    await purgeNotificationsFor(db, [commentId]);

    return new Response(
      JSON.stringify({ message: 'Comment deleted successfully' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Comment deletion error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};