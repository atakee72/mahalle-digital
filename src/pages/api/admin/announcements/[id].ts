import type { APIRoute } from 'astro';
import { ObjectId } from 'mongodb';
import { connectDB } from '../../../../lib/mongodb';
import { requireAdminSession } from '../../../../lib/auth';
import { deleteCommentsForPost } from '../../../../lib/comments/cascade';
import { AdminAnnouncementUpdateSchema } from '../../../../schemas/forum.schema';
import { parseRequestBody } from '../../../../schemas/validation.utils';
import { populateAuthors } from '../../../../lib/topicsQuery';
import { displaceForPin } from '../../../../lib/announcements/pin';

// Admin-only PATCH (edit + pin/unpin) and DELETE for official
// announcements. Both ops validate the target is `isOfficial: true` so
// admins can't silently mutate user-made announcements via this
// endpoint — those still go through /api/announcements/edit/[id] and
// /api/announcements/delete/[id].

export const PATCH: APIRoute = async ({ params, request }) => {
  const guard = await requireAdminSession(request);
  if (!guard.ok) return guard.response;

  const { id } = params;
  if (!id || !ObjectId.isValid(id)) {
    return new Response(JSON.stringify({ error: 'Invalid id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const validation = await parseRequestBody(request, AdminAnnouncementUpdateSchema);
  if (!validation.success) return validation.response;
  const data = validation.data;

  try {
    const db = await connectDB();
    const collection = db.collection('announcements');

    // Confirm target is official — admins must use community endpoints
    // for user-made announcements (pin user-made is deferred per plan).
    const target = await collection.findOne({ _id: new ObjectId(id) });
    if (!target) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (target.isOfficial !== true) {
      return new Response(
        JSON.stringify({ error: 'This endpoint only edits official announcements' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // If pinning (pinnedUntil set to a FUTURE date), make room under the
    // MAX_PINS cap — the item being pinned is never its own victim. A past
    // date is just an expired pin and displaces nothing.
    if (typeof data.pinnedUntil === 'string' && new Date(data.pinnedUntil).getTime() > Date.now()) {
      await displaceForPin(db, id);
    }

    // Build $set: pinnedUntil string → Date, null → null, undefined → omit.
    const update: Record<string, any> = { updatedAt: new Date() };
    if (data.title !== undefined) update.title = data.title;
    if (data.body !== undefined) update.body = data.body;
    if (data.tags !== undefined) update.tags = data.tags;
    if (data.images !== undefined) update.images = data.images;
    if (data.pinnedUntil !== undefined) {
      update.pinnedUntil = data.pinnedUntil === null ? null : new Date(data.pinnedUntil);
    }

    // Content edit (title/body) bumps the visible edit counter; pin/unpin
    // and tag/image-only PATCHes don't count as "edited".
    const contentEdited = data.title !== undefined || data.body !== undefined;
    await collection.updateOne(
      { _id: new ObjectId(id) },
      contentEdited
        ? { $set: update, $inc: { editCount: 1 } }
        : { $set: update }
    );

    const updated = await collection.findOne({ _id: new ObjectId(id) });
    const [populated] = await populateAuthors([updated as any]);

    return new Response(
      JSON.stringify({ announcement: populated }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Admin announcement PATCH error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const guard = await requireAdminSession(request);
  if (!guard.ok) return guard.response;

  const { id } = params;
  if (!id || !ObjectId.isValid(id)) {
    return new Response(JSON.stringify({ error: 'Invalid id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = await connectDB();
    const collection = db.collection('announcements');

    const target = await collection.findOne({ _id: new ObjectId(id) });
    if (!target) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (target.isOfficial !== true) {
      return new Response(
        JSON.stringify({ error: 'This endpoint only deletes official announcements' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await collection.deleteOne({ _id: new ObjectId(id) });
    // Officials can be commented like any announcement — cascade the thread.
    await deleteCommentsForPost(db, id);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Admin announcement DELETE error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
