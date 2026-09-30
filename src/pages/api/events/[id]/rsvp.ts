import type { APIRoute } from 'astro';
import { connectDB } from '../../../../lib/mongodb';
import { ObjectId } from 'mongodb';
import { requireMemberSession } from '../../../../lib/auth';

// RSVP status the client can request. v1 supports two affirmative
// states (Going, Maybe) plus an explicit cancel — there is no
// "Not going" by design (CD spec).
type RsvpStatus = 'going' | 'maybe' | 'cancel';

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const eventId = params.id;

    if (!eventId || !ObjectId.isValid(eventId)) {
      return new Response(JSON.stringify({ error: 'Invalid event ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { session } = gate;

    const body = await request.json();
    const status = body?.status as RsvpStatus | undefined;

    if (status !== 'going' && status !== 'maybe' && status !== 'cancel') {
      return new Response(
        JSON.stringify({ error: 'Invalid status. Must be "going", "maybe", or "cancel"' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const userId = session.user.id;
    const db = await connectDB();
    const eventsCollection = db.collection('events');

    // Atomic update strategy:
    //  - 'going'  : remove user from 'maybe', then add to 'going'
    //  - 'maybe'  : remove user from 'going', then add to 'maybe'
    //  - 'cancel' : remove from both
    // MongoDB allows mixing $pull on one field and $addToSet on another
    // in the same update doc, so all three branches are single ops.
    let updateOp: Record<string, any>;
    // Only 'going' is capacity-capped. The filter matches when the event
    // has no numeric capacity (unlimited), the user is already in 'going'
    // (idempotent re-click), or there is still room — so the cap is
    // enforced atomically and two racing RSVPs can't both slip past a
    // read-then-write check. A non-match on 'going' means "full" (below).
    let filter: Record<string, any> = { _id: new ObjectId(eventId) };
    if (status === 'going') {
      updateOp = {
        $pull: { 'rsvps.maybe': userId },
        $addToSet: { 'rsvps.going': userId }
      };
      filter = {
        _id: new ObjectId(eventId),
        $or: [
          { capacity: { $not: { $type: 'number' } } },
          { 'rsvps.going': userId },
          { $expr: { $lt: [{ $size: { $ifNull: ['$rsvps.going', []] } }, '$capacity'] } }
        ]
      };
    } else if (status === 'maybe') {
      updateOp = {
        $pull: { 'rsvps.going': userId },
        $addToSet: { 'rsvps.maybe': userId }
      };
    } else {
      updateOp = {
        $pull: { 'rsvps.going': userId, 'rsvps.maybe': userId }
      };
    }

    const result = await eventsCollection.findOneAndUpdate(filter, updateOp, {
      returnDocument: 'after'
    });

    if (!result) {
      // For 'going' a non-match is ambiguous: the event is full OR it
      // doesn't exist. Disambiguate so the client gets the right signal.
      if (status === 'going') {
        const exists = await eventsCollection.findOne(
          { _id: new ObjectId(eventId) },
          { projection: { _id: 1 } }
        );
        if (exists) {
          return new Response(JSON.stringify({ error: 'event_full' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      return new Response(JSON.stringify({ error: 'Event not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const rsvps = (result as any).rsvps ?? { going: [], maybe: [] };
    const myStatus: 'going' | 'maybe' | null = rsvps.going?.includes(userId)
      ? 'going'
      : rsvps.maybe?.includes(userId)
      ? 'maybe'
      : null;

    return new Response(
      JSON.stringify({
        success: true,
        status: myStatus,
        rsvps: {
          going: rsvps.going ?? [],
          maybe: rsvps.maybe ?? [],
          goingCount: rsvps.going?.length ?? 0,
          maybeCount: rsvps.maybe?.length ?? 0
        }
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0'
        }
      }
    );
  } catch (error) {
    console.error('Error toggling event RSVP:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
