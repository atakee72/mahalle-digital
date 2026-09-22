// src/lib/newsboard/newsFormat.ts
// PURE — relative-time + fetchDate formatting + masthead issue number.
// No server-only imports.

import type { Locale } from '../kiosk-i18n';

// Notional launch date for the issue counter. Seed cross-check:
// 24 May 2026 = Nr. 142 → issue = (days since 2026-01-03) + 1.
const LAUNCH = Date.UTC(2026, 0, 3); // 2026-01-03
const DAY_MS = 86_400_000;

// Compute the daily issue number. Pass `now` from server-side (Astro
// frontmatter) — never derive in the client per render (handoff rule).
export function computeIssueNumber(now: Date): number {
  const days = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - LAUNCH) / DAY_MS);
  return days + 1;
}

// "vor 2 Std." / "2h ago" style relative time from a Date or ISO string.
export function formatRelativeTime(input: Date | string | undefined, locale: Locale, now: Date = new Date()): string {
  if (!input) return '';
  const d = typeof input === 'string' ? new Date(input) : input;
  const diffMs = now.getTime() - d.getTime();
  const min = Math.round(diffMs / 60000);
  const isDE = locale === 'de';
  if (min < 1) return isDE ? 'gerade eben' : 'just now';
  if (min < 60) return isDE ? `vor ${min} Min.` : `${min} min ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return isDE ? `vor ${hrs} Std.` : `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return isDE ? 'gestern' : 'yesterday';
  if (days < 7) return isDE ? `vor ${days} Tagen` : `${days} days ago`;
  return d.toLocaleDateString(isDE ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'short' });
}

// Long fetch/approval date for detail + meta: "24. Mai 2026".
export function formatFetchDate(input: Date | string | undefined, locale: Locale): string {
  if (!input) return '';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (isNaN(d.getTime())) return typeof input === 'string' ? input : '';
  return d.toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

// Chrono bucket key for the date dividers (today / yesterday / older).
export function chronoBucket(input: Date | string | undefined, now: Date = new Date()): 'today' | 'yesterday' | 'older' {
  if (!input) return 'older';
  const d = typeof input === 'string' ? new Date(input) : input;
  const startOf = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const diffDays = Math.floor((startOf(now) - startOf(d)) / DAY_MS);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  return 'older';
}

// Lead card = the newest of TODAY (input order is the server's publish-time
// order), yesterday's as a fallback before the 6 AM cron, else none. Until
// 2026-09-22 the lead was simply approvedItems[0], i.e. the day's highest GPT
// score — a 4-day-old item sat above a 4-hour-old one.
export function pickLead<T extends { publishedAt: string | Date }>(items: readonly T[], now: Date = new Date()): T | undefined {
  return items.find((it) => chronoBucket(it.publishedAt, now) === 'today')
    ?? items.find((it) => chronoBucket(it.publishedAt, now) === 'yesterday');
}
