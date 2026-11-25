/**
 * Bell entry for likes (posts and comments). SERVER-ONLY (imports connectDB).
 * One quiet line per liked item for its author: no names, no push, no e-mail.
 * NEVER-THROW, like notifications.ts: a failed write must not fail the like.
 * `likers` stays on the row and is never returned by listNotifications().
 */
import { ObjectId } from 'mongodb';
import * as Sentry from '@sentry/astro';
import { connectDB } from './mongodb';
import { commentTarget, moderationTarget } from './notifications';
import { findBlogCommentParent } from './blog/blogCommentParent';
import type { LikeParent } from './forum/commentLikeStore';
import type { NotificationTarget } from '../types/notification';
import {
  buildLikeUpsertPipeline,
  buildUnlikePipeline,
  likeNoticeTitle,
  likeRowFilter,
  shouldNotifyLike,
  type LikeContentKind,
} from './likeNotifyRules';

const POST_KIND: Record<string, LikeContentKind> = {
  topics: 'topic',
  announcements: 'announcement',
  recommendations: 'recommendation',
};
const POST_CONTENT_TYPE: Record<string, string> = {
  topics: 'topic',
  announcements: 'announcement',
  recommendations: 'recommendation',
};

async function capture(err: unknown): Promise<void> {
  console.error('[likeNotify] failed:', err);
  try {
    Sentry.captureException(err);
    await Sentry.flush(2000);
  } catch {
    /* best-effort */
  }
}

export interface LikeNotifyInput {
  action: 'like' | 'unlike';
  likerId: string;
  collectionType: 'topics' | 'announcements' | 'recommendations' | 'comments';
  itemId: string;
  /** Comments: the comment doc the route already read, and its parent when it is a forum post. */
  comment?: { author?: unknown; body?: string; relevantPostId?: unknown; blogSlug?: string } | null;
  parent?: LikeParent | null;
}

export async function notifyLike(input: LikeNotifyInput): Promise<void> {
  try {
    const db = await connectDB();
    const { collectionType, itemId, likerId } = input;

    let authorId: string | null = null;
    let contentKind: LikeContentKind;
    let title: string;
    let target: NotificationTarget;

    if (collectionType === 'comments') {
      const c = input.comment;
      if (!c) return;
      authorId = c.author ? String(c.author) : null;
      contentKind = 'comment';
      title = likeNoticeTitle(c.body);
      if (c.blogSlug) {
        const bp = await findBlogCommentParent(db, c.blogSlug);
        if (!bp) return;
        target = commentTarget('blog', c.blogSlug, title);
      } else {
        const parent = input.parent;
        if (!parent) return;
        target = commentTarget(parent.collection, String(parent.doc._id), title);
      }
    } else {
      const post = await db.collection(collectionType).findOne(
        { _id: new ObjectId(itemId) },
        { projection: { author: 1, title: 1 } },
      );
      if (!post) return;
      authorId = post.author ? String(post.author) : null;
      contentKind = POST_KIND[collectionType];
      title = likeNoticeTitle(post.title);
      target = moderationTarget(POST_CONTENT_TYPE[collectionType], itemId, title);
    }

    if (!authorId) return;

    // users._id exists as ObjectId and as legacy hex string — query both.
    const ids: any[] = ObjectId.isValid(authorId) ? [authorId, new ObjectId(authorId)] : [authorId];
    const author = await db.collection('users').findOne(
      { _id: { $in: ids } },
      { projection: { anonymized: 1 } },
    );
    const authorLive = !!author && (author as any).anonymized !== true;
    if (!shouldNotifyLike({ likerId, authorId, authorLive })) return;

    const notifications = db.collection('notifications');
    const filter = likeRowFilter(authorId, itemId);
    if (input.action === 'like') {
      await notifications.updateOne(
        filter,
        buildLikeUpsertPipeline({ userId: authorId, likerId, sourceId: itemId, contentKind, target, now: new Date() }) as any,
        { upsert: true },
      );
    } else {
      await notifications.updateOne(filter, buildUnlikePipeline(likerId) as any);
      // The row goes when nobody likes the item any more.
      await notifications.deleteOne({ ...filter, likers: { $size: 0 } });
    }
  } catch (err) {
    await capture(err);
  }
}
