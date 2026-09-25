// Termin-Clipper v5 (2026-09-26): pure helpers around the LLM extraction.
// Dependency-free — imported by the API route (server) AND the /events/clip
// page script (browser). Never import mongodb/Sentry/env here.

export type ClipHint = {
  from?: string; to?: string; startTime?: string; endTime?: string; allDay?: boolean; location?: string;
};
export type ClipInput = { title: string; url: string; text: string; selection?: string; hint?: ClipHint };
export type ClipResult = {
  title: string | null;
  startDate: string | null;   // YYYY-MM-DD
  startTime: string | null;   // HH:MM (24h)
  endDate: string | null;
  endTime: string | null;
  allDay: boolean;
  location: string | null;
  summary: string | null;
  confidence: 'high' | 'medium' | 'low';
};
export type NormalizedClip = ClipResult & { dateFound: boolean };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const MAX_TITLE = 200;      // EventBaseSchema title max
const MAX_LOCATION = 200;   // EventBaseSchema location max
const MAX_SUMMARY = 600;
const MAX_DAYS_AWAY = 400;  // beyond this a date is a hallucination, not an event

/** Strict structured-output schema for chat.completions `response_format`. */
export const CLIP_JSON_SCHEMA = {
  name: 'mahalle_event_clip',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: ['string', 'null'], description: 'Short event title, max 120 chars, in the page language' },
      startDate: { type: ['string', 'null'], description: 'YYYY-MM-DD or null if the page states no date' },
      startTime: { type: ['string', 'null'], description: 'HH:MM 24h or null' },
      endDate: { type: ['string', 'null'], description: 'YYYY-MM-DD or null (same day → repeat startDate)' },
      endTime: { type: ['string', 'null'], description: 'HH:MM 24h or null' },
      allDay: { type: 'boolean' },
      location: { type: ['string', 'null'], description: 'Venue name and street if present, max 200 chars' },
      summary: { type: ['string', 'null'], description: '2–3 neutral sentences in the page language, no marketing' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['title', 'startDate', 'startTime', 'endDate', 'endTime', 'allDay', 'location', 'summary', 'confidence'],
  },
} as const;

/** Today's date in Europe/Berlin as YYYY-MM-DD (en-CA formats ISO-like). */
export function berlinTodayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function weekdayOf(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${isoDate}T12:00:00Z`));
}

export function buildClipMessages(input: ClipInput, todayISO: string): Array<{ role: 'system' | 'user'; content: string }> {
  const system = [
    'You extract ONE event from the visible text of a web page for a Berlin neighbourhood calendar.',
    `Today is ${weekdayOf(todayISO)}, ${todayISO} (timezone Europe/Berlin). Resolve relative dates ("Samstag", "morgen", "nächsten Freitag") against today; never invent a date that the text does not support — answer null instead.`,
    'A recurring schedule without a concrete calendar date ("jeden Abend", "immer montags", "wöchentlich", "every Tuesday") is NOT a date: answer startDate null and confidence low.',
    'Dates as YYYY-MM-DD, times as 24h HH:MM. If the page names a date but no start time, set allDay true. If a single-day event ends after midnight, endDate is the next day.',
    'Prefer the event the page is ABOUT over other events mentioned in navigation, teasers or listings. If the text is a listing of many events, extract the first one that has a full date.',
    'title: short, no venue, no date. location: venue name plus street if given. summary: 2–3 neutral sentences in the language of the page (German or English), no marketing phrases, no URLs.',
    'confidence: high = date, time and title are explicit; medium = one of them inferred; low = date missing or guessed.',
    'Hints marked as "structured hints" come from the page markup; trust them unless the text clearly contradicts them.',
  ].join('\n');

  const parts: string[] = [];
  parts.push(`Page title: ${input.title}`);
  parts.push(`Page URL: ${input.url}`);
  if (input.hint && Object.keys(input.hint).length) parts.push(`Structured hints from the page markup: ${JSON.stringify(input.hint)}`);
  if (input.selection) parts.push(`Text the user selected on the page (most relevant):\n${input.selection}`);
  parts.push(`Visible page text:\n${input.text}`);
  return [
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/** Tolerant JSON reader: strips ``` fences, returns null on any failure. */
export function parseClipJson(raw: string): unknown | null {
  const s = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}
function ymd(v: unknown): string | null {
  return typeof v === 'string' && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null;
}
function hhmm(v: unknown): string | null {
  return typeof v === 'string' && HHMM.test(v) ? v : null;
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function normalizeClipResult(raw: unknown, todayISO: string): NormalizedClip {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let startDate = ymd(o.startDate);
  if (startDate && Math.abs(daysBetween(todayISO, startDate)) > MAX_DAYS_AWAY) startDate = null; // Review Focus 1
  let startTime = startDate ? hhmm(o.startTime) : null;                                          // Review Focus 2
  let endDate = startDate ? (ymd(o.endDate) ?? startDate) : null;
  let endTime = startDate ? hhmm(o.endTime) : null;
  if (startDate && endDate && endDate < startDate) { endDate = startDate; endTime = null; }       // Review Focus 3: a nonsense end date makes its end time suspect too
  if (startDate && endDate === startDate && startTime && endTime && endTime <= startTime) endTime = null;
  if (startDate && !startTime) endTime = null;
  const allDay = !!startDate && (!startTime || o.allDay === true);
  if (allDay) { startTime = null; endTime = null; }
  const conf = o.confidence;
  return {
    title: str(o.title, MAX_TITLE),
    startDate, startTime, endDate, endTime, allDay,
    location: str(o.location, MAX_LOCATION),
    summary: str(o.summary, MAX_SUMMARY),
    confidence: conf === 'high' || conf === 'medium' ? conf : 'low',
    dateFound: !!startDate,
  };
}

/** Markup hints (JSON-LD / <time datetime>) fill only what the model left empty. */
export function mergeHint(result: NormalizedClip, hint?: ClipHint): NormalizedClip {
  if (!hint) return result;
  const out = { ...result };
  if (!out.startDate && ymd(hint.from)) {
    out.startDate = ymd(hint.from);
    out.endDate = ymd(hint.to) && (hint.to as string) >= out.startDate! ? (hint.to as string) : out.startDate;
    out.startTime = hhmm(hint.startTime);
    out.endTime = out.startTime ? hhmm(hint.endTime) : null;
    out.allDay = hint.allDay === true || !out.startTime;
    if (out.allDay) { out.startTime = null; out.endTime = null; }
    out.dateFound = true;
  }
  if (!out.location && typeof hint.location === 'string') out.location = str(hint.location, MAX_LOCATION);
  return out;
}

/** The /events/create prefill contract (EventComposePageInner.computeInitialValues) + clipMiss. */
export function toComposeParams(result: NormalizedClip, page: { title: string; url: string; selection?: string }): URLSearchParams {
  const p = new URLSearchParams();
  const title = result.title ?? str(page.title, MAX_TITLE);
  if (title) p.set('title', title);
  const lead = page.selection?.trim() || result.summary || '';
  p.set('body', (lead ? `${lead}\n\n` : '') + `Quelle: ${page.url}`);
  if (result.startDate) {
    p.set('from', result.startDate);
    if (result.endDate && result.endDate !== result.startDate) p.set('to', result.endDate);
    if (result.allDay) p.set('allDay', '1');
    if (result.startTime) p.set('startTime', result.startTime);
    if (result.endTime) p.set('endTime', result.endTime);
  } else {
    p.set('clipMiss', '1');
  }
  if (result.location) p.set('location', result.location);
  return p;
}
