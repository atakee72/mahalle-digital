
import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { connectDB } from '../../../../lib/mongodb';
import { resolveMentions, notifyMentions, applyBroadcast, notifyAdminHint } from '../../../../lib/mentions/mentionsStore';
import { moderationTarget } from '../../../../lib/notifications';
import { ObjectId } from 'mongodb';
import type { Announcement, EditHistory } from '../../../../types';
import { AnnouncementUpdateSchema } from '../../../../schemas/forum.schema';
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
    const announcementId = params.id;

    if (!announcementId || !ObjectId.isValid(announcementId)) {
      return new Response(JSON.stringify({ error: 'Invalid announcement ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const validation = await parseRequestBody(request, AnnouncementUpdateSchema);

    if (!validation.success) {
      return validation.response;
    }

    const { title, body, tags, images } = validation.data;

    const db = await connectDB();
    const announcementsCollection = db.collection<Announcement>('announcements');

    const existingAnnouncement = await announcementsCollection.findOne({ _id: new ObjectId(announcementId) });

    if (!existingAnnouncement) {
      return new Response(JSON.stringify({ error: 'Announcement not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!isOwner(existingAnnouncement.author, userId)) {
      return new Response(JSON.stringify({ error: 'You can only edit your own announcements' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Block edits while the announcement is under moderation
    // (pending) or carries a warning label. Mirrors the comment-edit
    // and topic-edit gates. Admin official announcements use the
    // separate /api/admin/announcements/[id] PATCH endpoint and skip
    // this gate (officials are always 'approved').
    if (existingAnnouncement.moderationStatus !== 'approved' || existingAnnouncement.hasWarningLabel) {
      return new Response(JSON.stringify({ error: 'edit_blocked_by_moderation' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const editHistoryEntry: EditHistory = {
      originalTitle: existingAnnouncement.title,
      originalBody: existingAnnouncement.body || '',
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
        notifiedAt: existingAnnouncement.broadcast?.notifiedAt,
        recipients: existingAnnouncement.broadcast?.recipients,
      };
    }
    const unsetFields: Record<string, ''> = {};
    if (newBroadcast === null && existingAnnouncement.broadcast) {
      unsetFields.broadcast = '';
    }

    const updateResult = await announcementsCollection.findOneAndUpdate(
      { _id: new ObjectId(announcementId) },
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
      return new Response(JSON.stringify({ error: 'Failed to update announcement' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // The gate above guarantees the post is public → newly added mentions notify
    // right away. Idempotent (already-notified members are skipped), never throws.
    await notifyMentions(db, {
      actorId: userId, mentions, sourceId: String(announcementId), kind: 'post',
      target: moderationTarget('announcement', String(announcementId), title ?? ''),
    });

    if (newBroadcast && !existingAnnouncement.broadcast?.notifiedAt) {
      const n = await notifyAdminHint(db, {
        actorId: userId, sourceId: String(announcementId), kind: 'post',
        target: moderationTarget('announcement', String(announcementId), title ?? ''),
        excludedHandles: newBroadcast.excludedHandles,
      });
      await announcementsCollection.updateOne(
        { _id: new ObjectId(announcementId) },
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

    const updatedAnnouncement = {
      ...updateResult,
      author
    };

    return new Response(
      JSON.stringify({
        announcement: updatedAnnouncement,
        message: 'Announcement updated successfully'
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Announcement update error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
