// src/lib/mentions/activeMembers.ts — server code with the db INJECTED (testable).
// „Active in the last 90 days" for the @alle Admin-Hinweis (user decision
// 2026-09-22). Computed at SEND time from signals that already exist, plus the
// `users.lastSeenAt` stamp the JWT callback writes since the same day (before
// that day nobody has the stamp — hence the other signals).
import { ObjectId } from 'mongodb';
import type { MentionDb } from './mentionsResolve';

export const ACTIVE_WINDOW_DAYS = 90;

export function activeSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

const AUTHORED = ['topics', 'announcements', 'recommendations', 'comments', 'events', 'listings'] as const;

export async function findActiveMemberIds(db: MentionDb, since: Date): Promise<string[]> {
  const sinceIso = since.toISOString();
  const ids = new Set<string>();
  // register.ts stores createdAt as an ISO STRING; older docs may carry a Date.
  const users = await db.collection('users')
    .find({ anonymized: { $ne: true }, $or: [{ lastSeenAt: { $gte: since } }, { createdAt: { $gte: since } }, { createdAt: { $gte: sinceIso } }] }, { projection: { _id: 1 } })
    .toArray();
  for (const u of users) ids.add(String(u._id));
  for (const c of AUTHORED) {
    const rows = await db.collection(c).find({ createdAt: { $gte: since } }, { projection: { author: 1, sellerId: 1 } }).toArray();
    for (const r of rows) { const a = r.author ?? r.sellerId; if (a) ids.add(String(a)); }
  }
  const read = await db.collection('notifications').find({ readAt: { $gte: since } }, { projection: { userId: 1 } }).toArray();
  for (const n of read) ids.add(String(n.userId));
  const pushes = await db.collection('pushSubscriptions').find({ updatedAt: { $gte: since } }, { projection: { userId: 1 } }).toArray();
  for (const p of pushes) ids.add(String(p.userId));
  // Tombstones can enter through content/notification rows — drop them.
  const tombs = await db.collection('users').find({ _id: { $in: [...ids].filter((id) => /^[0-9a-f]{24}$/.test(id)).map((id) => new ObjectId(id)) }, anonymized: true }, { projection: { _id: 1 } }).toArray();
  for (const t of tombs) ids.delete(String(t._id));
  return [...ids];
}
