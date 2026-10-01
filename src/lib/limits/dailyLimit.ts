// src/lib/limits/dailyLimit.ts — SERVER-ONLY (imports mongodb).
// The one place that counts a member's posts of the last 24 hours and decides
// whether another one is allowed. Used by the seven create/publish gates and
// the three daily-count endpoints.
import { ObjectId, type Db } from 'mongodb';
import { decideLimit, type LimitBucket, type LimitResult } from './limitRules';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Posts of the rolling 24 hours in one bucket. Pending and rejected items count, as before. */
export async function countToday(db: Db, userId: string, bucket: LimitBucket): Promise<number> {
  const since = { $gte: new Date(Date.now() - DAY_MS) };
  if (bucket === 'forum') {
    const counts = await Promise.all(
      ['topics', 'announcements', 'recommendations'].map((c) =>
        db.collection(c).countDocuments({ author: userId, createdAt: since }),
      ),
    );
    return counts.reduce((a, b) => a + b, 0);
  }
  if (bucket === 'events') {
    return db.collection('events').countDocuments({ author: userId, createdAt: since });
  }
  if (bucket === 'listings') {
    return db.collection('listings').countDocuments({ sellerId: userId, createdAt: since, status: { $ne: 'draft' } });
  }
  return db.collection('news').countDocuments({ submittedBy: userId, source: 'user_submitted', createdAt: since });
}

/**
 * Count + decision. The member's type and limit are read LIVE from the user
 * document (the login token is a snapshot and would lag an admin change).
 * A missing user document throws: an unreadable member must never lift the limit.
 */
export async function checkDailyLimit(
  db: Db,
  who: { userId: string; role?: string | null },
  bucket: LimitBucket,
): Promise<LimitResult> {
  const [count, user] = await Promise.all([
    countToday(db, who.userId, bucket),
    db.collection('users').findOne(
      { _id: new ObjectId(who.userId) },
      { projection: { memberType: 1, dailyLimit: 1 } },
    ),
  ]);
  if (!user) throw new Error('daily limit: user not found');
  return decideLimit({ count, role: who.role, user });
}

const NOUN: Record<LimitBucket, string> = {
  forum: 'forum posts',
  events: 'events',
  listings: 'listings',
  news: 'news items',
};

/** The 429 every gate answers. Shape frozen: clients read dailyLimit + currentCount. */
export function limitReachedResponse(bucket: LimitBucket, r: LimitResult, extra = ''): Response {
  return new Response(JSON.stringify({
    error: 'Daily limit reached',
    message: `You can publish up to ${r.limit} ${NOUN[bucket]} per day. Please try again tomorrow${extra}.`,
    dailyLimit: r.limit,
    currentCount: r.count,
  }), { status: 429, headers: { 'Content-Type': 'application/json' } });
}
