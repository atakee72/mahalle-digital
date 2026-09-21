import type { APIRoute } from 'astro';
import { ObjectId } from 'mongodb';
import { connectDB } from '../../../lib/mongodb';

// Batch user-profile lookup — given a list of user IDs, return
// `{ id, name, image }[]` for each existing user. Used by the event
// detail modal's attendee cluster to swap colored disc placeholders
// for real avatars (KioskAvatar with name + Cloudinary picture).
//
// Public endpoint (no session gate) — mirrors `/api/comments/[postId]`
// which already exposes author name + picture unauthenticated. RSVP
// attendance was already visible in the events payload; this just
// enriches it with the display data needed for the avatar cluster.

const MAX_IDS = 60;

export const GET: APIRoute = async ({ url }) => {
  try {
    const idsParam = url.searchParams.get('ids') ?? '';
    const rawIds = idsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // Dedupe, drop malformed ObjectIds, cap at MAX_IDS. One bad ID
    // doesn't poison the response — we silently filter.
    const validIds = [...new Set(rawIds)]
      .filter((id) => ObjectId.isValid(id))
      .slice(0, MAX_IDS);

    if (validIds.length === 0) {
      return new Response(JSON.stringify({ users: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = await connectDB();
    const docs = await db
      .collection('users')
      .find({ _id: { $in: validIds.map((s) => new ObjectId(s)) } })
      .project({ name: 1, userPicture: 1, image: 1, handle: 1 })
      .toArray();

    const users = docs.map((d) => ({
      id: String(d._id),
      name: (d.name as string) ?? '',
      handle: typeof d.handle === 'string' ? d.handle : null,
      image: ((d.userPicture as string | undefined) ?? (d.image as string | undefined) ?? null) as string | null
    }));

    return new Response(JSON.stringify({ users }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Get user profiles error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500
    });
  }
};
