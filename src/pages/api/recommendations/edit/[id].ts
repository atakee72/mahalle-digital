
import type { APIRoute } from 'astro';
import { connectDB } from '../../../../lib/mongodb';
import { resolveMentions, notifyMentions, applyBroadcast, notifyAdminHint } from '../../../../lib/mentions/mentionsStore';
import { moderationTarget } from '../../../../lib/notifications';
import { ObjectId } from 'mongodb';
import type { Recommendation, EditHistory, FlaggedContent } from '../../../../types';
import { RecommendationUpdateSchema } from '../../../../schemas/forum.schema';
import { parseRequestBody } from '../../../../schemas/validation.utils';
import { isOwner } from '../../../../utils/authHelpers';
import { requireMemberSession } from '../../../../lib/auth';
import { moderateText, checkSpamWithGPT, checkImagesWithGPT, createFlaggedContentRecord, mergeModerationResults } from '../../../../lib/moderation';
import { alertModerationFlagged } from '../../../../lib/adminAlerts';

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { session, userId } = gate;
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

    // Mirrors topics/edit since 2026-10-31 — these two edit routes ran no moderation before.
    // Admins are exempt (auto-approved); body may be omitted, then the stored one is checked.
    let mergedModerationResult: ReturnType<typeof mergeModerationResults> = null;
    if (session.user.role !== 'admin') {
      const contentText = `${title}\n\n${cleanBody ?? existingRecommendation.body ?? ''}`;
      const moderationChecks: Promise<any>[] = [
        moderateText(contentText),
        checkSpamWithGPT(contentText, 'neighborhood community forum post')
      ];
      if (tags?.length) moderationChecks.push(moderateText(tags.join(' ')));
      if (images?.length) moderationChecks.push(checkImagesWithGPT(images.map(img => img.url)));
      const results = (await Promise.all(moderationChecks)).filter(Boolean);
      mergedModerationResult = mergeModerationResults(...results);
    }
    const newModerationStatus = mergedModerationResult ? 'pending' : existingRecommendation.moderationStatus || 'approved';

    const setFields: Record<string, any> = {
      title,
      body: cleanBody,
      description: cleanBody,
      tags: tags || [],
      images: images || [],
      mentions,
      isEdited: true,
      lastEditedAt: new Date(),
      updatedAt: new Date(),
      moderationStatus: newModerationStatus
    };
    if (newModerationStatus === 'pending') setFields.rejectionReason = null;
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

    if (mergedModerationResult) {
      const flaggedRecord = createFlaggedContentRecord(
        'recommendation',
        { title, body: cleanBody ?? existingRecommendation.body, tags },
        { id: userId, name: session.user.name || undefined, email: session.user.email || undefined },
        mergedModerationResult
      );
      flaggedRecord.contentId = recommendationId;
      await db.collection<FlaggedContent>('flaggedContent').insertOne(flaggedRecord as FlaggedContent);
      await alertModerationFlagged({ contentType: 'recommendation', title: title ?? '', authorName: session.user.name });
    }

    // Newly added mentions notify only while the post is public (an edit that fell
    // back to pending is picked up on approval). Idempotent (already-notified members are skipped), never throws.
    if (newModerationStatus === 'approved') await notifyMentions(db, {
      actorId: userId, mentions, sourceId: String(recommendationId), kind: 'post',
      target: moderationTarget('recommendation', String(recommendationId), title ?? ''),
    });

    if (newModerationStatus === 'approved' && newBroadcast && !existingRecommendation.broadcast?.notifiedAt) {
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

    // Flagged edit: say so, like topic edits do
    if (mergedModerationResult) {
      return new Response(
        JSON.stringify({
          recommendation: updatedRecommendation,
          message: mergedModerationResult.userMessage,
          moderationStatus: 'pending'
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

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
