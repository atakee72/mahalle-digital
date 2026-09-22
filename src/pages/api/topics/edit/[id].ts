import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../../../lib/mongodb';
import { resolveMentions, notifyMentions, applyBroadcast, notifyAdminHint } from '../../../../lib/mentions/mentionsStore';
import { moderationTarget } from '../../../../lib/notifications';
import { invalidateKiezKontext } from '../../../../lib/kiez/kontext';
import { ObjectId } from 'mongodb';
import type { Topic, EditHistory, FlaggedContent } from '../../../../types';
import { TopicCreateSchema } from '../../../../schemas/forum.schema';
import { parseRequestBody } from '../../../../schemas/validation.utils';
import { isOwner } from '../../../../utils/authHelpers';
import { moderateText, checkSpamWithGPT, checkImagesWithGPT, createFlaggedContentRecord, mergeModerationResults } from '../../../../lib/moderation';
import { rejectIfBanned } from '../../../../lib/auth/banGuard';
import { alertModerationFlagged } from '../../../../lib/adminAlerts';

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
    const topicId = params.id;

    if (!topicId || !ObjectId.isValid(topicId)) {
      return new Response(JSON.stringify({ error: 'Invalid topic ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate request body with Zod
    const validation = await parseRequestBody(request, TopicCreateSchema);

    if (!validation.success) {
      return validation.response;
    }

    const { title, body, tags, images } = validation.data;

    // „@alle" Admin-Hinweis (2026-09-22): admin-only broadcast. TopicCreateSchema
    // requires `body`, so it is always a string here (unlike the announcement/
    // recommendation edit routes, which use a `.partial()` schema).
    const isAdmin = session.user.role === 'admin';
    const { body: cleanBody, broadcast: newBroadcast } = applyBroadcast(body, isAdmin);

    // Connect to database
    const db = await connectDB();
    const topicsCollection = db.collection<Topic>('topics');

    // Find the existing topic
    const existingTopic = await topicsCollection.findOne({ _id: new ObjectId(topicId) });

    if (!existingTopic) {
      return new Response(JSON.stringify({ error: 'Topic not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if user is the author
    if (!isOwner(existingTopic.author, userId)) {
      return new Response(JSON.stringify({ error: 'You can only edit your own topics' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Block edits while the post is under moderation (AI-flagged
    // pending OR community-reported pending OR rejected) and on
    // approved-with-warning posts. Mirrors the comment-edit gate at
    // /api/comments/edit/[commentId].ts:71-76. Reason: in-review
    // content shouldn't be silently rewritten while moderators are
    // looking at the original, and warning-labelled content shouldn't
    // bypass its label via an edit. Author can delete + recreate if
    // they want to amend.
    if (existingTopic.moderationStatus !== 'approved' || existingTopic.hasWarningLabel) {
      return new Response(JSON.stringify({ error: 'edit_blocked_by_moderation' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Admins are exempt from AI moderation (their content is auto-approved —
    // they run the review queue). Skips the OpenAI calls entirely.
    const skipModeration = session.user.role === 'admin';

    let mergedModerationResult: ReturnType<typeof mergeModerationResults> = null;
    if (!skipModeration) {
      // Run content moderation on edited content (FAIL-SAFE: queues for review on any error).
      // Mirrors the create-path checks: moderateText + checkSpamWithGPT + tag moderation + image moderation.
      const contentText = `${title}\n\n${cleanBody}`;
      const moderationChecks: Promise<any>[] = [
        moderateText(contentText),
        checkSpamWithGPT(contentText, 'neighborhood community forum post')
      ];
      if (tags?.length) {
        moderationChecks.push(moderateText(tags.join(' ')));
      }
      if (images?.length) {
        moderationChecks.push(checkImagesWithGPT(images.map(img => img.url)));
      }

      const [mainModerationResult, spamResult, tagsModerationResult, imageModerationResult] = await Promise.all(moderationChecks);

      // Merge all moderation results
      const resultsToMerge = [mainModerationResult, spamResult];
      if (tagsModerationResult) resultsToMerge.push(tagsModerationResult);
      if (imageModerationResult) resultsToMerge.push(imageModerationResult);
      mergedModerationResult = mergeModerationResults(...resultsToMerge);
    }

    // Determine new moderation status
    const newModerationStatus = mergedModerationResult
      ? 'pending'
      : existingTopic.moderationStatus || 'approved';

    // Create edit history entry
    const editHistoryEntry: EditHistory = {
      originalTitle: existingTopic.title,
      originalBody: existingTopic.body,
      editedAt: new Date(),
      editedBy: userId
    };

    // Build update data
    const updateData: Record<string, any> = {
      title,
      body: cleanBody,
      tags: tags || [],
      images: images || [],
      isEdited: true,
      lastEditedAt: new Date(),
      updatedAt: new Date(),
      moderationStatus: newModerationStatus,
      // „@handle" mentions are re-resolved on every save (src/lib/mentions).
      mentions: await resolveMentions(db, cleanBody)
    };

    // Clear rejection reason if going back to pending (new review needed)
    if (newModerationStatus === 'pending') {
      updateData.rejectionReason = null;
    }

    if (newBroadcast) {
      updateData.broadcast = {
        ...newBroadcast,
        notifiedAt: existingTopic.broadcast?.notifiedAt,
        recipients: existingTopic.broadcast?.recipients,
      };
    }
    const unsetFields: Record<string, ''> = {};
    if (newBroadcast === null && existingTopic.broadcast) {
      unsetFields.broadcast = '';
    }

    // Update the topic with edit history
    const updateResult = await topicsCollection.findOneAndUpdate(
      { _id: new ObjectId(topicId) },
      {
        $set: updateData,
        $push: {
          editHistory: editHistoryEntry
        },
        ...(Object.keys(unsetFields).length ? { $unset: unsetFields } : {})
      },
      { returnDocument: 'after' }
    );

    // If content was flagged during edit, create a new flagged content record
    if (mergedModerationResult) {
      const flaggedCollection = db.collection<FlaggedContent>('flaggedContent');
      const flaggedRecord = createFlaggedContentRecord(
        'topic',
        { title, body: cleanBody, tags },
        {
          id: userId,
          name: session.user.name || undefined,
          email: session.user.email || undefined
        },
        mergedModerationResult
      );
      flaggedRecord.contentId = topicId;
      await flaggedCollection.insertOne(flaggedRecord as FlaggedContent);
      await alertModerationFlagged({ contentType: 'topic', title, authorName: session.user.name });
    }

    if (!updateResult) {
      return new Response(JSON.stringify({ error: 'Failed to update topic' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Newly added mentions notify only while the topic is public; an edit that
    // fell back to pending is picked up on approval. Idempotent, never throws.
    if (newModerationStatus === 'approved') {
      await notifyMentions(db, {
        actorId: userId, mentions: updateData.mentions, sourceId: String(topicId), kind: 'post',
        target: moderationTarget('topic', String(topicId), title),
      });
      if (newBroadcast && !existingTopic.broadcast?.notifiedAt) {
        const n = await notifyAdminHint(db, {
          actorId: userId, sourceId: String(topicId), kind: 'post',
          target: moderationTarget('topic', String(topicId), title),
          excludedHandles: newBroadcast.excludedHandles,
        });
        await topicsCollection.updateOne(
          { _id: new ObjectId(topicId) },
          { $set: { 'broadcast.notifiedAt': new Date(), 'broadcast.recipients': n } }
        );
      }
    }

    // Invalidate Kiez-Daten Anwohner-Kontext cache in case the topic title changed
    await invalidateKiezKontext();

    // Construct author object from session
    const author = {
      _id: userId,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
      roleBadge: 'resident'
    };

    const updatedTopic = {
      ...updateResult,
      author
    };

    // Return appropriate response based on moderation result
    if (mergedModerationResult) {
      return new Response(
        JSON.stringify({
          topic: updatedTopic,
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
        topic: updatedTopic,
        message: 'Topic updated successfully'
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Topic update error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};