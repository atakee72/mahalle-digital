import type { APIRoute } from 'astro';
import { connectDB } from '../../../lib/mongodb';
import { checkDailyLimit, limitReachedResponse } from '../../../lib/limits/dailyLimit';
import type { Listing } from '../../../types/listing';
import type { FlaggedContent } from '../../../types';
import { ListingCreateSchema } from '../../../schemas/listing.schema';
import { parseRequestBody } from '../../../schemas/validation.utils';
import { moderatePost, checkSpamWithGPT, checkImagesWithGPT, createFlaggedContentRecord, mergeModerationResults } from '../../../lib/moderation';
import { requireMemberSession } from '../../../lib/auth';
import { alertContentNew, alertModerationFlagged } from '../../../lib/adminAlerts';

export const POST: APIRoute = async ({ request }) => {
  try {
    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { session, userId } = gate;

    // Daily limit (listings bucket, rolling 24h; drafts do not count).
    const db = await connectDB();
    const listingsCollection = db.collection<Listing>('listings');
    const limit = await checkDailyLimit(db, { userId, role: session.user.role }, 'listings');
    // The marketplace composer shows this server message as it comes — keep the draft hint.
    if (!limit.allowed) return limitReachedResponse('listings', limit, ' or save as a draft');

    // Validate request body with Zod
    const validation = await parseRequestBody(request, ListingCreateSchema);

    if (!validation.success) {
      return validation.response;
    }

    const { title, description, descriptionPlainText, listingType, exchangeFor, category, condition, price, originalPrice, images, delivery, specs } = validation.data;

    // Force price=0 for exchange and gift listings. For 'sell' the schema's
    // superRefine guarantees a price, but it's typed optional now — `?? 0` is a
    // never-hit fallback that satisfies the type (a sell without price is
    // rejected upstream).
    const finalPrice = (listingType === 'exchange' || listingType === 'gift') ? 0 : (price ?? 0);
    const finalOriginalPrice = (listingType === 'exchange' || listingType === 'gift') ? undefined : (originalPrice || undefined);

    // Admins are exempt from AI moderation (their content is auto-approved —
    // they run the review queue). Skips the OpenAI calls entirely.
    const skipModeration = session.user.role === 'admin';

    let mergedResult: ReturnType<typeof mergeModerationResults> = null;
    let moderationStatus: 'approved' | 'pending' = 'approved';
    if (!skipModeration) {
      // Run all moderation checks in parallel: text safety, spam check, and image safety (GPT-4o vision)
      const contentText = `${title}\n\n${descriptionPlainText}`;
      const [moderationResult, spamResult, imageResult] = await Promise.all([
        moderatePost(contentText, images),
        checkSpamWithGPT(contentText, 'neighborhood marketplace listing'),
        checkImagesWithGPT(images)
      ]);

      // All checks must pass for auto-approval
      moderationStatus = (moderationResult.canPublish && spamResult.canPublish && imageResult.canPublish) ? 'approved' : 'pending';
      mergedResult = mergeModerationResults(moderationResult, spamResult, imageResult);
    }

    // Create new listing
    const newListing: Omit<Listing, '_id'> = {
      title,
      description,
      descriptionPlainText, // Plain text version for search
      listingType: listingType || 'sell',
      exchangeFor: listingType === 'exchange' ? (exchangeFor || undefined) : undefined,
      category,
      condition,
      price: finalPrice,
      originalPrice: finalOriginalPrice,
      images,
      delivery,
      specs: specs ?? undefined,
      sellerId: userId,
      status: 'available',
      moderationStatus,
      views: 0,
      savedBy: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await listingsCollection.insertOne(newListing as Listing);

    // Create a single combined flagged content record if any check failed
    if (mergedResult) {
      const flaggedCollection = db.collection<FlaggedContent>('flaggedContent');
      const authorInfo = {
        id: userId,
        name: session.user.name || undefined,
        email: session.user.email || undefined
      };
      const contentInfo = { title, body: descriptionPlainText, imageUrls: images };
      const flaggedRecord = createFlaggedContentRecord('marketplace', contentInfo, authorInfo, mergedResult);
      flaggedRecord.contentId = result.insertedId.toString();
      await flaggedCollection.insertOne(flaggedRecord as FlaggedContent);
    }

    // Operational admin alert (never-throw, no-op without env). Admin's own
    // posts are exempt from moderation AND from self-alerting.
    if (!skipModeration) {
      if (mergedResult) {
        await alertModerationFlagged({ contentType: 'marketplace', title, authorName: session.user.name });
      } else {
        await alertContentNew({ type: 'marketplace', title, authorName: session.user.name, pending: moderationStatus === 'pending' });
      }
    }

    // No seller lookup: the only caller (MarketComposeInner) reads just
    // `moderationStatus` off this response and redirects. Every read path
    // joins seller identity live via populateSellers (src/lib/listingsQuery.ts).
    const createdListing = {
      ...newListing,
      _id: result.insertedId
    };

    // Return appropriate response based on moderation results
    if (mergedResult) {
      return new Response(
        JSON.stringify({
          listing: createdListing,
          message: mergedResult.userMessage,
          moderationStatus: 'pending'
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify({
        listing: createdListing,
        message: 'Listing created successfully'
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Listing creation error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
