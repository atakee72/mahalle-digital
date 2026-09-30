import type { APIRoute } from 'astro';
import { requireMemberSession } from '../../../../lib/auth';
import { connectDB } from '../../../../lib/mongodb';
import { purgeNotificationsFor } from '../../../../lib/notificationPurge';
import { ObjectId } from 'mongodb';
import type { Listing } from '../../../../types/listing';
import { isValidObjectId } from '../../../../schemas/validation.utils';
import { canMutateListing } from '../../../../lib/listingActions';

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    // Session + LIVE ban check (401 / 403 pre-shaped) — a banned member
    // may read but not remove their content either. See requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { userId } = gate;

    const { id } = params;

    if (!id || !isValidObjectId(id)) {
      return new Response(JSON.stringify({ error: 'Invalid listing ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = await connectDB();
    const listingsCollection = db.collection<Listing>('listings');

    // Check if listing exists
    const existingListing = await listingsCollection.findOne({ _id: new ObjectId(id) });

    if (!existingListing) {
      return new Response(JSON.stringify({ error: 'Listing not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Per plan Task 1.3.5: owners must be able to delete rejected listings
    // (they need to clean up after moderation rejects them). Drafts are also
    // freely deletable. canMutateListing still blocks pending (preserve evidence
    // while AI is mid-scan) and reserved/sold (use status endpoint to back out).
    const guard = canMutateListing(existingListing as any, userId, { allowOnRejected: true });
    if (!guard.ok) {
      const httpStatus = guard.reason === 'not_owner' ? 403 : 409;
      return new Response(
        JSON.stringify({ error: `delete_blocked_${guard.reason}` }),
        { status: httpStatus, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await listingsCollection.deleteOne({ _id: new ObjectId(id) });

    // Contact-relay rows for this listing hold buyer PII (plaintext
    // name+email) — cascade them with the listing. listingAuditTrail is
    // deliberately KEPT here (seller's own snapshots, no third-party PII;
    // the account-deletion pipeline removes it wholesale later).
    await db.collection('listingContacts').deleteMany({ listingId: id });
    // Seller's „Anfrage" and moderation rows for this listing.
    await purgeNotificationsFor(db, [id]);

    // A pending report/flag on now-deleted content stays in the moderation
    // queue, marked deleted (still strikeable from the stored snapshot).
    await db.collection('flaggedContent').updateMany(
      { contentId: id, contentType: 'marketplace' },
      { $set: { contentDeleted: true, contentDeletedAt: new Date() } }
    );

    return new Response(
      JSON.stringify({ message: 'Listing deleted successfully' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Listing deletion error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
