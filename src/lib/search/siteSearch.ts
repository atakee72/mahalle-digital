// Site-wide search — PURE (no driver, no astro:content): row types shared by
// the API, the results page and the masthead modal, the per-section
// constants, the event-link/day helpers and the in-memory blog leg. The
// Mongo legs live in siteSearchStore.ts (server). 2026-09-25.
import { buildSearchRegex, excerptAround, type PostKind, type SearchResult } from '../forum/searchQuery';
import { compareNewest } from '../blog/beilage';

export type SearchSection = 'forum' | 'calendar' | 'marketplace' | 'news' | 'blog';
export const SECTIONS: readonly SearchSection[] = ['forum', 'calendar', 'marketplace', 'news', 'blog'];

/** Label key in kiosk-i18n (the nav's own words). Literal union, not string:
 *  `$t` is a Record over the dictionary's keys, a plain string index would
 *  not type-check (tsc budget). */
export type SectionLabelKey = 'nav.forum' | 'nav.calendar' | 'nav.marketplace' | 'nav.news' | 'nav.blog';
export const SECTION_LABEL_KEY: Record<SearchSection, SectionLabelKey> = {
  forum: 'nav.forum', calendar: 'nav.calendar', marketplace: 'nav.marketplace', news: 'nav.news', blog: 'nav.blog',
};
/** Kicker colour per section on paper — the page accents; Markt takes the
 *  darker ochre of its floating „+" (plain ochre has no contrast on paper). */
export const SECTION_ACCENT: Record<SearchSection, string> = {
  forum: 'var(--k-wine)', calendar: 'var(--k-teal)', marketplace: '#b97a1a', news: 'var(--k-ink)', blog: 'var(--k-rust)',
};

export const SEARCH_PER_SECTION = 20; // per non-forum section; the forum keeps 30 posts + 20 comments
export const MODAL_PER_SECTION = 3;   // live hits per section in the masthead modal

export type HitKind = PostKind | 'comment' | 'event' | 'sell' | 'exchange' | 'gift' | 'news' | 'post';

export interface SiteHit {
  section: SearchSection;
  kind: HitKind;
  id: string;
  href: string;
  title: string;          // comment: the parent post's title
  excerpt: string;        // ≤ 160 chars around the first match — never a body
  date: string | null;    // ISO: forum/news/blog published, calendar START, listing updated
  sub: string | null;     // one secondary label: author name · event location · news source · blog author
  tags?: string[];
  price?: number | null;  // listings of kind 'sell'
  allDay?: boolean;       // events
}

export interface SiteSearchResult {
  q: string;
  hits: Record<SearchSection, SiteHit[]>;
}

export function emptyHits(): Record<SearchSection, SiteHit[]> {
  return { forum: [], calendar: [], marketplace: [], news: [], blog: [] };
}

export function countHits(r: SiteSearchResult): { total: number; bySection: Record<SearchSection, number> } {
  const bySection = { forum: 0, calendar: 0, marketplace: 0, news: 0, blog: 0 } as Record<SearchSection, number>;
  let total = 0;
  for (const s of SECTIONS) { bySection[s] = r.hits[s]?.length ?? 0; total += bySection[s]; }
  return { total, bySection };
}

// ─── Calendar helpers ──────────────────────────────────────────────────
function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** YYYY-MM-DD of an instant in Europe/Berlin (en-CA prints ISO order). */
export function berlinDay(v: unknown): string | null {
  const d = toDate(v);
  if (!d) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Same link the event modal's „teilen" builds — `d` lands the calendar on
 *  the right month; without a valid start there is no `d` at all. */
export function eventHref(id: string, startDate: unknown): string {
  const d = berlinDay(startDate);
  return d ? `/calendar?event=${id}&d=${d}` : `/calendar?event=${id}`;
}

/** „Sa., 26.09. · 10:00" / "Sat 26/09 · 10:00" — all-day drops the time. */
export function eventDayLabel(iso: string | null | undefined, locale: 'de' | 'en', allDay: boolean): string {
  const d = toDate(iso);
  if (!d) return '';
  const tag = locale === 'de' ? 'de-DE' : 'en-GB';
  const day = new Intl.DateTimeFormat(tag, { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit' }).format(d);
  if (allDay) return day;
  const time = new Intl.DateTimeFormat(tag, { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${day} · ${time}`;
}

// ─── Blog leg (in memory — the collection is 12 files, not a table) ────
export interface BlogSearchEntry {
  id: string;            // = the slug (/blog/<id>)
  title: string;
  description: string;
  tags: string[];
  author: string;
  draft: boolean;
  pubDateISO: string;
  sortISO?: string;      // order-only `sortDate`, like the blog index
  body: string;          // raw MDX
}

/** Raw MDX → searchable words: import/export lines, JSX tags, markdown
 *  link/image syntax and emphasis marks go; whitespace collapses. */
export function plainMdx(body: string): string {
  if (!body) return '';
  return body
    .replace(/^(import|export) .*$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')   // ![alt](src) → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ')    // [text](href) → text
    .replace(/<[^>]+>/g, ' ')                      // JSX / HTML tags
    .replace(/^[#>\s]+/gm, ' ')                    // headings, quotes
    .replace(/[*_`~]/g, '')                        // emphasis, code marks
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchBlogEntries(entries: BlogSearchEntry[], q: string, max = SEARCH_PER_SECTION): SiteHit[] {
  const rx = buildSearchRegex(q);
  return entries
    .filter((e) => !e.draft)
    .map((e) => ({ e, plain: plainMdx(e.body) }))
    .filter(({ e, plain }) => rx.test(e.title) || rx.test(e.description) || e.tags.some((t) => rx.test(t)) || rx.test(plain))
    .sort((a, b) => compareNewest(a.e, b.e))
    .slice(0, max)
    .map(({ e, plain }) => ({
      section: 'blog' as const, kind: 'post' as const, id: e.id, href: `/blog/${e.id}`,
      title: e.title,
      excerpt: rx.test(plain) ? excerptAround(plain, q) : e.description,
      date: e.pubDateISO, sub: e.author, tags: e.tags,
    }));
}

// ─── Forum leg adapter (searchForum() rows → SiteHit) ──────────────────
export function forumToHits(r: SearchResult): SiteHit[] {
  const posts: SiteHit[] = r.posts.map((p) => ({
    section: 'forum', kind: p.kind, id: p._id, href: p.href, title: p.title, excerpt: p.excerpt,
    date: p.date, sub: p.author?.name ?? null, tags: p.tags,
  }));
  const comments: SiteHit[] = r.comments.map((c) => ({
    section: 'forum', kind: 'comment', id: c._id, href: c.href, title: c.parentTitle, excerpt: c.excerpt,
    date: c.date, sub: null,
  }));
  return [...posts, ...comments];
}
