// src/lib/calendar/eventMoveNotify.ts — SERVER-ONLY (mongodb, notifications, rate limits).
// Tells the people who plan to come that an event moved. Rules and wording live in the pure
// ./eventMove.ts; this file only reads who is concerned and sends. NEVER-THROW, like every
// notification write: a failed notice must not fail the author's edit or the admin's review.
import { ObjectId, type Db } from 'mongodb';
import * as Sentry from '@sentry/astro';
import { notifyUsers } from '../notifications';
import { consumeRateLimit } from '../auth/rateLimit';
import { mergeChange, moveRecipients, moveTarget, type MoveChange } from './eventMove';
import type { FlaggedContent } from '../../types';

/** Phones are rung for the first three moves of an event per hour; the bell row is ALWAYS written. */
const MOVE_PUSHES_PER_HOUR = 3;

interface MovedEvent {
  _id: unknown;
  title?: string;
  startDate: Date | string;
  endDate: Date | string;
  allDay?: boolean;
  location?: string;
  rsvps?: { going?: unknown[]; maybe?: unknown[] };
}

/**
 * Sends the notice; returns how many members were told. EVERY move reaches the bell — a move that
 * is saved but not shown would leave people with a wrong date. Two things keep an author who
 * corrects (or abuses) the date from flooding people: a member's older UNREAD notice about the
 * same event is removed and folded into the new one (mergeChange), so the bell holds one unread
 * row per event with the CURRENT time and place; and the PUSH is sent for the first
 * MOVE_PUSHES_PER_HOUR moves of an event per hour only — after that the row still updates, silently.
 */
export async function tellAboutMove(db: Db, event: MovedEvent, change: MoveChange, authorId: string): Promise<number> {
  try {
    const eventId = String(event._id);
    const saved = await db.collection('savedEvents').find({ eventId }, { projection: { userId: 1 } }).toArray();
    const recipients = moveRecipients(event.rsvps?.going ?? [], event.rsvps?.maybe ?? [], saved.map((s) => s.userId), authorId);
    if (!recipients.length) return 0;

    const rows = db.collection('notifications');
    const unread = await rows
      .find({ type: 'event_moved', 'target.contentId': eventId, userId: { $in: recipients }, readAt: null }, { projection: { userId: 1, 'meta.change': 1 } })
      .toArray();

    const startISO = new Date(event.startDate).toISOString();
    const base = {
      startISO,
      endISO: new Date(event.endDate).toISOString(),
      allDay: event.allDay === true,
      ...(event.location ? { place: String(event.location) } : {}),
    };
    // The brake counts moves, not members; a bucket failure keeps the phones quiet, never the bell.
    const brake = await consumeRateLimit(`eventmove:${eventId}`, MOVE_PUSHES_PER_HOUR, 60 * 60 * 1000).catch(() => ({ limited: true }));
    // One send per wording (at most three): members with an unread older notice may get „both".
    const byChange = new Map<MoveChange, string[]>();
    for (const userId of recipients) {
      const merged = mergeChange(unread.filter((u) => u.userId === userId).map((u) => u.meta?.change as MoveChange | undefined), change);
      byChange.set(merged, [...(byChange.get(merged) ?? []), userId]);
    }
    let written = true;
    for (const [merged, userIds] of byChange) {
      const ok = await notifyUsers(userIds, {
        type: 'event_moved',
        actorId: authorId,
        target: moveTarget(eventId, String(event.title ?? ''), startISO),
        meta: { change: merged, ...base },
      }, { push: !brake.limited });
      written = written && ok;
    }
    // The older unread rows go only now, and only when every new row was written: a failed
    // write must not cost a member the notice they already had.
    if (written && unread.length) await rows.deleteMany({ _id: { $in: unread.map((u) => u._id) } });
    return recipients.length;
  } catch (err) {
    console.error('[eventMove] notice failed:', err);
    try {
      Sentry.captureException(err);
      await Sentry.flush(2000);
    } catch {
      /* best-effort */
    }
    return 0;
  }
}

/**
 * An edit that moved the event was held back by the moderation: nobody could see the event, so
 * nobody was told. Called when the admin approves — claims the owed notice (unset-and-read in one
 * step, so two parallel reviews send it once) and sends it with the event's CURRENT time and place.
 */
export async function sendOwedMoveNotice(db: Db, flagged: Pick<FlaggedContent, 'contentType' | 'contentId'>): Promise<void> {
  try {
    if (flagged.contentType !== 'event' || !flagged.contentId || !ObjectId.isValid(String(flagged.contentId))) return;
    const event = await db.collection('events').findOneAndUpdate(
      { _id: new ObjectId(String(flagged.contentId)), moveNoticeOwed: { $in: ['date', 'place', 'both'] } },
      { $unset: { moveNoticeOwed: '' } },
      { returnDocument: 'before' },
    );
    if (!event) return;
    await tellAboutMove(db, event as unknown as MovedEvent, event.moveNoticeOwed as MoveChange, String(event.author));
  } catch (err) {
    console.error('[eventMove] owed notice failed:', err);
  }
}
