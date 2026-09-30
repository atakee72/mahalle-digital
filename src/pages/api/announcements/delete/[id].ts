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
      return new Response(JSON.stringify({ error: 'Invalid announcement ID' }), {
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
    const announcementsCollection = db.collection('announcements');

    // First, check if the announcement exists and if the user is the author
    const announcement = await announcementsCollection.findOne({ _id: new ObjectId(id) });

    if (!announcement) {
      return new Response(JSON.stringify({ error: 'Announcement not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if user is the author
    // Handle both new format (NextAuth ID as string) and old format (ObjectId)
    const announcementAuthorId = typeof announcement.author === 'string'
      ? announcement.author
      : announcement.author?.toString();

    if (announcementAuthorId !== userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized - you can only delete your own announcements' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Delete the announcement
    const result = await announcementsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return new Response(JSON.stringify({ error: 'Failed to delete announcement' }), {
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
      { contentId: id, contentType: 'announcement' },
      { $set: { contentDeleted: true, contentDeletedAt: new Date() } }
    );

    return new Response(JSON.stringify({
      message: 'Announcement deleted successfully',
      id: id
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Delete announcement error:', error);
    return new Response(JSON.stringify({ error: 'Failed to delete announcement' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};