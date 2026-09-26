// src/lib/translation/translateContent.ts
// SERVER-ONLY: loads content, enforces visibility, returns cached or fresh translation.
// Mongo-backed types only — blog posts (repo MDX) go through ./translateBlog.ts.
import { createHash } from 'crypto';
import { ObjectId } from 'mongodb';
import { connectDB } from '../mongodb';
import { translateTexts, deeplTargetFor, DeepLError } from './deepl';

export const TRANSLATABLE_TYPES = [
  'topic', 'announcement', 'recommendation', 'comment', 'event', 'listing',
] as const;
export type TranslatableType = (typeof TRANSLATABLE_TYPES)[number];

const COLLECTION_FOR: Record<TranslatableType, string> = {
  topic: 'topics',
  announcement: 'announcements',
  recommendation: 'recommendations',
  comment: 'comments',
  event: 'events',
  listing: 'listings',
};

const MAX_CHARS = 6000;
const CACHE_COLLECTION = 'translationCache';

export type TranslateOutcome =
  | { status: 'ok'; title: string | null; body: string; detectedSource: string | null; cached: boolean }
  | { status: 'not_found' }
  | { status: 'bad_lang' }
  | { status: 'too_long' }
  | { status: 'unavailable' };

/** Author id fields differ per collection (VERIFIED in the create endpoints):
 *  topics/announcements/recommendations/events/comments store `author` (userId string),
 *  listings store `sellerId`. Tolerate string/ObjectId forms. */
function isAuthor(doc: any, userId: string): boolean {
  const candidates = [doc.author, doc.sellerId];
  return candidates.some((c) => c != null && String(c) === userId);
}

function isVisibleTo(doc: any, contentType: TranslatableType, userId: string): boolean {
  const approved = doc.moderationStatus === 'approved' || doc.moderationStatus == null;
  if (contentType === 'listing') {
    // Mirror marketplace detail visibility: publicly listed states, or the owner.
    // Fail-closed for statusless docs — real values are 'available' | 'reserved' | 'sold' | 'draft'.
    const publicStatus = doc.status === 'available' || doc.status === 'reserved';
    return (approved && publicStatus) || isAuthor(doc, userId);
  }
  return approved || isAuthor(doc, userId);
}

function extractFields(doc: any, contentType: TranslatableType): { title: string | null; body: string } {
  if (contentType === 'comment') {
    return { title: null, body: String(doc.body ?? doc.content ?? '') };
  }
  const title = typeof doc.title === 'string' ? doc.title : null;
  if (contentType === 'listing') {
    // description can be a Quill/typewriter Delta OBJECT (src/schemas/listing.schema.ts) —
    // String(delta) would yield "[object Object]". Prefer the plain-text mirror field.
    const body =
      typeof doc.descriptionPlainText === 'string' && doc.descriptionPlainText.trim()
        ? doc.descriptionPlainText
        : typeof doc.description === 'string'
          ? doc.description
          : '';
    return { title, body };
  }
  const body = String(doc.body ?? doc.content ?? doc.description ?? '');
  return { title, body };
}

export async function translateContent(input: {
  contentType: TranslatableType;
  contentId: string;
  targetLang: string;
  userId: string;
}): Promise<TranslateOutcome> {
  const { contentType, contentId, targetLang, userId } = input;

  const target = deeplTargetFor(targetLang);
  if (!target) return { status: 'bad_lang' };
  const normLang = targetLang.trim().toLowerCase().split('-')[0];

  if (!ObjectId.isValid(contentId)) return { status: 'not_found' };

  const db = await connectDB();
  const doc = await db
    .collection(COLLECTION_FOR[contentType])
    .findOne(
      { _id: new ObjectId(contentId) },
      { projection: { title: 1, body: 1, content: 1, description: 1, descriptionPlainText: 1, moderationStatus: 1, status: 1, author: 1, sellerId: 1 } }
    );
  if (!doc || !isVisibleTo(doc, contentType, userId)) return { status: 'not_found' };

  const { title, body } = extractFields(doc, contentType);
  if (!body.trim() && !title?.trim()) return { status: 'not_found' };
  if ((title?.length ?? 0) + body.length > MAX_CHARS) return { status: 'too_long' };

  const contentHash = createHash('sha256')
    .update(`${title ?? ''}\n${body}`)
    .digest('hex')
    .slice(0, 32);
  const cacheKey = `${contentType}:${contentId}:${normLang}:${contentHash}`;

  const cacheCol = db.collection(CACHE_COLLECTION);
  const hit = await cacheCol.findOne({ key: cacheKey });
  if (hit) {
    return {
      status: 'ok',
      title: (hit.title as string | null) ?? null,
      body: hit.body as string,
      detectedSource: (hit.detectedSource as string | null) ?? null,
      cached: true,
    };
  }

  const texts = title != null ? [title, body] : [body];
  let result: Awaited<ReturnType<typeof translateTexts>>;
  try {
    result = await translateTexts(texts, normLang);
  } catch (e) {
    if (e instanceof DeepLError && e.code === 'bad_lang') return { status: 'bad_lang' };
    return { status: 'unavailable' };
  }

  const trTitle = title != null ? result.texts[0] : null;
  const trBody = title != null ? result.texts[1] : result.texts[0];

  // Upsert (not insert): two concurrent misses on the same key must not throw
  // on the unique index — last write wins, both translated the same input.
  await cacheCol.updateOne(
    { key: cacheKey },
    {
      $set: {
        key: cacheKey,
        contentType,
        contentId,
        targetLang: normLang,
        contentHash,
        title: trTitle,
        body: trBody,
        detectedSource: result.detectedSource,
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  return { status: 'ok', title: trTitle, body: trBody, detectedSource: result.detectedSource, cached: false };
}
