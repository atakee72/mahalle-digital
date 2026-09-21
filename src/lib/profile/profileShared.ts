// src/lib/profile/profileShared.ts
// PURE module — types + constants only. No imports. Safe for both server
// and client bundles (see CLAUDE.md "Server-only modules bleeding into
// client bundles").

export interface ProfileMe {
  id: string;
  name: string;
  handle: string;
  email: string;
  image: string | null;
  hobbies: string[];
  verified: boolean;
  memberSince: number; // year, from users.createdAt (ISO string OR Date — handle both)
  isBanned: boolean;
  stats: { posts: number; listings: number; events: number; danke: number };
  motto: string | null; // Plan B Task 6 — optional Steckbrief line, own-view only (never on PublicProfile)
  pendingEmail: string | null; // Plan B Task 7 — email-change in flight, own-view only (never on PublicProfile)
  deletionScheduledAt: string | null; // Plan B Task 10 — ISO date; account deletion pending a 7-day grace, own-view only (never on PublicProfile)
}

// Public-profile projection ("Nachbarn"-view) — Plan B Task 3. Trimmed
// sibling of ProfileMe: no email, no isBanned. NEVER add
// email/isBanned/pendingEmail/strikes/deletionScheduledAt to this type — getPublicProfile()
// (src/lib/profile/publicProfile.ts) is the only producer and must never
// select those fields off the users doc.
export interface PublicProfile {
  id: string;
  name: string;
  handle: string;
  image: string | null; // userPicture || image || null — the public avatar
  hobbies: string[];
  verified: boolean;
  memberSince: number; // year, from users.createdAt (ISO string OR Date — handle both)
  stats: { posts: number; listings: number; events: number; danke: number };
}

export interface StandingRejectedItem {
  date: string; // ISO (flaggedContent.reviewedAt ?? updatedAt)
  contentType: 'topic' | 'announcement' | 'recommendation' | 'comment' | 'event' | 'marketplace' | 'news';
  title: string;
  reason: string;
}

export interface ProfileStanding {
  strikes: number;
  isBanned: boolean;
  bannedAt: string | null;
  rejected: StandingRejectedItem[]; // newest first, max 20
}

// Maps a flaggedContent contentType (moderation domain) onto the profile's
// cross-surface accent grouping ('forum' | 'markt' | 'kalender' | 'kurier').
// Used by PModerationCard's rejected rows AND the Task 9 activity ledger —
// keep the mapping in this pure module so both consumers agree.
export function contentTypeToSurface(
  ct: StandingRejectedItem['contentType']
): 'forum' | 'markt' | 'kalender' | 'kurier' {
  switch (ct) {
    case 'marketplace':
      return 'markt';
    case 'event':
      return 'kalender';
    case 'news':
      return 'kurier';
    case 'topic':
    case 'announcement':
    case 'recommendation':
    case 'comment':
    default:
      return 'forum';
  }
}

// Shared dd.MM date formatter — used by PModerationCard's rejected rows and
// ProfileInner's banned-banner date. Pure Intl usage; keep this module
// import-free (see file header).
export function formatDdMm(iso: string, locale: 'de' | 'en'): string {
  const parts = new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(new Date(iso));
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  return `${day}.${month}`;
}

// Sibling to formatDdMm, WITH the year — used by the delete-account pending
// banner (Plan B Task 10). formatDdMm's day+month-only format doesn't
// communicate which year, and a 7-day grace window can straddle new year's.
export function formatDdMmYyyy(iso: string, locale: 'de' | 'en'): string {
  const parts = new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date(iso));
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  return `${day}.${month}.${year}`;
}

// One rule for signup and profile edit lives in nameRules.ts (2026-09-21).
export { DISPLAY_NAME_REGEX as PROFILE_NAME_REGEX } from './nameRules';
export const HOBBY_MAX_COUNT = 10;
export const HOBBY_MAX_LEN = 50;
export const MOTTO_MAX_LEN = 80;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

// ─── Cross-surface activity feed ("Archiv") ────────────────────────────

export type ActivityFilter = 'alle' | 'forum' | 'markt' | 'kalender' | 'kurier' | 'gespeichert';
export type ActivitySurface = 'forum' | 'markt' | 'kalender' | 'kurier';
export type ActivityKind =
  | 'diskussion' | 'empfehlung' | 'ankuendigung'   // forum
  | 'anzeige'                                      // markt
  | 'termin' | 'zusage'                            // kalender
  | 'news'                                         // kurier
  | 'artikel';                                     // kurier (saved news by others)
export interface ActivityItem {
  id: string; surface: ActivitySurface; kind: ActivityKind;
  title: string;
  date: string;                    // ISO — sort key (createdAt; zusage -> event startDate; saved -> savedAt)
  strap: 'pruefung' | 'reserviert' | 'abgelehnt' | null;
  saved: boolean;                  // true in the gespeichert view
  by: string | null;               // author display name (gespeichert view) or source name (kurier)
  href: string | null;             // detail link ('/topics/{id}', '/marketplace/{id}', '/calendar', '/newsboard/{id}')
  meta: { likes?: number; comments?: number; price?: number | null;
          listingType?: 'sell' | 'exchange' | 'gift'; eventDate?: string; going?: number };
}
export interface ActivityPage { items: ActivityItem[]; nextBefore: string | null; }
export const ACTIVITY_PAGE_SIZE = 20;

// ─── Kiez-Chronik (Plan B, Task 1) ─────────────────────────────────────
// Derived tenure timeline. Labels/sublabels are i18n keys on the client
// (`profile.chronik.stop.<kind>` / `.sub.<kind>`), NOT resolver output.

export type ChronikStopKind = 'dabei' | 'erstesThema' | 'ersteAnzeige' | 'ersterTermin' | 'danke100' | 'heute';
export interface ChronikStop { kind: ChronikStopKind; date: string | null; /* ISO; null only for 'heute' */ active?: boolean; }
export interface ChronikData { stops: ChronikStop[]; } // ordered, max 5, 'heute' always last
