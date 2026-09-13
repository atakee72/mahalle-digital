// src/lib/linkify.ts — dependency-pure (imported by client islands).
// Splits plain text into text/link segments so Svelte can render URLs as
// real <a> elements WITHOUT @html (Svelte escapes each segment — XSS-safe).
// Only http(s) URLs are recognized, so javascript:/data: URIs can never
// become hrefs.

export interface LinkifySegment {
  type: 'text' | 'link';
  value: string;
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;

// Trailing punctuation that is far more likely to be sentence punctuation
// than part of the URL („… siehe https://example.com/pfad.")
const TRAILING_PUNCT = /[.,!?;:)\]]+$/;

export function linkifySegments(text: string): LinkifySegment[] {
  const segments: LinkifySegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    let url = match[0].replace(TRAILING_PUNCT, '');
    // Restore closing parens the punctuation strip took from a balanced
    // pair (wikipedia_(band)) — also when sentence punctuation follows,
    // e.g. „…_(Bezirk)." — but never a sentence-level ")" with no "(".
    let stripped = match[0].slice(url.length);
    while (
      stripped.startsWith(')') &&
      (url.match(/\(/g) ?? []).length > (url.match(/\)/g) ?? []).length
    ) {
      url += ')';
      stripped = stripped.slice(1);
    }
    const start = match.index ?? 0;
    if (start > last) segments.push({ type: 'text', value: text.slice(last, start) });
    segments.push({ type: 'link', value: url });
    last = start + url.length;
  }
  if (last < text.length) segments.push({ type: 'text', value: text.slice(last) });
  return segments;
}

// ─── Display shortening ──────────────────────────────────────────────
// A pasted URL stays the href in full; only the visible label is
// trimmed so a 120-char tracking link doesn't wrap across three lines.
// Rules: drop scheme + "www.", drop a trailing "/", then cut to `max`
// chars at the last "/" before the limit (falls back to a hard cut) and
// append "…". The full URL belongs in the anchor's title attribute.

export const DISPLAY_URL_MAX = 40;

export function displayUrl(url: string, max = DISPLAY_URL_MAX): string {
  let s = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  if (s.endsWith('/')) s = s.slice(0, -1);
  if (s.length <= max) return s;
  // Prefer a path-segment boundary, but never collapse to the bare host
  // (maps.app.goo.gl/abc?… must keep its one path segment).
  const cut = s.lastIndexOf('/', max);
  const hostEnd = s.indexOf('/');
  const head = cut > hostEnd ? s.slice(0, cut) : s.slice(0, max);
  return `${head}…`;
}

// Plain-text variant for card excerpts and search snippets, where the
// body is rendered as text (no anchors): every URL becomes its label.
export function shortenUrlsInText(text: string, max = DISPLAY_URL_MAX): string {
  return linkifySegments(text)
    .map((seg) => (seg.type === 'link' ? displayUrl(seg.value, max) : seg.value))
    .join('');
}
