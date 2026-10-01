// src/schemas/translate.schema.ts
// SERVER-ONLY: transitively imports mongodb via translateContent — never
// import this from a Svelte island or any client:* component.
import { z } from 'zod';
import { TRANSLATABLE_TYPES } from '../lib/translation/translateContent';

/** The six Mongo-backed types (ObjectId ids) plus the blog (repo MDX, slug ids). */
const TRANSLATE_REQUEST_TYPES = [...TRANSLATABLE_TYPES, 'blog'] as const;

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const BLOG_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/; // astro:content ids of src/content/blog/*.mdx

export const TranslateRequestSchema = z
  .object({
    contentType: z.enum(TRANSLATE_REQUEST_TYPES),
    contentId: z.string().min(1).max(120),
    targetLang: z.string().min(2).max(12),
  })
  .refine((v) => (v.contentType === 'blog' ? BLOG_SLUG : OBJECT_ID).test(v.contentId), {
    message: 'invalid_id',
    path: ['contentId'],
  });
