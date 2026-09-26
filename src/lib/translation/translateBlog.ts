// src/lib/translation/translateBlog.ts
// SERVER-ONLY (astro:content + mongodb). Blog posts are repo MDX files, not Mongo
// documents, so translateContent() cannot load them — this is its blog twin:
// load by slug with the detail route's draft gate, split the markdown into blocks
// (pure parser, tested), translate the block texts, cache the rebuilt blocks in
// translationCache under `blog:<slug>:<lang>:<hash>`. Same 90d TTL, same
// content-hash keying (an edited post misses the cache by itself).
// astro:content is a virtual module of the Astro build: fine here the way
// src/lib/search/blogEntries.ts uses it, never importable by a unit test.
import { createHash } from 'crypto';
import { getCollection } from 'astro:content';
import { connectDB } from '../mongodb';
import { translateTexts, deeplTargetFor, DeepLError } from './deepl';
import { parseBlocks, blockTexts, withTexts, BLOG_TRANSLATE_MAX_CHARS, type Block } from '../blog/markdownBlocks';

const CACHE_COLLECTION = 'translationCache';
const DEEPL_BATCH = 50; // DeepL v2 accepts at most 50 texts per request

export type BlogTranslateOutcome =
  | { status: 'ok'; title: string; description: string; blocks: Block[]; detectedSource: string | null; cached: boolean }
  | { status: 'not_found' }
  | { status: 'bad_lang' }
  | { status: 'too_long' }
  | { status: 'unavailable' };

export async function translateBlogPost(input: { slug: string; targetLang: string }): Promise<BlogTranslateOutcome> {
  const target = deeplTargetFor(input.targetLang);
  if (!target) return { status: 'bad_lang' };
  const normLang = input.targetLang.trim().toLowerCase().split('-')[0];

  // Same gate as src/pages/blog/[...slug].astro: a draft resolves in dev, is gone in prod.
  const entries = await getCollection('blog', ({ data }) => !data.draft || !import.meta.env.PROD);
  const entry = entries.find((e) => e.id === input.slug);
  if (!entry) return { status: 'not_found' };

  const title = entry.data.title;
  const description = entry.data.description; // required by the content schema, but never send '' to DeepL
  const blocks = parseBlocks(entry.body ?? '');
  const texts = [title, ...(description ? [description] : []), ...blockTexts(blocks)];
  const bodyStart = description ? 2 : 1; // index of the first block text inside `texts`
  const total = texts.reduce((n, t) => n + t.length, 0);
  if (total === 0) return { status: 'not_found' };
  if (total > BLOG_TRANSLATE_MAX_CHARS) return { status: 'too_long' };

  const contentHash = createHash('sha256').update(texts.join('\n')).digest('hex').slice(0, 32);
  const cacheKey = `blog:${entry.id}:${normLang}:${contentHash}`;

  const db = await connectDB();
  const cacheCol = db.collection(CACHE_COLLECTION);
  const hit = await cacheCol.findOne({ key: cacheKey });
  if (hit && Array.isArray(hit.blocks)) {
    return {
      status: 'ok',
      title: String(hit.title ?? ''),
      description: String(hit.description ?? ''),
      blocks: hit.blocks as Block[],
      detectedSource: (hit.detectedSource as string | null) ?? null,
      cached: true,
    };
  }

  let trBlocks: Block[];
  let trTitle: string;
  let trDescription: string;
  let detectedSource: string | null = null;
  try {
    const translated: string[] = [];
    for (let i = 0; i < texts.length; i += DEEPL_BATCH) {
      const r = await translateTexts(texts.slice(i, i + DEEPL_BATCH), normLang);
      translated.push(...r.texts);
      detectedSource ??= r.detectedSource;
    }
    trTitle = translated[0] ?? '';
    trDescription = description ? (translated[1] ?? '') : '';
    trBlocks = withTexts(blocks, translated.slice(bodyStart)); // throws on a count mismatch → unavailable
  } catch (e) {
    if (e instanceof DeepLError && e.code === 'bad_lang') return { status: 'bad_lang' };
    return { status: 'unavailable' };
  }

  // Upsert, not insert: two concurrent misses on one key must not throw on the unique index.
  await cacheCol.updateOne(
    { key: cacheKey },
    {
      $set: {
        key: cacheKey,
        contentType: 'blog',
        contentId: entry.id,
        targetLang: normLang,
        contentHash,
        title: trTitle,
        description: trDescription,
        blocks: trBlocks,
        detectedSource,
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  return { status: 'ok', title: trTitle, description: trDescription, blocks: trBlocks, detectedSource, cached: false };
}
