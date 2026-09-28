// src/lib/landing/frames.ts
/**
 * Landing „Das Schaufenster" (2026-09-28): six phone-shaped frames, one per
 * main section, each drawn live from the landing payload with a PER-FRAME
 * zero rule — live content, else the section's static screenshot, else the
 * frame is omitted. Dependency-pure: imported by the SSR island and tested
 * without Mongo. Never carries a member's name, handle or avatar.
 */
export type SectionKey = 'forum' | 'calendar' | 'marketplace' | 'newsboard' | 'schillerkiez' | 'blog';

export const SECTION_ORDER: readonly SectionKey[] = ['forum', 'calendar', 'marketplace', 'newsboard', 'schillerkiez', 'blog'];

export const SECTION_HREF: Record<SectionKey, string> = {
  forum: '/forum',
  calendar: '/calendar',
  marketplace: '/marketplace',
  newsboard: '/newsboard',
  schillerkiez: '/schillerkiez',
  blog: '/blog',
};

export interface ForumPeek { kind: 'discussion' | 'announcement' | 'recommendation'; title: string; tags: string[]; createdAt: string }
export interface EventPeek { title: string; startISO: string; allDay: boolean; category: string | null }
export interface ListingPeek { title: string; image: string | null; kind: 'sell' | 'exchange' | 'gift'; price: number | null }
export interface SchaufensterData { forum: ForumPeek | null; event: EventPeek | null; listing: ListingPeek | null }
export interface KurierPeek { title: string; sourceName: string; sourceUrl: string; imageUrl?: string }
export interface BlogPeek { slug: string; title: string; description: string; pubDateISO: string; coverSrc?: string }

export interface FrameInput {
  rows: { kind: string; value?: number }[];
  population: number | null;
  airGrade: number | null;
  airSpark: (number | null)[];
  kurier: KurierPeek[];
  /** Absent on payloads cached before this field existed — treated as empty. */
  schaufenster?: Partial<SchaufensterData> | null;
  blog: BlogPeek | null;
}

export type Live =
  | { key: 'forum'; kind: ForumPeek['kind']; title: string; tags: string[]; createdAt: string; weekCount: number }
  | { key: 'calendar'; title: string; startISO: string; allDay: boolean; category: string | null; weekendCount: number }
  | { key: 'marketplace'; title: string; image: string | null; kind: ListingPeek['kind']; price: number | null }
  | { key: 'newsboard'; lead: KurierPeek; more: KurierPeek[] }
  | { key: 'schillerkiez'; airGrade: number | null; airSpark: (number | null)[]; population: number | null }
  | { key: 'blog'; slug: string; title: string; description: string; pubDateISO: string; coverSrc?: string };

export interface Frame { key: SectionKey; href: string; live: Live | null; fallback: string | null }

const hasText = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;

function rowValue(rows: FrameInput['rows'], kind: string): number {
  const v = rows.find((r) => r.kind === kind)?.value;
  return typeof v === 'number' && v > 0 ? v : 0;
}

function liveFor(key: SectionKey, input: FrameInput): Live | null {
  const sf = input.schaufenster ?? {};
  switch (key) {
    case 'forum': {
      const f = sf.forum;
      if (!f || !hasText(f.title)) return null;
      return { key, kind: f.kind, title: f.title.trim(), tags: (f.tags ?? []).filter(hasText).slice(0, 3), createdAt: f.createdAt, weekCount: rowValue(input.rows, 'forum') };
    }
    case 'calendar': {
      const e = sf.event;
      if (!e || !hasText(e.title)) return null;
      return { key, title: e.title.trim(), startISO: e.startISO, allDay: e.allDay === true, category: e.category ?? null, weekendCount: rowValue(input.rows, 'events') };
    }
    case 'marketplace': {
      const l = sf.listing;
      if (!l || !hasText(l.title)) return null;
      return { key, title: l.title.trim(), image: hasText(l.image) ? l.image : null, kind: l.kind, price: l.kind === 'sell' && typeof l.price === 'number' ? l.price : null };
    }
    case 'newsboard': {
      const items = (input.kurier ?? []).filter((k) => hasText(k.title));
      if (items.length === 0) return null;
      return { key, lead: items[0], more: items.slice(1, 3) };
    }
    case 'schillerkiez': {
      const spark = input.airSpark ?? [];
      const alive = input.airGrade != null || spark.some((v) => v != null) || input.population != null;
      return alive ? { key, airGrade: input.airGrade, airSpark: spark, population: input.population } : null;
    }
    case 'blog': {
      const b = input.blog;
      if (!b || !hasText(b.title)) return null;
      return { key, slug: b.slug, title: b.title.trim(), description: b.description ?? '', pubDateISO: b.pubDateISO, coverSrc: b.coverSrc };
    }
  }
}

export function buildFrames(input: FrameInput, fallbacks: Partial<Record<SectionKey, string>>): Frame[] {
  const out: Frame[] = [];
  for (const key of SECTION_ORDER) {
    const live = liveFor(key, input);
    const fallback = hasText(fallbacks[key]) ? (fallbacks[key] as string) : null;
    if (!live && !fallback) continue;
    out.push({ key, href: SECTION_HREF[key], live, fallback });
  }
  return out;
}
