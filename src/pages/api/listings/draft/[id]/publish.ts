import type { APIRoute } from 'astro';
import { connectDB } from '../../../../../lib/mongodb';
import { ObjectId } from 'mongodb';
import type { Listing } from '../../../../../types/listing';
import type { FlaggedContent } from '../../../../../types';
import { isValidObjectId } from '../../../../../schemas/validation.utils';
import { moderatePost, checkSpamWithGPT, checkImagesWithGPT, createFlaggedContentRecord, mergeModerationResults } from '../../../../../lib/moderation';
import { requireMemberSession } from '../../../../../lib/auth';
import { alertContentNew, alertModerationFlagged } from '../../../../../lib/adminAlerts';

export const POST: APIRoute = async ({ request, params }) => {
  try {
    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { session, userId } = gate;

    const { id } = params;

    if (!id || !isValidObjectId(id)) {
      return new Response(JSON.stringify({ error: 'Invalid draft ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = await connectDB();
    const listingsCollection = db.collection<Listing>('listings');

    // Fetch the draft
    const draft = await listingsCollection.findOne({ _id: new ObjectId(id) });

    if (!draft) {
      return new Response(JSON.stringify({ error: 'Draft not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (draft.sellerId.toString() !== userId) {
      return new Response(JSON.stringify({ error: 'Not authorized to publish this draft' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (draft.status !== 'draft') {
      return new Response(JSON.stringify({ error: 'This listing has already been published' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate draft has all required fields for publishing
    const needsPrice = draft.listingType !== 'exchange' && draft.listingType !== 'gift';
    const priceInvalid = needsPrice && (!draft.price || draft.price <= 0);
    if (!draft.title || !draft.descriptionPlainText || !draft.category || !draft.images?.length || !draft.delivery || priceInvalid) {
      const missing = [];
      if (!draft.title) missing.push('title');
      if (!draft.descriptionPlainText) missing.push('description');
      if (!draft.category) missing.push('category');
      if (!draft.images?.length) missing.push('at least one image');
      if (!draft.delivery) missing.push('delivery method');
      if (priceInvalid) missing.push('price');

      return new Response(JSON.stringify({
        error: 'Draft is incomplete',
        message: `Please complete the following before publishing: ${missing.join(', ')}`,
        missingFields: missing
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check daily limit (publishing counts toward limit)
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const todayCount = await listingsCollection.countDocuments({
      sellerId: userId,
      createdAt: { $gte: dayAgo },
      status: { $ne: 'draft' }
    });

    // Admins are exempt from the daily limit (they post official content in bursts).
    if (session.user.role !== 'admin' && todayCount >= 5) {
      return new Response(JSON.stringify({
        error: 'Daily listing limit reached',
        message: 'You can publish up to 5 listings per day. Please try again tomorrow.',
        dailyLimit: 5,
        currentCount: todayCount
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Admins are exempt from AI moderation (their content is auto-approved —
    // they run the review queue). Skips the OpenAI calls entirely.
    const skipModeration = session.user.role === 'admin';

    let mergedResult: ReturnType<typeof mergeModerationResults> = null;
    let moderationStatus: 'approved' | 'pending' = 'approved';
    if (!skipModeration) {
      // Run full moderation pipeline
      const contentText = `${draft.title}\n\n${draft.descriptionPlainText}`;
      const [moderationResult, spamResult, imageResult] = await Promise.all([
        moderatePost(contentText, draft.images),
        checkSpamWithGPT(contentText, 'neighborhood marketplace listing'),
        checkImagesWithGPT(draft.images)
      ]);

      moderationStatus = (moderationResult.canPublish && spamResult.canPublish && imageResult.canPublish) ? 'approved' : 'pending';
      mergedResult = mergeModerationResults(moderationResult, spamResult, imageResult);
    }

    // Update draft → published
    await listingsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: 'available',
          moderationStatus,
          updatedAt: new Date()
        }
      }
    );

    // Create flagged content record if any check failed
    if (mergedResult) {
      const flaggedCollection = db.collection<FlaggedContent>('flaggedContent');
      const authorInfo = {
        id: userId,
        name: session.user.name || undefined,
        email: session.user.email || undefined
      };
      const contentInfo = { title: draft.title, body: draft.descriptionPlainText, imageUrls: draft.images };
      const flaggedRecord = createFlaggedContentRecord('marketplace', contentInfo, authorInfo, mergedResult);
      flaggedRecord.contentId = id;
      await flaggedCollection.insertOne(flaggedRecord as FlaggedContent);
    }

    // Operational admin alert (never-throw, no-op without env). Admin's own
    // posts are exempt from moderation AND from self-alerting.
    if (!skipModeration) {
      if (mergedResult) {
        await alertModerationFlagged({ contentType: 'marketplace', title: draft.title, authorName: session.user.name });
      } else {
        await alertContentNew({ type: 'marketplace', title: draft.title, authorName: session.user.name, pending: moderationStatus === 'pending' });
      }
    }

    return new Response(
      JSON.stringify({
        message: moderationStatus === 'pending'
          ? 'Your listing has been submitted and is under review.'
          : 'Listing published successfully!',
        moderationStatus
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Draft publish error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
