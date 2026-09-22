
import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../../../lib/mongodb';
import { resolveMentions, notifyMentions, applyBroadcast, notifyAdminHint } from '../../../../lib/mentions/mentionsStore';
import { moderationTarget } from '../../../../lib/notifications';
import { ObjectId } from 'mongodb';
import type { Recommendation, EditHistory } from '../../../../types';
import { RecommendationUpdateSchema } from '../../../../schemas/forum.schema';
import { parseRequestBody } from '../../../../schemas/validation.utils';
import { isOwner } from '../../../../utils/authHelpers';
import { rejectIfBanned } from '../../../../lib/auth/banGuard';

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    // Get session from NextAuth
    const session = await getSession(request);

    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized - Please login' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Ban enforcement: banned accounts are read-only (3-strike Sperre).
    const bannedRes = await rejectIfBanned(session.user.id);
    if (bannedRes) return bannedRes;

    const userId = session.user.id;
    const recommendationId = params.id;

    if (!recommendationId || !ObjectId.isValid(recommendationId)) {
      return new Response(JSON.stringify({ error: 'Invalid recommendation ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const validation = await parseRequestBody(request, RecommendationUpdateSchema);

    if (!validation.success) {
      return validation.response;
    }

    const { title, body, tags, images } = validation.data;

    const db = await connectDB();
    const recommendationsCollection = db.collection<Recommendation>('recommendations');

    const existingRecommendation = await recommendationsCollection.findOne({ _id: new ObjectId(recommendationId) });

    if (!existingRecommendation) {
      return new Response(JSON.stringify({ error: 'Recommendation not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!isOwner(existingRecommendation.author, userId)) {
      return new Response(JSON.stringify({ error: 'You can only edit your own recommendations' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Block edits while the recommendation is under moderation
    // (pending) or carries a warning label. Mirrors the comment-edit
    // and topic-edit gates.
    if (existingRecommendation.moderationStatus !== 'approved' || existingRecommendation.hasWarningLabel) {
      return new Response(JSON.stringify({ error: 'edit_blocked_by_moderation' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const editHistoryEntry: EditHistory = {
      originalTitle: existingRecommendation.title,
      originalBody: existingRecommendation.body || '',
      editedAt: new Date(),
      editedBy: userId
    };

    // „@alle" Admin-Hinweis (2026-09-22): admin-only broadcast. body may be
    // omitted on a title-only edit — only parse when it was actually sent.
    const isAdmin = session.user.role === 'admin';
    const bodyProvided = typeof body === 'string';
    const parsedBroadcast = bodyProvided ? applyBroadcast(body, isAdmin) : null;
    const cleanBody = parsedBroadcast ? parsedBroadcast.body : body;
    // undefined = body wasn't sent, don't touch broadcast; null = clear it; object = set it.
    const newBroadcast = parsedBroadcast ? parsedBroadcast.broadcast : undefined;

    // „@handle" mentions are re-resolved on every save (src/lib/mentions).
    const mentions = await resolveMentions(db, cleanBody ?? '');

    const setFields: Record<string, any> = {
      title,
      body: cleanBody,
      description: cleanBody,
      tags: tags || [],
      images: images || [],
      mentions,
      isEdited: true,
      lastEditedAt: new Date(),
      updatedAt: new Date()
    };
    if (newBroadcast) {
      setFields.broadcast = {
        ...newBroadcast,
        notifiedAt: existingRecommendation.broadcast?.notifiedAt,
        recipients: existingRecommendation.broadcast?.recipients,
      };
    }
    const unsetFields: Record<string, ''> = {};
    if (newBroadcast === null && existingRecommendation.broadcast) {
      unsetFields.broadcast = '';
    }

    const updateResult = await recommendationsCollection.findOneAndUpdate(
      { _id: new ObjectId(recommendationId) },
      {
        $set: setFields,
        $push: {
          editHistory: editHistoryEntry
        },
        ...(Object.keys(unsetFields).length ? { $unset: unsetFields } : {})
      },
      { returnDocument: 'after' }
    );

    if (!updateResult) {
      return new Response(JSON.stringify({ error: 'Failed to update recommendation' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // The gate above guarantees the post is public → newly added mentions notify
    // right away. Idempotent (already-notified members are skipped), never throws.
    await notifyMentions(db, {
      actorId: userId, mentions, sourceId: String(recommendationId), kind: 'post',
      target: moderationTarget('recommendation', String(recommendationId), title ?? ''),
    });

    if (newBroadcast && !existingRecommendation.broadcast?.notifiedAt) {
      const n = await notifyAdminHint(db, {
        actorId: userId, sourceId: String(recommendationId), kind: 'post',
        target: moderationTarget('recommendation', String(recommendationId), title ?? ''),
        excludedHandles: newBroadcast.excludedHandles,
      });
      await recommendationsCollection.updateOne(
        { _id: new ObjectId(recommendationId) },
        { $set: { 'broadcast.notifiedAt': new Date(), 'broadcast.recipients': n } }
      );
    }

    // Construct author object from session
    const author = {
      _id: userId,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
      roleBadge: 'resident'
    };

    const updatedRecommendation = {
      ...updateResult,
      author
    };

    return new Response(
      JSON.stringify({
        recommendation: updatedRecommendation,
        message: 'Recommendation updated successfully'
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Recommendation update error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
