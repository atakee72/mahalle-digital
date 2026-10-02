import type { APIRoute } from 'astro';
import { connectDB } from '../../../lib/mongodb';
import { ObjectId } from 'mongodb';
import type { Listing } from '../../../types/listing';
import { ListingDraftSchema } from '../../../schemas/listing.schema';
import { parseRequestBody } from '../../../schemas/validation.utils';
import { requireMemberSession } from '../../../lib/auth';

export const POST: APIRoute = async ({ request }) => {
  try {
    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { userId } = gate;

    // Validate with relaxed draft schema (only title required)
    const validation = await parseRequestBody(request, ListingDraftSchema);

    if (!validation.success) {
      return validation.response;
    }

    const { draftId, title, description, descriptionPlainText, listingType, exchangeFor, category, condition, price, originalPrice, images, delivery, specs } = validation.data;

    const db = await connectDB();
    const listingsCollection = db.collection<Listing>('listings');

    // If draftId provided, update existing draft
    if (draftId) {
      const existing = await listingsCollection.findOne({ _id: new ObjectId(draftId) });

      if (!existing) {
        return new Response(JSON.stringify({ error: 'Draft not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (existing.sellerId.toString() !== userId) {
        return new Response(JSON.stringify({ error: 'Not authorized to edit this draft' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (existing.status !== 'draft') {
        return new Response(JSON.stringify({ error: 'This listing is not a draft' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      await listingsCollection.updateOne(
        { _id: new ObjectId(draftId) },
        {
          $set: {
            title,
            ...(description && { description }),
            ...(descriptionPlainText && { descriptionPlainText }),
            listingType: listingType || 'sell',
            ...(exchangeFor && { exchangeFor }),
            ...(category && { category }),
            ...(condition && { condition }),
            ...(price !== undefined && { price }),
            ...(originalPrice !== undefined && { originalPrice }),
            images: images || [],
            ...(delivery !== undefined && { delivery }),
            ...(specs !== undefined && { specs }),
            updatedAt: new Date()
          }
        }
      );

      return new Response(
        JSON.stringify({ draftId, message: 'Draft updated successfully' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create new draft — no moderation, no daily limit
    const newDraft: Omit<Listing, '_id'> = {
      title,
      description: description || '',
      descriptionPlainText: descriptionPlainText || '',
      listingType: listingType || 'sell',
      exchangeFor: listingType === 'exchange' ? (exchangeFor || undefined) : undefined,
      category: category || ('' as any),
      condition: condition || ('' as any),
      price: price || 0,
      originalPrice: originalPrice || undefined,
      images: images || [],
      delivery: delivery ?? undefined,
      specs: specs ?? undefined,
      sellerId: userId,
      status: 'draft',
      views: 0,
      savedBy: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await listingsCollection.insertOne(newDraft as Listing);

    return new Response(
      JSON.stringify({ draftId: result.insertedId.toString(), message: 'Draft saved successfully' }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Draft save error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
