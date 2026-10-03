/**
 * Kiez-Brief — the weekly member e-mail. Pure rules, NO imports: the panel island imports the
 * mode type, the server the rest. Design: docs/superpowers/specs/2026-10-03-kiez-brief-newsletter-design.md
 */
export const NEWSLETTER_MODES = ['weekly', 'off'] as const;
export type NewsletterMode = (typeof NEWSLETTER_MODES)[number];

export function storedNewsletterMode(v: unknown): NewsletterMode {
  return v === 'off' ? 'off' : 'weekly';
}

/** Resend Free sends 100 mails per UTC day; the auth mails of that day need the rest. */
export const MAX_RECIPIENTS = 95;

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WINDOW_MS = 7 * DAY_MS;

/** Caps per section (the mail is a glance, not an archive). */
export const MAX_POSTS = 8;
export const MAX_EVENTS = 8;
export const MAX_LISTINGS = 6;

/** The placeholder the template prints for the unsubscribe link; replaced per recipient. */
export const UNSUB_PLACEHOLDER = '%%UNSUB%%';

// ── Berlin calendar helpers (no Intl option objects shared across calls) ────────────────

function berlinParts(ms: number): { y: number; m: number; d: number; wd: number; hh: number; mm: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), wd, hh: Number(get('hour')) % 24, mm: Number(get('minute')) };
}

/** Berlin weekday of an instant: 0 = Sunday … 6 = Saturday. */
export function berlinWeekday(ms: number): number {
  return berlinParts(ms).wd;
}

/** ISO week key ('2026-W41') of a Berlin calendar day. */
export function isoWeek(ms: number): string {
  const { y, m, d } = berlinParts(ms);
  // ISO week maths on a UTC date built from the Berlin calendar day (time of day is irrelevant).
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7; // Mon=1 … Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // Thursday of this ISO week
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * The key of the issue a run belongs to: the ISO week of `now − 24 h`. Sunday 18:00 and the
 * Monday 06:00 UTC fallback must land on the SAME key — Monday already belongs to the next ISO
 * week, so a naive isoWeek(now) would let the fallback send a second mail.
 */
export function issueWeek(nowMs: number): string {
  return isoWeek(nowMs - DAY_MS);
}

/** „KW 41" for the subject. */
export function weekLabel(week: string): string {
  return `KW ${Number(week.slice(-2))}`;
}

export interface IssueWindow {
  fromMs: number; // posts/listings/blog since here …
  toMs: number;   // … up to the run
  aheadMs: number; // events up to here
}

export function windowFor(nowMs: number): IssueWindow {
  return { fromMs: nowMs - WINDOW_MS, toMs: nowMs, aheadMs: nowMs + WINDOW_MS };
}

// ── Issue data ────────────────────────────────────────────────────────────────────────

export type BriefPostKind = 'topic' | 'announcement' | 'recommendation';
export interface BriefPost { id: string; kind: BriefPostKind; title: string; author: string | null; comments: number; dateMs: number; excerpt: string | null; image: string | null }
export interface BriefEvent { id: string; title: string; startMs: number; allDay: boolean; location: string | null }
export interface BriefListing { id: string; title: string; kind: 'sell' | 'exchange' | 'gift'; price: number | null; createdMs: number; image: string | null }
export interface BriefBlogPost { slug: string; title: string; description: string; pubMs: number; cover: string | null }
export interface BriefAir { lqi: number }

export interface BriefData {
  week: string;
  posts: BriefPost[];
  events: BriefEvent[];
  listings: BriefListing[];
  blog: BriefBlogPost[];
  air: BriefAir | null;
}

export const POST_KIND_LABEL: Record<BriefPostKind, string> = {
  topic: 'Diskussion', announcement: 'Ankündigung', recommendation: 'Empfehlung',
};
export const LISTING_KIND_LABEL: Record<BriefListing['kind'], string> = {
  sell: 'Verkaufen', exchange: 'Tausch', gift: 'Verschenken',
};
export const AIR_LABEL: Record<number, string> = { 1: 'sehr gut', 2: 'gut', 3: 'mäßig', 4: 'schlecht', 5: 'sehr schlecht' };

/** Order and cap the sections: newest post first, nearest event first, newest listing/blog first. */
export function arrangeData(d: BriefData): BriefData {
  return {
    ...d,
    posts: [...d.posts].sort((a, b) => b.dateMs - a.dateMs || a.id.localeCompare(b.id)).slice(0, MAX_POSTS),
    events: [...d.events].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id)).slice(0, MAX_EVENTS),
    listings: [...d.listings].sort((a, b) => b.createdMs - a.createdMs || a.id.localeCompare(b.id)).slice(0, MAX_LISTINGS),
    blog: [...d.blog].sort((a, b) => b.pubMs - a.pubMs || a.slug.localeCompare(b.slug)),
    air: d.air && Number.isInteger(d.air.lqi) && d.air.lqi >= 1 && d.air.lqi <= 5 ? d.air : null,
  };
}

/** A quiet week has nothing in the four content sections (the air line alone is no reason to write). */
export function isQuiet(d: BriefData): boolean {
  return d.posts.length === 0 && d.events.length === 0 && d.listings.length === 0 && d.blog.length === 0;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** „Kiez-Brief · KW 41 · 3 neue Beiträge, 2 Termine" — the two biggest non-empty counts. */
export function subjectFor(d: BriefData): string {
  const parts: [number, string][] = [
    [d.posts.length, plural(d.posts.length, 'neuer Beitrag', 'neue Beiträge')],
    [d.events.length, plural(d.events.length, 'Termin', 'Termine')],
    [d.listings.length, plural(d.listings.length, 'neue Anzeige', 'neue Anzeigen')],
    [d.blog.length, plural(d.blog.length, 'Beilage-Artikel', 'Beilage-Artikel')],
  ];
  const named = parts.filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).slice(0, 2).map(([, s]) => s); // biggest first, stable
  return [`Kiez-Brief · ${weekLabel(d.week)}`, ...(named.length ? [named.join(', ')] : [])].join(' · ');
}

/** The hidden preview line: the newest forum title, else the next event, else the newest listing. */
export function preheaderFor(d: BriefData): string {
  return d.posts[0]?.title ?? d.events[0]?.title ?? d.listings[0]?.title ?? d.blog[0]?.title ?? 'Neues aus dem Schillerkiez';
}

/** Deep links carry the source so a visit from the mail is visible in the visitor counter later. */
export function withUtm(href: string): string {
  return href + (href.includes('?') ? '&' : '?') + 'utm_source=kiez-brief';
}

const WEEKDAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** „Di. 7.10. · 19:00" or „Sa. 11.10. · ganztägig" in Berlin time. */
export function fmtEventWhen(startMs: number, allDay: boolean): string {
  const p = berlinParts(startMs);
  const day = `${WEEKDAY[p.wd]}. ${p.d}.${p.m}.`;
  return allDay ? `${day} · ganztägig` : `${day} · ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
}

/** „12 €" / „12,50 €"; null for exchange/gift. */
export function fmtPrice(price: number | null): string | null {
  if (price === null || !Number.isFinite(price)) return null;
  const s = Number.isInteger(price) ? String(price) : price.toFixed(2).replace('.', ',');
  return `${s} €`;
}

/** The first ~140 characters of a post body as one line: tags, markdown marks and links stripped. */
export function excerptOf(body: unknown, max = 140): string | null {
  if (typeof body !== 'string') return null;
  const text = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#*_>`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 60)).trimEnd() + ' …';
}

/** A Cloudinary URL for a fixed-width thumbnail (the mail never downloads the full photo); anything else unchanged. */
export function thumb(url: unknown, w: number): string | null {
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  if (!url.includes('res.cloudinary.com/') || !url.includes('/upload/')) return url;
  const bare = url.replace(/\/upload\/f_auto,q_auto(?:,w_\d+,c_fill)?\//, '/upload/');
  return bare.replace('/upload/', `/upload/f_auto,q_auto,w_${w},h_${w},c_fill/`);
}

/** RFC 8058 one-click headers; the mailto: is the fallback for clients without the POST path. */
export function unsubscribeHeaders(postUrl: string, mailto: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${postUrl}>, <mailto:${mailto}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
