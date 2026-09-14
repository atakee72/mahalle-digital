import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../../../lib/mongodb';
import { invalidateKiezKontext } from '../../../../lib/kiez/kontext';
import { deleteCommentsForPost } from '../../../../lib/comments/cascade';
import { ObjectId } from 'mongodb';

export const DELETE: APIRoute = async ({ params, request }) => {
  try {
    const id = params.id;

    if (!id || !ObjectId.isValid(id)) {
      return new Response(JSON.stringify({ error: 'Invalid topic ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get session from NextAuth
    const session = await getSession(request);

    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized - Please login' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const userId = session.user.id;

    const db = await connectDB();
    const topicsCollection = db.collection('topics');

    // First, check if the topic exists and if the user is the author
    const topic = await topicsCollection.findOne({ _id: new ObjectId(id) });

    if (!topic) {
      return new Response(JSON.stringify({ error: 'Topic not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if user is the author
    // Handle both new format (NextAuth ID as string) and old format (ObjectId)
    const topicAuthorId = typeof topic.author === 'string'
      ? topic.author
      : topic.author?.toString();

    if (topicAuthorId !== userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized - you can only delete your own topics' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Delete the topic
    const result = await topicsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return new Response(JSON.stringify({ error: 'Failed to delete topic' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Cascade the comment thread (reported comments stay in the queue, marked deleted).
    await deleteCommentsForPost(db, id);

    // A pending report/flag on now-deleted content stays in the moderation
    // queue, marked deleted (still strikeable from the stored snapshot).
    await db.collection('flaggedContent').updateMany(
      { contentId: id, contentType: 'topic' },
      { $set: { contentDeleted: true, contentDeletedAt: new Date() } }
    );

    // Kiez-Daten Anwohner-Kontext chips freeze topic titles/links for 24h —
    // drop the cache so a deleted topic never serves a 404 chip.
    await invalidateKiezKontext();

    return new Response(JSON.stringify({
      message: 'Topic deleted successfully',
      id: id
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Delete topic error:', error);
    return new Response(JSON.stringify({ error: 'Failed to delete topic' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};