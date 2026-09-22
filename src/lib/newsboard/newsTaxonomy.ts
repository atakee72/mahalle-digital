// src/lib/newsboard/newsTaxonomy.ts
//
// PURE module — no server-only imports. Imported by both Astro pages (server)
// and Svelte islands (client). Maps the real DB free-string fields
// (aiCategory / sourceName / source) onto the design's fixed taxonomy.
//
// Source of truth for the taxonomy values: design handoff
// jsx/kiosk-newsboard.jsx (`news.sektion` + `news.quelle`).

export type SektionKey =
  | 'politik' | 'kultur' | 'lokales' | 'wirtschaft'
  | 'verkehr' | 'klima' | 'sport';

export type QuelleKey =
  | 'rbb' | 'tsp' | 'taz' | 'bzb' | 'bmp'
  | 'nwk' | 'nkn' | 'nd' | 'newsdata' | 'user';

export const SEKTION_KEYS: SektionKey[] = [
  'politik', 'kultur', 'lokales', 'wirtschaft', 'verkehr', 'klima', 'sport',
];

// CSS-var token name per sektion (defined in tokens-newsboard.css).
export const SEKTION_TOKEN: Record<SektionKey, string> = {
  politik: '--sektion-politik',
  kultur: '--sektion-kultur',
  lokales: '--sektion-lokales',
  wirtschaft: '--sektion-wirtschaft',
  verkehr: '--sektion-verkehr',
  klima: '--sektion-klima',
  sport: '--sektion-sport',
};

// Quelle display: short letter-mark + full name + accent token.
export const QUELLE_META: Record<QuelleKey, { name: string; short: string; token: string }> = {
  rbb:      { name: 'rbb24',                   short: 'rbb', token: '--quelle-rbb' },
  tsp:      { name: 'Tagesspiegel',            short: 'TS',  token: '--quelle-tsp' },
  taz:      { name: 'taz',                     short: 'taz', token: '--quelle-taz' },
  bzb:      { name: 'BZ Berlin',               short: 'BZ',  token: '--quelle-bzb' },
  bmp:      { name: 'Berliner Morgenpost',     short: 'BM',  token: '--quelle-bmp' },
  nwk:      { name: 'Neuköllner Wochenkurier', short: 'NWK', token: '--quelle-nwk' },
  nkn:      { name: 'neukoellner.net',         short: 'n.n', token: '--quelle-nkn' },
  nd:       { name: 'Neues Deutschland',       short: 'ND',  token: '--quelle-nd' },
  newsdata: { name: 'NewsData',                short: 'ND·', token: '--quelle-newsdata' },
  user:     { name: 'eingereicht',             short: 'u·',  token: '--quelle-user' },
};

// Read-decay opacity scale (mirrors tokens-newsboard.css). Phase 1 always
// renders 'fresh'; Phase 3 wires the others.
export const READ_DECAY: Record<'fresh' | 'seen' | 'archived', number> = {
  fresh: 1,
  seen: 0.55,
  archived: 0.32,
};

// Heat threshold — chip appears at >= this many linking forum posts.
export const HEAT_THRESHOLD = 2;

// ── Resolvers ──────────────────────────────────────────────────────────────

// Map free-string aiCategory → one of the 7 sektions. Best-effort substring
// match; defaults to 'lokales' (the catch-all for neighborhood news).
export function resolveSektion(aiCategory?: string | null): SektionKey {
  const c = (aiCategory ?? '').toLowerCase();
  if (/(polit|senat|wahl|bvv|bezirksverordnet)/.test(c)) return 'politik';
  if (/(kultur|kunst|musik|festival|karneval|kino|theater|culture)/.test(c)) return 'kultur';
  if (/(verkehr|transit|u-?bahn|fahrrad|stra(ss|ß)e|mobilit)/.test(c)) return 'verkehr';
  if (/(wirtschaft|economy|gewerbe|markt|handel|business)/.test(c)) return 'wirtschaft';
  if (/(klima|umwelt|climate|feinstaub|luft|energie)/.test(c)) return 'klima';
  if (/(sport|fu(ss|ß)ball|verein|liga)/.test(c)) return 'sport';
  return 'lokales';
}

// Map (sourceName, source) → quelle key. user_submitted always wins.
export function resolveQuelle(sourceName?: string | null, source?: string | null): QuelleKey {
  if (source === 'user_submitted') return 'user';
  const s = (sourceName ?? '').toLowerCase();
  if (s.includes('rbb')) return 'rbb';
  if (s.includes('tagesspiegel')) return 'tsp';
  if (s.includes('taz')) return 'taz';
  if (s.includes('bz') && s.includes('berlin')) return 'bzb';
  if (s.includes('morgenpost')) return 'bmp';
  if (s.includes('wochenkurier')) return 'nwk';
  if (s.includes('neukoellner') || s.includes('neuköllner.net')) return 'nkn';
  if (s.includes('neues deutschland') || s === 'nd' || s.includes('nd-aktuell')) return 'nd';
  // Unknown RSS / API source → render with the neutral NewsData styling.
  return 'newsdata';
}

// „Aus dem Kiez" (2026-09-22, user decision): articles from Kiez / Neukölln
// sources are printed as INK cards on the board so they stay visible now that
// the day is ordered by publish time instead of the GPT score. ONE list, by
// sourceName only — a member-submitted Tagesspiegel link is not Kiez. Edit
// freely; lowercase substrings, umlaut variants spelled out.
export const KIEZ_SOURCE_PATTERNS: readonly string[] = [
  'schillerkiez', 'schillerpromenade', 'facetten neukölln', 'facettenneukoelln', 'facetten neukoelln',
  'kiez und kneipe', 'kiezundkneipe', 'wochenkurier', 'neukoellner', 'neuköllner', 'nachbarschaftstreff', 'neukölln', 'neukoelln',
];

export function isKiezSource(sourceName?: string | null): boolean {
  const s = (sourceName ?? '').toLowerCase();
  return s.length > 0 && KIEZ_SOURCE_PATTERNS.some((p) => s.includes(p));
}

// View-model the cards/orchestrator pass around (resolved from the DB NewsItem).
export interface NewsVM {
  id: string;
  title: string;
  titleEN?: string;
  dek: string;          // from description (or first summary line)
  summary: string;      // aiSummary / description body
  quelle: QuelleKey;
  sektion: SektionKey;
  kiez: boolean;         // source is a Kiez / Neukölln outlet → ink card
  imageUrl: string;
  sourceUrl: string;
  publishedAt: string;  // ISO
  fetchDate?: string;
  submitterName?: string;
  forumLinks: number;   // always 0 in phase 1
  saved: boolean;
  read: boolean;        // always false in phase 1
  archived: boolean;    // always false in phase 1
  moderationStatus: 'approved' | 'pending' | 'rejected';
  warningText?: string;
}

// Prop-safe article-detail shape (serialized for crossing the island boundary).
// Lives here (pure module) so the detail island can import the type without
// touching the mongodb-importing newsQuery.ts.
export interface NewsDetail {
  id: string;
  source: 'ai_fetched' | 'user_submitted';
  title: string;
  description: string;
  aiSummary?: string;
  imageUrl: string;
  sourceUrl: string;
  sourceName: string;
  aiCategory?: string;
  moderationStatus: 'approved' | 'pending' | 'rejected';
  warningText?: string;
  submittedByName?: string;
  publishedAt: string; // ISO
  fetchDate?: string;
  approvedAt?: string;  // ISO
}
