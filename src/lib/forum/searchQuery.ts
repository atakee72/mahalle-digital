// Pure helpers for the forum search (dependency-free: imported by the
// server store AND the search island). Rules: trimmed query of 2–80
// characters, regex-escaped before it reaches Mongo, bodies never leave
// the server whole — an excerpt around the first match does.

export const SEARCH_MIN_LEN = 2;
export const SEARCH_MAX_LEN = 80;
export const EXCERPT_LEN = 160;

export type PostKind = 'discussion' | 'announcement' | 'recommendation';
export type PostCollection = 'topics' | 'announcements' | 'recommendations';

export const KIND_BY_COLLECTION: Record<PostCollection, PostKind> = {
  topics: 'discussion',
  announcements: 'announcement',
  recommendations: 'recommendation',
};

export const PATH_BY_KIND: Record<PostKind, '/topics' | '/announcements' | '/recommendations'> = {
  discussion: '/topics',
  announcement: '/announcements',
  recommendation: '/recommendations',
};

// Result rows as the API ships them (slim: excerpt, not body; allowlisted
// author fields only; comments carry no author at all).
export interface SearchPost {
  _id: string;
  kind: PostKind;
  href: string;
  title: string;
  excerpt: string;
  tags: string[];
  date: string | null;
  author: { name: string | null; handle: string | null } | null;
}
export interface SearchComment {
  _id: string;
  href: string;
  excerpt: string;
  date: string | null;
  parentTitle: string;
}
export interface SearchResult {
  q: string;
  posts: SearchPost[];
  comments: SearchComment[];
}

export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const q = raw.replace(/\s+/g, ' ').trim();
  if (q.length < SEARCH_MIN_LEN || q.length > SEARCH_MAX_LEN) return null;
  return q;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

export function buildSearchRegex(q: string): RegExp {
  return new RegExp(escapeRegex(q), 'i');
}

export function buildPostSearchFilter(q: string): Record<string, unknown> {
  const rx = buildSearchRegex(q);
  return { $or: [{ title: rx }, { body: rx }, { tags: rx }] };
}

export function excerptAround(text: unknown, q: string, len = EXCERPT_LEN): string {
  if (typeof text !== 'string' || !text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= len) return flat;
  const idx = q ? flat.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (idx === -1) return flat.slice(0, len - 1).trimEnd() + '…';
  const half = Math.floor((len - q.length) / 2);
  let start = Math.max(0, idx - half);
  const end = Math.min(flat.length, start + len);
  if (end - start < len) start = Math.max(0, end - len);
  let out = flat.slice(start, end).trim();
  if (start > 0) out = '…' + out;
  if (end < flat.length) out = out + '…';
  return out;
}
