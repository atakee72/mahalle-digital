import type { APIRoute } from 'astro';
import { connectDB } from '../../../../lib/mongodb';
import { ObjectId } from 'mongodb';
import type { Listing } from '../../../../types/listing';
import type { FlaggedContent, ListingAuditTrail } from '../../../../types';
import { ListingUpdateSchema } from '../../../../schemas/listing.schema';
import { parseRequestBody, isValidObjectId } from '../../../../schemas/validation.utils';
import { moderatePost, checkSpamWithGPT, checkImagesWithGPT, createFlaggedContentRecord, mergeModerationResults } from '../../../../lib/moderation';
import { canMutateListing } from '../../../../lib/listingActions';
import { requireMemberSession } from '../../../../lib/auth';
import { alertModerationFlagged } from '../../../../lib/adminAlerts';

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { session, userId } = gate;

    const { id } = params;

    if (!id || !isValidObjectId(id)) {
      return new Response(JSON.stringify({ error: 'Invalid listing ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = await connectDB();
    const listingsCollection = db.collection<Listing>('listings');

    // Check if listing exists and belongs to user
    const existingListing = await listingsCollection.findOne({ _id: new ObjectId(id) });

    if (!existingListing) {
      return new Response(JSON.stringify({ error: 'Listing not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Warning-labeled listings are editable (the re-moderation pipeline below is
    // the safety net — see marketplace CLAUDE.md "Bump — no rate limit" section).
    // If the existing listing has a warning, we write a pre-edit audit snapshot
    // below before the moderation re-run, so the warning state immediately prior
    // to the edit is provable in the listingAuditTrail collection.
    // Allow editing on warning-labeled AND rejected listings. The re-moderation
    // pipeline below is the safety net (any dirty content re-flags); a pre-edit
    // audit snapshot is written to listingAuditTrail before the re-mod, so the
    // pre-edit warning/rejection state is provable. See marketplace CLAUDE.md.
    const guard = canMutateListing(existingListing, userId, {
      allowOnWarningLabel: true,
      allowOnRejected: true,
    });
    if (!guard.ok) {
      const status = guard.reason === 'not_owner' ? 403 : 409;
      const errorCode = guard.reason === 'not_owner' ? 'forbidden' : `edit_blocked_${guard.reason}`;
      return new Response(JSON.stringify({ error: errorCode }), {
        status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate request body
    const validation = await parseRequestBody(request, ListingUpdateSchema);

    if (!validation.success) {
      return validation.response;
    }

    const updateData: Record<string, any> = {
      ...validation.data,
      updatedAt: new Date()
    };

    // If changing to exchange or gift, force price=0
    if (updateData.listingType === 'exchange' || updateData.listingType === 'gift') {
      updateData.price = 0;
      updateData.originalPrice = undefined;
    } else if (updateData.listingType === 'sell') {
      updateData.exchangeFor = undefined;
    }

    // Re-run moderation if content or images changed
    const contentChanged = updateData.title || updateData.description || updateData.descriptionPlainText || updateData.images;
    if (contentChanged) {
      // Pre-edit audit snapshot. If the existing listing has a warning label OR
      // was rejected, freeze its content + warning/rejection state into the
      // listingAuditTrail collection BEFORE running moderation + writing the new
      // content. Provable record of the moderation state immediately prior to
      // the edit (the (c) block below auto-clears those fields on clean re-mod).
      // Edge: if the updateOne after the moderation re-run fails (DB hiccup),
      // the audit snapshot exists for an edit that never persisted — cross-check
      // with the listing's updatedAt to disambiguate.
      const wasRejected = existingListing.moderationStatus === 'rejected';
      const hadWarning = !!existingListing.hasWarningLabel;
      if (wasRejected || hadWarning) {
        // Defensive priority: if a listing is somehow both rejected AND warning-
        // labeled (shouldn't happen in normal flow), the audit event reflects
        // the rejection — the stronger signal.
        const event: ListingAuditTrail['event'] = wasRejected
          ? 'edit_rejection_cleared'
          : 'edit_warning_cleared';

        const audit: Omit<ListingAuditTrail, '_id'> = {
          listingId: id,
          event,
          editedAt: new Date(),
          editedBy: userId,
          preEditTitle: existingListing.title,
          preEditBody: existingListing.descriptionPlainText,
          preEditImages: existingListing.images,
          hadWarningLabel: hadWarning,
          preEditWarningText: hadWarning ? existingListing.warningText : undefined,
          preEditModerationStatus: wasRejected ? 'rejected' : undefined,
          preEditRejectionReason: wasRejected ? existingListing.rejectionReason : undefined,
          createdAt: new Date(),
        };
        await db
          .collection<ListingAuditTrail>('listingAuditTrail')
          .insertOne(audit as ListingAuditTrail);
      }

      const title = updateData.title || existingListing.title;
      const plainText = updateData.descriptionPlainText || existingListing.descriptionPlainText || '';
      const images = updateData.images || existingListing.images;

      // Admins are exempt from AI moderation (their content is auto-approved —
      // they run the review queue). Skips the OpenAI calls entirely; the audit
      // snapshot above still runs (provenance, not moderation).
      const skipModeration = session.user.role === 'admin';

      let mergedResult: ReturnType<typeof mergeModerationResults> = null;
      if (!skipModeration) {
        const contentText = `${title}\n\n${plainText}`;

        // Run all moderation checks in parallel: text safety, spam check, and image safety
        const [moderationResult, spamResult, imageResult] = await Promise.all([
          moderatePost(contentText, images),
          checkSpamWithGPT(contentText, 'neighborhood marketplace listing'),
          checkImagesWithGPT(images)
        ]);

        mergedResult = mergeModerationResults(moderationResult, spamResult, imageResult);
      }
      if (mergedResult) {
        updateData.moderationStatus = 'pending';
        // Re-flagged: leave hasWarningLabel + warningText alone (old warning
        // persists until admin reviews the new pending record — matches existing
        // behavior). If the listing WAS rejected, clear its rejectionReason —
        // the old reason is stale; admin sees the new flag fresh in the queue.
        if (wasRejected) {
          updateData.rejectionReason = null;
        }

        const authorInfo = {
          id: userId,
          name: session.user.name || undefined,
          email: session.user.email || undefined
        };
        const contentInfo = { title, body: plainText, imageUrls: images };

        const flaggedCollection = db.collection<FlaggedContent>('flaggedContent');
        const flaggedRecord = createFlaggedContentRecord('marketplace', contentInfo, authorInfo, mergedResult);
        flaggedRecord.contentId = id;
        await flaggedCollection.insertOne(flaggedRecord as FlaggedContent);
        await alertModerationFlagged({ contentType: 'marketplace', title, authorName: session.user.name });
      } else {
        updateData.moderationStatus = 'approved';
        // Clean re-moderation. isUserReported is INTENTIONALLY not cleared in
        // either branch — user reports are independent of AI moderation; admin
        // clears them via /admin/moderation.
        if (hadWarning) {
          updateData.hasWarningLabel = false;
          updateData.warningText = null;
        }
        if (wasRejected) {
          updateData.rejectionReason = null;
          // moderationStatus is already being set to 'approved' above.
        }
      }
    }

    await listingsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    const updatedListing = await listingsCollection.findOne({ _id: new ObjectId(id) });

    return new Response(
      JSON.stringify({
        listing: updatedListing,
        message: 'Listing updated successfully'
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Listing update error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
