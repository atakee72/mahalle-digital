/**
 * „Auf der Karte zeigen" link for an event's free-text Ort. Pure.
 *
 * The Ort is whatever the author typed („Schillermarkt am Herrfurthplatz!"),
 * so the target must be a FORGIVING place search. OpenStreetMap's site search
 * is literal — that Ort and every variant naming the market returned nothing
 * (found 2026-09-18, the day before the debut stand) — hence Google Maps'
 * universal search link: no key, nothing loaded until the click, and phones
 * hand it to their maps app.
 */
export function mapSearchUrl(location: string): string {
  // Shout/sentence punctuation at the end only hurts the search.
  const place = location.trim().replace(/[\s!?.,;:]+$/u, '');
  const query = /\bberlin\b/i.test(place) ? place : `${place}, Berlin`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
