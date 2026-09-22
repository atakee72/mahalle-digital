import type { ObjectId } from 'mongodb';

export type NotificationType = 'comment' | 'moderation' | 'official' | 'market_contact' | 'mention' | 'admin_hint';

export interface NotificationTarget {
  /** The page kind the row deep-links to (mirrors the href, not necessarily
   *  the moderated doc itself — a moderated comment links to its parent). */
  contentType: 'topic' | 'announcement' | 'recommendation' | 'event' | 'listing' | 'news' | 'forum';
  contentId: string;
  title: string; // snapshot at event time
  href: string;
}

export interface NotificationMeta {
  outcome?: 'approved' | 'warned' | 'rejected';
  /** Strike NUMBER after this rejection (CD copy: „{n}. Verwarnung") — set on rejections only. */
  strikeCount?: number;
  /** What was moderated ('topic' | 'comment' | …) — target.contentType can't carry this
   *  for comments (it points at the PARENT page the row links to). Drives the
   *  „Beitrag" vs „Kommentar" copy variants. */
  contentKind?: string;
  /** mention only: id of the post/comment that CONTAINS the mention — the idempotency
   *  key (target.contentId is the PARENT page for comments, so it cannot serve). */
  sourceId?: string;
}

/** DB shape — one doc per recipient per event. */
export interface NotificationDoc {
  _id?: ObjectId;
  userId: string; // recipient, user-id string (like all content refs)
  type: NotificationType;
  actorId?: string; // who triggered it — NO name stored (read-time join)
  target: NotificationTarget;
  meta?: NotificationMeta;
  createdAt: Date;
  readAt: Date | null;
}

/** API/client shape returned by GET /api/notifications. */
export interface NotificationItem {
  id: string;
  type: NotificationType;
  actorName: string | null; // null → deleted account or no actor; client renders tombstone label
  target: NotificationTarget;
  meta?: NotificationMeta;
  createdAt: string; // ISO
  readAt: string | null; // ISO
}
