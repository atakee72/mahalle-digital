// SERVER-ONLY (astro:content — a virtual module of the Astro build; fine in
// src/lib the way src/pages/sitemap.xml.ts uses it, never importable by a
// unit test — which is why the leg itself is the pure searchBlogEntries()).
// Returns EVERY entry incl. drafts; the pure leg drops drafts, so the rule
// is under test.
import { getCollection } from 'astro:content';
import type { BlogSearchEntry } from './siteSearch';

export async function loadBlogSearchEntries(): Promise<BlogSearchEntry[]> {
  const entries = await getCollection('blog');
  return entries.map((e) => ({
    id: e.id,
    title: e.data.title,
    description: e.data.description,
    tags: e.data.tags,
    author: e.data.author,
    draft: e.data.draft,
    pubDateISO: e.data.pubDate.toISOString(),
    sortISO: e.data.sortDate?.toISOString(),
    body: e.body ?? '',
  }));
}
