// src/lib/profile/protectedNamesStore.ts — SERVER-ONLY.
// The admins' own display names are protected too — read at request time (one
// tiny query), never hardcoded. The word rules live in the pure nameRules.ts.
import type { Db } from 'mongodb';
import { sameNameFolded } from './nameRules';

export async function isAdminLookalike(db: Pick<Db, 'collection'>, name: string, selfId?: string): Promise<boolean> {
  const admins = await db.collection('users')
    .find({ role: 'admin', anonymized: { $ne: true } }, { projection: { name: 1 } })
    .toArray();
  return admins.some((a) => String(a._id) !== selfId && typeof a.name === 'string' && sameNameFolded(a.name, name));
}
