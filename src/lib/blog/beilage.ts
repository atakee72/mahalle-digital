// „Die Beilage" — pure derivation helpers for the kiosk blog surface.
// Client-safe: imported by Svelte islands AND .astro frontmatter.
// All derivations run over the serialized BeilagePost shape, never
// over CollectionEntry (keeps this file dependency-pure).

export type BlogLocale = 'de' | 'en';

export interface BeilagePost {
  id: string;
  title: string;
  description: string;
  pubDateISO: string;            // ISO 8601
  updatedDateISO?: string;       // ISO 8601
  author?: string;
  tags: string[];
  layout: 'standard' | 'hero' | 'gallery';
  minutes: number;               // Lesezeit, precomputed at serialization
  cover?: string;                // processed asset URL (image().src)
  coverWidth?: number;           // intrinsic px (image().width/height) — width/height attrs on the article <img> reserve the box, no CLS on coverFit: full
  coverHeight?: number;
  coverAlt?: string;
  coverCredit?: string;
  coverCreditUrl?: string;
  coverPosition?: string;
  coverFit?: 'crop' | 'full';
}

/** Lesezeit: word count / 200 wpm, minimum 1 (novel §01). */
export function readingMinutes(body: string): number {
  const words = body
    .replace(/^import .*$/gm, '')      // MDX import lines don't count
    .replace(/[#>*_`\[\]()!-]/g, ' ')  // light markdown strip
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

const dateFmt = (locale: BlogLocale) =>
  new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Berlin',
  });

/**
 * DE „8. Apr 2025" · EN „8 Apr 2025".
 * Month abbreviations: dots stripped AND truncated to 3 chars — German
 * ICU yields „März"/„Juni"/„Sept.", the design uses „Mär"/„Jun"/„Sep"
 * (en-GB also yields „Sept" on some ICU builds).
 */
const shortMonth = (raw: string) => raw.replace(/\./g, '').slice(0, 3);

export function fmtDate(iso: string, locale: BlogLocale): string {
  const parts = dateFmt(locale).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const month = shortMonth(get('month'));
  return locale === 'de'
    ? `${get('day')}. ${month} ${get('year')}`
    : `${get('day')} ${month} ${get('year')}`;
}

/** Uppercased kicker variant: „8. APR 2025" / „8 APR 2025". */
export function fmtDateKicker(iso: string, locale: BlogLocale): string {
  return fmtDate(iso, locale).toUpperCase();
}

/** Archive row label: „APR 2025" / „MÄR 2025" (3-char month, both locales). */
export function fmtMonthLabel(iso: string, locale: BlogLocale): string {
  const parts = new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    month: 'short', year: 'numeric', timeZone: 'Europe/Berlin',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${shortMonth(get('month')).toUpperCase()} ${get('year')}`;
}

/** Grouping key, e.g. '2025-04' (Europe/Berlin). */
export function monthKey(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', month: '2-digit', timeZone: 'Europe/Berlin',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}`;
}

export interface MonthGroup { key: string; iso: string; count: number; }

/** Month groups, newest first. Only months WITH posts (never empty rows). */
export function monthGroups(posts: BeilagePost[]): MonthGroup[] {
  const map = new Map<string, MonthGroup>();
  for (const p of posts) {
    const key = monthKey(p.pubDateISO);
    const g = map.get(key);
    if (g) g.count += 1;
    else map.set(key, { key, iso: p.pubDateISO, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.key.localeCompare(a.key));
}

export interface RelatedItem { post: BeilagePost; shared: string[]; }

/**
 * Novel §02 Rubrik-Rail: rank = count of shared tags, exclude self, max 3.
 * Ties and zero-shared fill: newest first. Zero-shared items get shared: []
 * (rendered as ZULETZT ERSCHIENEN).
 */
/**
 * THE blog order: newest first; posts with the SAME timestamp fall back to
 * their file id A→Z. Declared rule since 2026-09-18 — four election guest
 * posts were published in the same second, and their ids
 * (`wahl2026-<surname>`) make the tie resolve alphabetically by surname. A
 * title tiebreak would sort by FIRST name (titles start with it). Without a
 * tiebreak the order of simultaneous posts is whatever the loader returns.
 * Every sort of posts goes through this (index, tag page, related, № n/N).
 */
export function compareNewest(
  a: { id: string; pubDateISO: string },
  b: { id: string; pubDateISO: string }
): number {
  return b.pubDateISO.localeCompare(a.pubDateISO) || a.id.localeCompare(b.id);
}

/**
 * True when another post carries the exact same timestamp — i.e. the posts
 * were published together on purpose (election guest posts, 2026-09-18).
 * The index then gives NONE of them the lead card or a photo strip: the lead
 * slot and the first-in-column thumbnail are prominence, and alphabetical
 * order must not turn into a bigger picture for whoever is called Dehne — nor
 * into a disadvantage for a candidate who sent no photo.
 */
export function isSimultaneous(id: string, posts: Array<{ id: string; pubDateISO: string }>): boolean {
  const me = posts.find((p) => p.id === id);
  return !!me && posts.some((p) => p.id !== id && p.pubDateISO === me.pubDateISO);
}

/**
 * How many related slots a post gets. Normally 3. When its tag-mates include
 * posts that were published together (isSimultaneous), the rail shows ALL
 * tag-mates (capped at 8) — three slots would silently drop one of a group
 * whose whole point is equal treatment (2026-09-18: with the editorial intro
 * in the same tag, every candidate page lost the last candidate in the
 * alphabet, and the intro itself listed only three of the four).
 */
export function relatedSlots(currentId: string, posts: BeilagePost[]): number {
  const me = posts.find((p) => p.id === currentId);
  if (!me) return 3;
  const mates = posts.filter((p) => p.id !== currentId && p.tags.some((t) => me.tags.includes(t)));
  const grouped = isSimultaneous(currentId, posts) || mates.some((p) => isSimultaneous(p.id, posts));
  return grouped ? Math.min(Math.max(3, mates.length), 8) : 3;
}

export function relatedFor(currentId: string, posts: BeilagePost[], max = 3): RelatedItem[] {
  const current = posts.find((p) => p.id === currentId);
  if (!current) return [];
  return posts
    .filter((p) => p.id !== currentId)
    .map((post) => ({ post, shared: post.tags.filter((t) => current.tags.includes(t)) }))
    .sort((a, b) =>
      b.shared.length - a.shared.length || compareNewest(a.post, b.post))
    .slice(0, max);
}

/** [tag, count] pairs, count desc then alpha. */
export function tagCounts(posts: BeilagePost[]): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const p of posts) for (const t of p.tags) map.set(t, (map.get(t) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** № n/N: 1-based rank in ascending pubDate order (Decision 10). */
export function rankOf(id: string, posts: BeilagePost[]): { no: number; of: number } {
  // Exact reverse of compareNewest, so № counts down the listed order without swaps.
  const asc = [...posts].sort((a, b) => compareNewest(b, a));
  return { no: asc.findIndex((p) => p.id === id) + 1, of: asc.length };
}
