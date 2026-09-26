// src/lib/profile/profileQuery.ts — SERVER-ONLY (imports mongodb)
import { ObjectId } from 'mongodb';
import { connectDB } from '../mongodb';
import { slugifyHandle, chosenHandleProblem, HANDLE_FALLBACK } from './handle';
import type { ProfileMe } from './profileShared';

/** Lazy self-heal: users registered by old prod code lack a handle. */
export async function ensureHandle(userId: string): Promise<string> {
  const db = await connectDB();
  const users = db.collection('users');
  const _id = new ObjectId(userId);
  const u = await users.findOne({ _id }, { projection: { handle: 1, name: 1 } });
  if (!u) throw new Error('user not found');
  if (typeof u.handle === 'string') return u.handle;
  // Same rule as register.ts: the automatic base must never be a reserved word
  // (a legacy member called „Admin" would otherwise own the @admin alias).
  let base = slugifyHandle(String(u.name ?? ''));
  if (chosenHandleProblem(base) === 'reserved') base = HANDLE_FALLBACK;
  for (let n = 0; n < 20; n++) {
    const suffix = n === 0 ? '' : String(n + 1);
    const handle = base.slice(0, 20 - suffix.length) + suffix;
    try {
      const res = await users.updateOne({ _id, handle: { $exists: false } }, { $set: { handle } });
      if (res.matchedCount === 0) {
        // Concurrent request already assigned one — return the ACTUAL handle,
        // not the one we generated but never wrote.
        const fresh = await users.findOne({ _id }, { projection: { handle: 1 } });
        if (typeof fresh?.handle === 'string') return fresh.handle;
        throw new Error('user disappeared during handle assignment');
      }
      return handle;
    } catch (e: any) {
      if (e?.code !== 11000) throw e; // collision with ANOTHER user -> next suffix
    }
  }
  throw new Error('could not assign handle');
}

export async function getProfileMe(userId: string): Promise<ProfileMe | null> {
  const db = await connectDB();
  const _id = new ObjectId(userId);
  const user = await db.collection('users').findOne(
    { _id },
    { projection: { name: 1, handle: 1, email: 1, userPicture: 1, image: 1, hobbies: 1, verified: 1, createdAt: 1, isBanned: 1, motto: 1, pendingEmail: 1, deletionScheduledAt: 1 } }
  );
  if (!user) return null;
  const handle = typeof user.handle === 'string' ? user.handle : await ensureHandle(userId);

  const [posts, ann, rec, listings, events] = await Promise.all([
    db.collection('topics').countDocuments({ author: userId }),
    db.collection('announcements').countDocuments({ author: userId }),
    db.collection('recommendations').countDocuments({ author: userId }),
    db.collection('listings').countDocuments({ sellerId: userId, status: { $ne: 'draft' } }),
    db.collection('events').countDocuments({ author: userId }),
  ]);
  const dankeAgg = await Promise.all(
    ['topics', 'announcements', 'recommendations', 'events'].map((c) =>
      db.collection(c).aggregate([
        { $match: { author: userId } },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$likes', 0] } } } },
      ]).toArray()
    )
  );
  const danke = dankeAgg.reduce((sum, r) => sum + (r[0]?.total ?? 0), 0);

  const created = user.createdAt instanceof Date ? user.createdAt : new Date(String(user.createdAt));
  return {
    id: userId,
    name: String(user.name ?? ''),
    handle,
    email: String(user.email ?? ''),
    image: (user.userPicture || user.image || null) as string | null,
    hobbies: Array.isArray(user.hobbies) ? user.hobbies : [],
    // Strict since the Kiez-verification pipeline (Aug 2026): the badge is
    // earned (admin toggle on /admin/mitglieder), absent/undefined = NOT verified.
    verified: user.verified === true,
    memberSince: Number.isNaN(created.getTime()) ? new Date().getFullYear() : created.getFullYear(),
    isBanned: user.isBanned === true,
    stats: { posts: posts + ann + rec, listings, events, danke },
    motto: typeof user.motto === 'string' ? user.motto : null,
    pendingEmail: typeof user.pendingEmail === 'string' ? user.pendingEmail : null,
    deletionScheduledAt:
      user.deletionScheduledAt instanceof Date
        ? user.deletionScheduledAt.toISOString()
        : typeof user.deletionScheduledAt === 'string'
          ? user.deletionScheduledAt
          : null,
  };
}
