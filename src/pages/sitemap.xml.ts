import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

// Public, ungated endpoint. Prerendered: content only changes at build time
// (static routes + build-time blog collection), so it ships as a static file.
export const prerender = true;

const SITE = 'https://mahalle.digital';

const STATIC_PATHS = ['/', '/blog', '/schillerkiez', '/impressum', '/datenschutz', '/foerderung'];

export const GET: APIRoute = async () => {
  const posts = await getCollection('blog', ({ data }) => data.draft !== true);

  const urls: { loc: string; lastmod?: string }[] = [
    ...STATIC_PATHS.map((p) => ({ loc: new URL(p, SITE).href })),
    ...posts.map((post) => ({
      loc: new URL(`/blog/${post.id}`, SITE).href,
      lastmod: (post.data.updatedDate ?? post.data.pubDate).toISOString().slice(0, 10),
    })),
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(
      (u) =>
        `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`
    ),
    '</urlset>',
    '',
  ].join('\n');

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
