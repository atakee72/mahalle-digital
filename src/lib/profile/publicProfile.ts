// src/lib/profile/publicProfile.ts — SERVER-ONLY (imports mongodb)
//
// "Nachbarn" public-profile resolver — Plan B Task 3. Trimmed sibling of
// profileQuery.ts's getProfileMe(): same stats-aggregation shape, but every
// query is ANDed with the public-visibility gates (see activityFeed.ts's
// PUBLIC_MODERATION_OR + fetchPublicActivityPage for the shared gate used
// by the activity feed side of this same view).
//
// NEVER select/return email, isBanned, pendingEmail, or strikes from this
// module — see PublicProfile's own doc-comment in profileShared.ts.

import { ObjectId } from 'mongodb';
import { connectDB } from '../mongodb';
import { ensureHandle } from './profileQuery';
import { storedMemberType } from '../members/memberType';
import type { PublicProfile } from './profileShared';

const TWENTY_ONE_DAYS_MS = 21 * 24 * 60 * 60 * 1000;

// Same approved-or-absent gate as activityFeed.ts's PUBLIC_MODERATION_OR —
// duplicated here (not imported) because activityFeed.ts has no reason to
// export an internal constant; keep both in sync if Decision 11 ever changes.
function publicModerationOr(authorKey: string, userId: string) {
  return {
    [authorKey]: userId,
    $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }],
  };
}

/**
 * Resolve a public handle to a user id, gated the same way getPublicProfile
 * is (unknown or anonymized -> null). Internal helper — used by the
 * public-activity endpoint to avoid running the full stats aggregation just
 * to find a userId.
 */
export async function resolvePublicUserIdByHandle(handle: string): Promise<string | null> {
  const db = await connectDB();
  const lower = handle.toLowerCase();
  const user = await db.collection('users').findOne({ handle: lower }, { projection: { anonymized: 1 } });
  if (!user || user.anonymized === true) return null;
  return String(user._id);
}

/**
 * Self-healing handle lookup by userId, gated the same way as
 * getPublicProfile/resolvePublicUserIdByHandle (missing or anonymized user
 * -> null). Consumed by Task 4's id-redirect route (e.g. an old
 * `/profile/<id>`-shaped link resolving to the canonical `/nachbarn/<handle>`
 * URL).
 */
export async function getHandleForPublic(userId: string): Promise<string | null> {
  const db = await connectDB();
  if (!ObjectId.isValid(userId)) return null;
  const user = await db
    .collection('users')
    .findOne({ _id: new ObjectId(userId) }, { projection: { handle: 1, anonymized: 1 } });
  if (!user || user.anonymized === true) return null;
  if (typeof user.handle === 'string') return user.handle;
  return ensureHandle(userId);
}

export async function getPublicProfile(handle: string): Promise<PublicProfile | null> {
  const db = await connectDB();
  const lower = handle.toLowerCase();
  const user = await db.collection('users').findOne(
    { handle: lower },
    {
      projection: {
        name: 1,
        handle: 1,
        userPicture: 1,
        image: 1,
        hobbies: 1,
        verified: 1,
        memberType: 1,
        createdAt: 1,
        anonymized: 1,
      },
    }
  );
  if (!user || user.anonymized === true) return null;

  const userId = String(user._id);
  const twentyOneDaysAgo = new Date(Date.now() - TWENTY_ONE_DAYS_MS);

  const [topicsCount, annCount, recCount, listings, events] = await Promise.all([
    db.collection('topics').countDocuments(publicModerationOr('author', userId)),
    db.collection('announcements').countDocuments(publicModerationOr('author', userId)),
    db.collection('recommendations').countDocuments(publicModerationOr('author', userId)),
    // Listings public visibility = buildListingsFilter's public $or branch
    // (src/lib/listingsQuery.ts:73-79): status in [available, reserved] AND
    // the freshness clock (max of lastBumpedAt/createdAt) within 21 days.
    db.collection('listings').countDocuments({
      sellerId: userId,
      status: { $in: ['available', 'reserved'] },
      $expr: { $gte: [{ $ifNull: ['$lastBumpedAt', '$createdAt'] }, twentyOneDaysAgo] },
    }),
    // Events: approved-or-absent created events, ALL-TIME count (Decision
    // 11 — a stat is a count, not a listing; unlike the public activity
    // feed's kalender sub-query this is NOT restricted to upcoming-only).
    db.collection('events').countDocuments(publicModerationOr('author', userId)),
  ]);
  const posts = topicsCount + annCount + recCount;

  // danke = same aggregation as /me (unchanged) — sum of `likes` across all
  // of the author's content, regardless of moderation status.
  const dankeAgg = await Promise.all(
    ['topics', 'announcements', 'recommendations', 'events'].map((c) =>
      db
        .collection(c)
        .aggregate([
          { $match: { author: userId } },
          { $group: { _id: null, total: { $sum: { $ifNull: ['$likes', 0] } } } },
        ])
        .toArray()
    )
  );
  const danke = dankeAgg.reduce((sum, r) => sum + (r[0]?.total ?? 0), 0);

  const created = user.createdAt instanceof Date ? user.createdAt : new Date(String(user.createdAt));

  return {
    id: userId,
    name: String(user.name ?? ''),
    handle: String(user.handle ?? lower),
    image: (user.userPicture || user.image || null) as string | null,
    hobbies: Array.isArray(user.hobbies) ? user.hobbies : [],
    // Strict since the Kiez-verification pipeline (Aug 2026): earned via
    // admin toggle on /admin/mitglieder, absent/undefined = NOT verified.
    verified: user.verified === true,
    memberType: storedMemberType(user),
    memberSince: Number.isNaN(created.getTime()) ? new Date().getFullYear() : created.getFullYear(),
    stats: { posts, listings, events, danke },
  };
}
