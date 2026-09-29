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

export interface ForumStats { total: number; newSinceYesterday: number; discussedToday: number }
export interface ForumPeek { kind: 'discussion' | 'announcement' | 'recommendation'; title: string; tags: string[]; createdAt: string; image?: string; likes?: number; comments?: number; saves?: number }
export interface CalendarUpcoming { dateISO: string; title: string; category: string; allDay: boolean; startISO: string }
export interface CalendarPeek { monthCount: number; days: { day: number; category: string }[]; upcoming?: CalendarUpcoming[] }
export interface MarketStats { available: number; newSinceYesterday: number; fresh: number }
export interface ListingPeek { title: string; image: string | null; kind: 'sell' | 'exchange' | 'gift'; price: number | null; photos?: number; createdAt?: string }
export interface KurierStats { issue: number; articles: number; sources: number; today: boolean }
export interface KurierPeek { title: string; sourceName: string; sourceUrl: string; imageUrl?: string; sektion?: string }
export interface AirComponents { pm10: number | null; no2: number | null; o3: number | null; co: number | null }
export interface KiezPop { period: string | null; rows: { code?: string; name: string; residents: number }[]; total: number }
export interface KiezPeek { stand: string | null; areas: number | null; kw: number; lqiWeekMean: number | null; components: AirComponents | null; readingAt: string | null; pop?: KiezPop | null }
export interface SchaufensterData {
  forum: ForumPeek | null; forumPeeks?: ForumPeek[]; forumStats?: ForumStats | null;
  calendar?: CalendarPeek | null;
  listing: ListingPeek | null; listings?: ListingPeek[]; marketStats?: MarketStats | null;
  kurierStats?: KurierStats | null;
  kiez?: KiezPeek | null;
}
export interface BlogPeek { slug: string; title: string; description: string; pubDateISO: string; coverSrc?: string; author?: string; minutes?: number }
export interface BlogMeta { total: number; latestISO: string | null; tags: { tag: string; n: number }[] }

export interface FrameInput {
  rows: { kind: string; value?: number }[];
  population: number | null;
  airGrade: number | null;
  airSpark: (number | null)[];
  kurier: KurierPeek[];
  /** Absent on payloads cached before this field existed — treated as empty. */
  schaufenster?: Partial<SchaufensterData> | null;
  blog: BlogPeek | null;
  /** Newest posts, first = `blog`; absent = only `blog`. */
  blogs?: BlogPeek[];
  blogMeta?: BlogMeta | null;
  computedAt?: string;
}

export type Live =
  | { key: 'forum'; kind: ForumPeek['kind']; title: string; tags: string[]; createdAt: string; image?: string; likes?: number; comments?: number; saves?: number; stats: ForumStats | null; more: ForumPeek[] }
  | { key: 'calendar'; monthCount: number | null; days: { day: number; category: string }[]; upcoming: CalendarUpcoming[] }
  | { key: 'marketplace'; title: string; image: string | null; kind: ListingPeek['kind']; price: number | null; photos: number | null; createdAt: string | null; stats: MarketStats | null; more: ListingPeek[] }
  | { key: 'newsboard'; lead: KurierPeek; more: KurierPeek[]; stats: KurierStats | null }
  | { key: 'schillerkiez'; airGrade: number | null; airSpark: (number | null)[]; population: number | null; kiez: KiezPeek | null }
  | { key: 'blog'; slug: string; title: string; description: string; pubDateISO: string; coverSrc?: string; author?: string; minutes?: number; meta: BlogMeta | null; more: BlogPeek[] };

export interface Frame { key: SectionKey; href: string; live: Live | null; fallback: string | null }

const hasText = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function liveFor(key: SectionKey, input: FrameInput): Live | null {
  const sf = input.schaufenster ?? {};
  switch (key) {
    case 'forum': {
      const f = sf.forum; if (!f || !hasText(f.title)) return null;
      return { key, kind: f.kind, title: f.title.trim(), tags: (f.tags ?? []).filter(hasText).slice(0, 3), createdAt: f.createdAt,
        image: hasText(f.image) ? f.image : undefined, likes: num(f.likes), comments: num(f.comments), saves: num(f.saves), stats: sf.forumStats ?? null,
        more: (sf.forumPeeks ?? []).slice(1, 3).filter((p) => hasText(p.title)).map((p) => ({ ...p, title: p.title.trim(), tags: (p.tags ?? []).filter(hasText).slice(0, 3) })) };
    }
    case 'calendar': {
      const cal = sf.calendar ?? null;
      if (!cal) return null;
      return { key, monthCount: cal.monthCount, days: cal.days ?? [], upcoming: (cal.upcoming ?? []).filter((u) => hasText(u.title) && hasText(u.startISO)).slice(0, 4) };
    }
    case 'marketplace': {
      const l = sf.listing; if (!l || !hasText(l.title)) return null;
      return { key, title: l.title.trim(), image: hasText(l.image) ? l.image : null, kind: l.kind, price: l.kind === 'sell' && typeof l.price === 'number' ? l.price : null,
        photos: typeof l.photos === 'number' ? l.photos : null, createdAt: hasText(l.createdAt) ? l.createdAt : null, stats: sf.marketStats ?? null,
        more: (sf.listings ?? []).slice(1, 3).filter((p) => hasText(p.title)) };
    }
    case 'newsboard': {
      const items = (input.kurier ?? []).filter((k) => hasText(k.title));
      if (items.length === 0) return null;
      return { key, lead: items[0], more: items.slice(1, 3), stats: sf.kurierStats ?? null };
    }
    case 'schillerkiez': {
      const spark = input.airSpark ?? [];
      const alive = input.airGrade != null || spark.some((v) => v != null) || input.population != null;
      return alive ? { key, airGrade: input.airGrade, airSpark: spark, population: input.population, kiez: sf.kiez ?? null } : null;
    }
    case 'blog': {
      const b = input.blog; if (!b || !hasText(b.title)) return null;
      return { key, slug: b.slug, title: b.title.trim(), description: b.description ?? '', pubDateISO: b.pubDateISO, coverSrc: b.coverSrc, author: b.author, minutes: b.minutes, meta: input.blogMeta ?? null,
        more: (input.blogs ?? []).slice(1, 3).filter((p) => hasText(p.title)) };
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

/** Europe/Berlin calendar parts of an ISO instant. */
export function berlinYearMonth(iso: string): { year: number; month: number; day: number } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { year: g('year'), month: g('month'), day: g('day') };
}

/** 42 month-grid cells, Monday first; `null` day = padding. Category = the first event's category that day. */
export function monthCells(year: number, month1to12: number, days: { day: number; category: string }[]): { day: number | null; category: string | null }[] {
  const first = new Date(Date.UTC(year, month1to12 - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // 0 = Monday
  const count = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  const byDay = new Map<number, string>();
  for (const d of days) if (!byDay.has(d.day)) byDay.set(d.day, d.category);
  const cells: { day: number | null; category: string | null }[] = [];
  for (let i = 0; i < 42; i++) {
    const day = i - lead + 1;
    cells.push(day >= 1 && day <= count ? { day, category: byDay.get(day) ?? null } : { day: null, category: null });
  }
  return cells;
}
