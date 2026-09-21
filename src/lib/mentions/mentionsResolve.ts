// src/lib/mentions/mentionsResolve.ts — server code with the db INJECTED.
// Imports only the `mongodb` PACKAGE and the pure mentions module, so node:test
// can load it (src/lib/mongodb.ts throws at import time without the app's env —
// same split as movePost.ts / cascade.ts). Notifying lives in mentionsStore.ts.
//
// Mentions are resolved when a text is SAVED and stored as { handle, userId }.
// The link goes by userId, so a later handle change never breaks it, and an
// „@word" in older text never becomes a link or a notification after the fact.
import { ObjectId, type Db } from 'mongodb';
import { extractMentionHandles, type MentionRef } from './mentions';

export type MentionDb = Pick<Db, 'collection'>;

const PARENT_COLLECTIONS = ['topics', 'announcements', 'recommendations', 'events'] as const;

export async function resolveMentions(db: MentionDb, text: string): Promise<MentionRef[]> {
  const handles = extractMentionHandles(text);
  if (handles.length === 0) return [];
  const users = await db.collection('users')
    .find({ handle: { $in: handles }, anonymized: { $ne: true } }, { projection: { handle: 1 } })
    .toArray();
  const idByHandle = new Map(users.map((u) => [String(u.handle), String(u._id)]));
  return handles.filter((h) => idByHandle.has(h)).map((h) => ({ handle: h, userId: idByHandle.get(h)! }));
}

export function pickMentionRecipients(args: {
  mentions: readonly MentionRef[]; actorId: string; skipUserIds?: readonly string[]; alreadyNotified: readonly string[];
}): string[] {
  const skip = new Set<string>([args.actorId, ...(args.skipUserIds ?? []), ...args.alreadyNotified]);
  return [...new Set(args.mentions.map((m) => m.userId))].filter((id) => !skip.has(id));
}

/** A comment stores only `relevantPostId` — find which collection the parent lives in. */
export async function findCommentParent(db: MentionDb, postId: string):
  Promise<{ collection: string; author: string | null; title: string } | null> {
  if (!ObjectId.isValid(postId)) return null;
  const _id = new ObjectId(postId);
  for (const collection of PARENT_COLLECTIONS) {
    const doc = await db.collection(collection).findOne({ _id }, { projection: { author: 1, title: 1 } });
    if (doc) return { collection, author: doc.author ? String(doc.author) : null, title: String(doc.title ?? '') };
  }
  return null;
}

/** Account deletion: the deleted member's „@handle" in others' texts becomes plain text again. */
export async function removeMentionsOf(db: MentionDb, userId: string): Promise<number> {
  let n = 0;
  for (const c of ['topics', 'announcements', 'recommendations', 'comments']) {
    const r = await db.collection(c).updateMany({ 'mentions.userId': userId }, { $pull: { mentions: { userId } } } as any);
    n += r.modifiedCount ?? 0;
  }
  return n;
}
