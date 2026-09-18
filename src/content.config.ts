import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/blog' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    // ORDER-ONLY date: a post that joins a group published earlier sorts with it and keeps its true pubDate (see beilage.ts compareNewest).
    sortDate: z.coerce.date().optional(),
    author: z.string().default('Mahalle Team'),
    cover: image().optional(),
    coverAlt: z.string().optional(),
    /** Photo credit shown under the cover (replaces the default "Foto: Mahalle-Team" line). Required for third-party/CC images. */
    coverCredit: z.string().optional(),
    coverCreditUrl: z.string().url().optional(),
    /** CSS object-position for the cover crop (e.g. "bottom", "center 80%"). Default center. */
    coverPosition: z.string().optional(),
    /** Article-header cover sizing: 'crop' (fixed-height band, default) or 'full' (whole image, native aspect). Index thumbnails always crop. */
    coverFit: z.enum(['crop', 'full']).optional(),
    /** Dedicated link-preview image, exactly 1200×630 (the card format). Optional: without it the cover is used as-is and platforms crop it from the centre — a square portrait loses the top of the head. Its real width/height are declared in the og tags. */
    ogImage: image().optional(),
    galleryImages: z.array(image()).optional(),
    postLayout: z.enum(['standard', 'hero', 'gallery']).default('standard'),
    /** First-paragraph emphasis. `false` for guest posts published verbatim: the larger first paragraph is OUR emphasis, and it lands unevenly (a long opening paragraph vs. a one-line greeting, a date line, a headline). */
    lede: z.boolean().default(true),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
