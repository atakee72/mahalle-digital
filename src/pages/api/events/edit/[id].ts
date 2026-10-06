import type { APIRoute } from 'astro';
import { connectDB } from '../../../../lib/mongodb';
import { ObjectId } from 'mongodb';
import type { Event, EditHistory, FlaggedContent } from '../../../../types';
import { EventUpdateSchema } from '../../../../schemas/forum.schema';
import { parseRequestBody } from '../../../../schemas/validation.utils';
import { isOwner } from '../../../../utils/authHelpers';
import {
  moderateText,
  checkSpamWithGPT,
  createFlaggedContentRecord,
  mergeModerationResults
} from '../../../../lib/moderation';
import { requireMemberSession } from '../../../../lib/auth';
import { alertModerationFlagged } from '../../../../lib/adminAlerts';
import { moveChange, originalStart } from '../../../../lib/calendar/eventMove';
import { tellAboutMove } from '../../../../lib/calendar/eventMoveNotify';

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { session, userId } = gate;
    const eventId = params.id;

    if (!eventId || !ObjectId.isValid(eventId)) {
      return new Response(JSON.stringify({ error: 'Invalid event ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const validation = await parseRequestBody(request, EventUpdateSchema);

    if (!validation.success) {
      return validation.response;
    }

    const { title, body, startDate, endDate, location, category, capacity, allDay, visibility, tags } = validation.data;

    const db = await connectDB();
    const eventsCollection = db.collection<Event>('events');

    const existingEvent = await eventsCollection.findOne({ _id: new ObjectId(eventId) });

    if (!existingEvent) {
      return new Response(JSON.stringify({ error: 'Event not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!isOwner(existingEvent.author, userId)) {
      return new Response(JSON.stringify({ error: 'You can only edit your own events' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Block edits while the event is under moderation or warning-labelled.
    // Mirrors the topics-edit gate at /api/topics/edit/[id].ts. Author can
    // delete + recreate if they want to amend.
    if (existingEvent.moderationStatus !== 'approved' || existingEvent.hasWarningLabel) {
      return new Response(JSON.stringify({ error: 'edit_blocked_by_moderation' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Re-run moderation on the edited content. Build the same composite
    // string as events/create.ts so the same thresholds apply.
    const nextTitle = title ?? existingEvent.title;
    const nextBody = body ?? existingEvent.body ?? '';
    const nextLocation = location ?? existingEvent.location ?? '';
    const nextTags = tags ?? existingEvent.tags ?? [];
    // Admins are exempt from AI moderation (their content is auto-approved —
    // they run the review queue). Skips the OpenAI calls entirely.
    const skipModeration = session.user.role === 'admin';

    let mergedResult: ReturnType<typeof mergeModerationResults> = null;
    if (!skipModeration) {
      const contentText = `${nextTitle}\n\n${nextBody}\n\n${nextLocation}`;

      const moderationChecks: Promise<any>[] = [
        moderateText(contentText),
        checkSpamWithGPT(contentText, 'neighborhood community event')
      ];
      if (nextTags.length) {
        moderationChecks.push(moderateText(nextTags.join(' ')));
      }

      const [mainModerationResult, spamResult, tagsModerationResult] =
        await Promise.all(moderationChecks);
      const resultsToMerge = [mainModerationResult, spamResult];
      if (tagsModerationResult) resultsToMerge.push(tagsModerationResult);
      mergedResult = mergeModerationResults(...resultsToMerge);
    }

    const editHistoryEntry: EditHistory = {
      originalTitle: existingEvent.title,
      originalBody: existingEvent.body || '',
      editedAt: new Date(),
      editedBy: userId
    };

    // Build update object with only provided fields
    const updateFields: any = {
      isEdited: true,
      lastEditedAt: new Date(),
      updatedAt: new Date()
    };

    if (title !== undefined) updateFields.title = title;
    if (body !== undefined) updateFields.body = body;
    if (startDate !== undefined) updateFields.startDate = new Date(startDate);
    if (endDate !== undefined) updateFields.endDate = new Date(endDate);
    if (location !== undefined) updateFields.location = location;
    if (category !== undefined) updateFields.category = category;
    if (capacity !== undefined) updateFields.capacity = capacity;
    if (allDay !== undefined) updateFields.allDay = allDay;
    if (visibility !== undefined) updateFields.visibility = visibility;
    if (tags !== undefined) updateFields.tags = tags;

    // Flip status back to pending if any check flagged; otherwise stay approved.
    if (mergedResult) {
      updateFields.moderationStatus = 'pending';
      updateFields.rejectionReason = null;
    }

    // „Termin verschoben": did this edit change when or where? (pure rules: lib/calendar/eventMove.ts)
    const moved = moveChange(existingEvent, {
      startDate: updateFields.startDate ?? existingEvent.startDate,
      endDate: updateFields.endDate ?? existingEvent.endDate,
      allDay: allDay ?? existingEvent.allDay,
      location: location ?? existingEvent.location
    });
    // The tag names the FIRST start as „ursprünglich"; an event moved back to it loses the tag.
    let backAtOriginal = false;
    if (moved === 'date' || moved === 'both') {
      const original = originalStart(existingEvent, updateFields.startDate ?? existingEvent.startDate);
      if (original) {
        updateFields.movedAt = new Date();
        updateFields.movedFromStart = original;
      } else {
        backAtOriginal = true;
      }
    }
    // A held edit hides the event, so the notice waits for the admin's approval.
    if (moved && mergedResult) updateFields.moveNoticeOwed = moved;

    const updateResult = await eventsCollection.findOneAndUpdate(
      { _id: new ObjectId(eventId) },
      {
        $set: updateFields,
        $push: {
          editHistory: editHistoryEntry
        },
        ...(backAtOriginal ? { $unset: { movedAt: '', movedFromStart: '' } } : {})
      },
      { returnDocument: 'after' }
    );

    if (!updateResult) {
      return new Response(JSON.stringify({ error: 'Failed to update event' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Everyone who answered or saved the event hears about the move (never throws; a held edit
    // is announced on approval instead).
    if (moved && !mergedResult) {
      await tellAboutMove(db, updateResult, moved, userId);
    }

    // Write a new flagged content record so the admin queue surfaces the edit.
    if (mergedResult) {
      const flaggedCollection = db.collection<FlaggedContent>('flaggedContent');
      const flaggedRecord = createFlaggedContentRecord(
        'event',
        { title: nextTitle, body: nextBody, tags: nextTags },
        {
          id: userId,
          name: session.user.name || undefined,
          email: session.user.email || undefined
        },
        mergedResult
      );
      flaggedRecord.contentId = eventId;
      await flaggedCollection.insertOne(flaggedRecord as FlaggedContent);
      await alertModerationFlagged({ contentType: 'event', title: nextTitle, authorName: session.user.name });
    }

    // Construct author object from session
    const author = {
      _id: userId,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
      roleBadge: 'resident'
    };

    const updatedEvent = {
      ...updateResult,
      author
    };

    if (mergedResult) {
      return new Response(
        JSON.stringify({
          event: updatedEvent,
          message: mergedResult.userMessage,
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
        event: updatedEvent,
        message: 'Event updated successfully'
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Event update error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
