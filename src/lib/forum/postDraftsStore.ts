// Forum drafts — database + Cloudinary side. SERVER-ONLY (imports mongodb +
// cloudinary): never import this from an island; islands use postDrafts.ts.
// Design: docs/superpowers/plans/2026-09-21-forum-server-drafts.md
import { ObjectId } from 'mongodb';
import { v2 as cloudinary } from 'cloudinary';
import * as Sentry from '@sentry/astro';
import { connectDB } from '../mongodb';
import { POST_COLLECTIONS } from './postKind';
import { MAX_POST_DRAFTS, type PostDraftDTO, type PostDraftInput } from './postDrafts';

cloudinary.config({
  cloud_name: import.meta.env.CLOUD_NAME,
  api_key: import.meta.env.CLOUDINARY_API_KEY,
  api_secret: import.meta.env.CLOUDINARY_API_SECRET
});

type DraftDoc = PostDraftInput & { _id: ObjectId; userId: string; createdAt: Date; updatedAt: Date };

const COLLECTION = 'postDrafts';
const isId = (s: string) => /^[0-9a-fA-F]{24}$/.test(s);

function toDTO(d: DraftDoc): PostDraftDTO {
  return {
    id: d._id.toString(),
    kind: d.kind,
    title: d.title,
    body: d.body,
    tags: d.tags ?? [],
    images: d.images ?? [],
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString()
  };
}

export async function listDrafts(userId: string): Promise<PostDraftDTO[]> {
  const db = await connectDB();
  const docs = await db.collection<DraftDoc>(COLLECTION).find({ userId }).sort({ updatedAt: -1 }).limit(MAX_POST_DRAFTS).toArray();
  return docs.map(toDTO);
}

export async function getDraft(id: string, userId: string): Promise<PostDraftDTO | null> {
  if (!isId(id)) return null;
  const db = await connectDB();
  // userId is part of the filter: a foreign id behaves exactly like an unknown one.
  const doc = await db.collection<DraftDoc>(COLLECTION).findOne({ _id: new ObjectId(id), userId });
  return doc ? toDTO(doc) : null;
}

/** Destroy only images that NOTHING references any more. Publishing a draft
 *  copies its images into the post, and those must survive the draft.
 *  SECURITY: the lookup is GLOBAL on purpose — no author / userId filter. A
 *  draft's image list comes from the client; with an "own posts only" check a
 *  member could name the publicId of someone else's published photo (it is in
 *  every image URL) and get it destroyed by deleting the draft. */
async function destroyUnreferencedImages(publicIds: string[]): Promise<number> {
  if (!publicIds.length) return 0;
  const db = await connectDB();
  const used = new Set<string>();
  for (const c of [...POST_COLLECTIONS, COLLECTION]) {
    const docs = await db.collection(c).find({ 'images.publicId': { $in: publicIds } }, { projection: { images: 1 } }).toArray();
    for (const d of docs) for (const img of (d as any).images ?? []) used.add(img.publicId);
  }

  let destroyed = 0;
  for (const id of publicIds) {
    // Only our own upload folder — never destroy an id a client could have typed.
    if (used.has(id) || !id.startsWith('mahalle/posts/')) continue;
    try {
      await cloudinary.uploader.destroy(id, { invalidate: true }); // private working copy — drop it from the CDN too
      destroyed++;
    } catch (err) {
      Sentry.captureException(err, { extra: { where: 'postDraftsStore.destroyUnreferencedImages' } });
    }
  }
  return destroyed;
}

export async function saveDraft(
  userId: string,
  input: PostDraftInput & { id?: string }
): Promise<{ ok: true; draft: PostDraftDTO } | { ok: false; reason: 'limit' | 'not_found' }> {
  const db = await connectDB();
  const col = db.collection<DraftDoc>(COLLECTION);
  const now = new Date();
  const fields = { kind: input.kind, title: input.title, body: input.body, tags: input.tags, images: input.images };

  if (input.id) {
    // 'before': we need the OLD image list to clean up what this update dropped.
    const before = await col.findOneAndUpdate(
      { _id: new ObjectId(input.id), userId },
      { $set: { ...fields, updatedAt: now } },
      { returnDocument: 'before' }
    );
    if (!before) return { ok: false, reason: 'not_found' };
    const kept = new Set(input.images.map((i) => i.publicId));
    const dropped = ((before as DraftDoc).images ?? []).map((i) => i.publicId).filter((id) => !kept.has(id));
    await destroyUnreferencedImages(dropped);
    return { ok: true, draft: toDTO({ ...(before as DraftDoc), ...fields, updatedAt: now }) };
  }

  if ((await col.countDocuments({ userId })) >= MAX_POST_DRAFTS) return { ok: false, reason: 'limit' };
  const doc = { ...fields, userId, createdAt: now, updatedAt: now };
  const res = await col.insertOne(doc as DraftDoc);
  return { ok: true, draft: toDTO({ ...doc, _id: res.insertedId } as DraftDoc) };
}

export async function deleteDraft(id: string, userId: string): Promise<{ deleted: boolean; imagesDestroyed: number }> {
  if (!isId(id)) return { deleted: false, imagesDestroyed: 0 };
  const db = await connectDB();
  // Delete FIRST, so the reference lookup no longer finds this draft itself.
  const doc = await db.collection<DraftDoc>(COLLECTION).findOneAndDelete({ _id: new ObjectId(id), userId });
  if (!doc) return { deleted: false, imagesDestroyed: 0 };
  const imagesDestroyed = await destroyUnreferencedImages(((doc as DraftDoc).images ?? []).map((i) => i.publicId));
  return { deleted: true, imagesDestroyed };
}

/** Account deletion (day-7 pipeline). */
export async function deleteAllDraftsOf(userId: string): Promise<{ drafts: number; imagesDestroyed: number }> {
  const db = await connectDB();
  const col = db.collection<DraftDoc>(COLLECTION);
  const docs = await col.find({ userId }, { projection: { images: 1 } }).toArray();
  const ids = [...new Set(docs.flatMap((d) => (d.images ?? []).map((i) => i.publicId)))];
  const res = await col.deleteMany({ userId });
  return { drafts: res.deletedCount ?? 0, imagesDestroyed: await destroyUnreferencedImages(ids) };
}
