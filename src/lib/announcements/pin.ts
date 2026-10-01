// SERVER-ONLY (takes a Db). Enforces the MAX_PINS invariant for official
// announcements: if the board is full, the oldest pin is cleared so the
// caller's pin fits. Single-admin app — the read-then-update window is
// sub-millisecond and accepted (same stance as the old single-pin code).
import { ObjectId, type Db } from 'mongodb';
import { pickDisplaced } from './pinRules';

export async function displaceForPin(db: Db, excludeId?: string): Promise<string | null> {
  const pinned = await db
    .collection('announcements')
    .find(
      { isOfficial: true, pinnedUntil: { $gt: new Date() } },
      { projection: { _id: 1, pinnedUntil: 1 } },
    )
    .toArray();
  const victim = pickDisplaced(pinned as any[], excludeId);
  if (!victim) return null;
  await db
    .collection('announcements')
    .updateOne({ _id: new ObjectId(String(victim._id)) }, { $set: { pinnedUntil: null } });
  return String(victim._id);
}
