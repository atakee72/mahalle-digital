import type { APIRoute } from 'astro';
import { requireMemberSession } from '../../../../lib/auth';
import { connectDB } from '../../../../lib/mongodb';
import { deleteCommentsForPost } from '../../../../lib/comments/cascade';
import { purgeNotificationsFor } from '../../../../lib/notificationPurge';
import { ObjectId } from 'mongodb';

export const DELETE: APIRoute = async ({ params, request }) => {
  try {
    const id = params.id;

    if (!id || !ObjectId.isValid(id)) {
      return new Response(JSON.stringify({ error: 'Invalid event ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Session + LIVE ban check (401 / 403 pre-shaped) — a banned member
    // may read but not remove their content either. See requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { userId } = gate;

    const db = await connectDB();
    const eventsCollection = db.collection('events');

    // First, check if the event exists and if the user is the author
    const event = await eventsCollection.findOne({ _id: new ObjectId(id) });

    if (!event) {
      return new Response(JSON.stringify({ error: 'Event not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if user is the author
    // Handle both new format (NextAuth ID as string) and old format (ObjectId)
    const eventAuthorId = typeof event.author === 'string'
      ? event.author
      : event.author?.toString();

    if (eventAuthorId !== userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized - you can only delete your own events' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Delete the event
    const result = await eventsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return new Response(JSON.stringify({ error: 'Failed to delete event' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Cascade the comment thread (reported comments stay in the queue, marked deleted).
    const cascade = await deleteCommentsForPost(db, id);
    // Bell rows about the post and its thread target the post id; the ids of the
    // deleted comments catch the one moderation-row shape that targets a comment.
    await purgeNotificationsFor(db, [id, ...cascade.commentIds]);

    // A pending report/flag on now-deleted content stays in the moderation
    // queue, marked deleted (still strikeable from the stored snapshot).
    await db.collection('flaggedContent').updateMany(
      { contentId: id, contentType: 'event' },
      { $set: { contentDeleted: true, contentDeletedAt: new Date() } }
    );

    return new Response(JSON.stringify({
      message: 'Event deleted successfully',
      id: id
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Delete event error:', error);
    return new Response(JSON.stringify({ error: 'Failed to delete event' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
