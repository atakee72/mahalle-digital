/**
 * Admin moderation taxonomy + shared types — kiosk redesign (queue scope).
 *
 * PURE MODULE — no `mongodb` / server imports. This file is imported by
 * Svelte islands (`src/components/admin/kiosk/*`) which hydrate in the
 * browser, so it must stay dependency-free. See root CLAUDE.md
 * "Server-only modules bleeding into client bundles" for why this matters:
 * a single accidental `import { connectDB } from '...mongodb...'` here
 * would pull Node built-ins into the client bundle and silently break
 * hydration for every consumer.
 *
 * `FlaggedItem` mirrors `FlaggedContent` (src/types/index.ts) but with
 * string dates (API responses are JSON) and a plain string `_id` (no
 * `ObjectId` — that type only exists server-side), plus the Task-2
 * additions `authorStrikes` + `authorIsBanned` carried on the API item
 * for card-level ban context.
 *
 * Category taxonomy, report reasons, and content types transcribed from
 * design/handoffs/design_handoff_admin/jsx/kiosk-admin.jsx:16-54.
 * `AdmReportReason` lists the real `ReportReason` schema's 7 values (the JSX
 * had 5; `hate_speech` + `violence` were added).
 */

// ─────────────────────────────────────────────────────────────────────────
// Severity + category taxonomy
// ─────────────────────────────────────────────────────────────────────────

export type AdmSeverity = 'critical' | 'high' | 'mid' | 'info';

export const ADM_CATS: Record<string, { sev: AdmSeverity }> = {
  hate: { sev: 'critical' },
  'hate/threatening': { sev: 'critical' },
  violence: { sev: 'critical' },
  harassment: { sev: 'high' },
  'harassment/threatening': { sev: 'critical' },
  turkish_profanity: { sev: 'high' },
  'spam_check:spam': { sev: 'mid' },
  'spam_check:ad_promotional': { sev: 'mid' },
  'spam_check:scam': { sev: 'high' },
  'image_safety:other_violation': { sev: 'mid' },
  relevance: { sev: 'info' },
};

export const ADM_SEV_COLOR: Record<AdmSeverity, string> = {
  critical: 'var(--k-danger)',
  high: 'var(--adm-sev-high)',
  mid: 'var(--k-warn)',
  info: 'var(--k-info)',
};

// ─────────────────────────────────────────────────────────────────────────
// Content types + report reasons
// ─────────────────────────────────────────────────────────────────────────

export const ADM_TYPES = [
  'topic',
  'comment',
  'announcement',
  'recommendation',
  'event',
  'news',
  'marketplace',
] as const;

// ─────────────────────────────────────────────────────────────────────────
// FlaggedItem — client-shape mirror of FlaggedContent
// ─────────────────────────────────────────────────────────────────────────

export type AdmModerationDecision = 'approved' | 'pending_review' | 'urgent_review';
export type AdmReviewStatus = 'pending' | 'approved' | 'rejected';
export type AdmContentType =
  | 'topic'
  | 'announcement'
  | 'recommendation'
  | 'comment'
  | 'event'
  | 'marketplace'
  | 'news';
export type AdmSource = 'ai_moderation' | 'user_report';
export type AdmReportReason =
  | 'spam'
  | 'harassment'
  | 'hate_speech'
  | 'violence'
  | 'inappropriate'
  | 'misinformation'
  | 'other';

export interface FlaggedItem {
  _id?: string;

  // Source: AI moderation vs user report
  source: AdmSource;

  // Reference to original content
  contentType: AdmContentType;
  contentId?: string;

  // The content itself (stored for review)
  title?: string;
  body?: string;
  tags?: string[];
  imageUrls?: string[];
  sourceUrl?: string; // For news items: link to original article

  // Author info (content author)
  authorId: string;
  authorName?: string;
  authorEmail?: string;
  // Task-2 additions — author strike/ban context surfaced on the card.
  authorStrikes: number;
  authorIsBanned: boolean;

  // AI Moderation details (only for source: 'ai_moderation')
  decision: AdmModerationDecision;
  flaggedCategories: string[];
  scores: Record<string, number>;
  highestCategory: string;
  maxScore: number;

  // User Report details (only for source: 'user_report')
  reporterUserId?: string;
  reporterUserIds?: string[];
  reporterName?: string;
  reportReason?: AdmReportReason;
  reportDetails?: string;
  reportCount?: number;

  // Set when the author self-deleted the content while this flag was open —
  // the record stays in the queue, reviewed/struck from the stored snapshot.
  contentDeleted?: boolean;

  // Review status
  reviewStatus: AdmReviewStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  rejectionReason?: string;

  // If approved, should it have a warning label?
  hasWarningLabel?: boolean;
  warningText?: string;

  // Timestamps (string — JSON-serialized API response)
  createdAt: string;
  updatedAt: string;
}

export function isUrgent(item: FlaggedItem): boolean {
  return item.decision === 'urgent_review';
}

// ─────────────────────────────────────────────────────────────────────────
// History (Protokoll) table — column set (Task 8)
// ─────────────────────────────────────────────────────────────────────────

/** Fixed column order for the Protokoll table + the column-visibility menu.
 * Single source of truth so `AdmHistoryTable` (rendering) and
 * `AdmColumnMenu` (the "last visible column" guard) can't drift apart. */
export const ADM_HISTORY_COLS = [
  'date',
  'source',
  'type',
  'content',
  'author',
  'flagged',
  'decision',
  'reason',
] as const;
export type AdmHistoryColId = (typeof ADM_HISTORY_COLS)[number];

// ─────────────────────────────────────────────────────────────────────────
// Bulk-reject "Folgen-Vorschau" (NOVEL §02) — pure per-author strike math
// ─────────────────────────────────────────────────────────────────────────

export interface BulkDeltaRow {
  id: string;
  title: string | null;
  contentType: string;
  author: string;
  from: number;
  to: number;
  ban: boolean;
  note: string | null;
}

/**
 * Sequential per-author strike summation, mirroring exactly how
 * `processReviewAction` (src/lib/reviewAction.ts) processes a bulk-reject
 * request: the API walks `flaggedContentIds` in the order the client sent
 * them, incrementing each author's `moderationStrikes` one item at a time
 * (never re-reading `authorStrikes` mid-batch). So must this preview —
 * `items` MUST be in the same order as the eventual POST body, or the
 * preview will lie about which item bans which account.
 *
 * `from` is seeded from `item.authorStrikes` (the value at fetch time) on
 * an author's first item in the selection, then carried forward from the
 * running total for any subsequent items by the same author within this
 * same selection — this is what makes two 1-strike hits by the same author
 * add up to a 3rd-strike ban, even though neither item's OWN
 * `authorStrikes` field says so.
 *
 * `ban` is true only on the first item that pushes an author's running
 * count to >= 3 (MAX_STRIKES) — later items by an already-banned author in
 * the same batch don't re-flag (mirrors the UI's "one ban event per
 * author" framing; the server itself keeps incrementing past 3 but only
 * sets `isBanned` once).
 */
export function computeBulkDeltas(items: FlaggedItem[]): BulkDeltaRow[] {
  const running = new Map<string, number>(); // authorId -> current running strike count
  const hits = new Map<string, number>(); // authorId -> nth hit within this selection
  const banned = new Set<string>(); // authorId already produced a ban row in this selection

  const rows: BulkDeltaRow[] = [];

  for (const item of items) {
    if (!item._id) continue;
    const { authorId } = item;

    const from = running.has(authorId) ? running.get(authorId)! : item.authorStrikes;
    const to = Math.min(from + 1, 3);

    const hitN = (hits.get(authorId) ?? 0) + 1;
    hits.set(authorId, hitN);

    const crossesThreshold = from + 1 >= 3;
    const ban = crossesThreshold && !banned.has(authorId);
    if (ban) banned.add(authorId);

    rows.push({
      id: item._id,
      title: item.title || (item.body ? `„${item.body.slice(0, 76)}…“` : null),
      contentType: item.contentType,
      author: item.authorName ?? item.authorId,
      from,
      to,
      ban,
      note: hitN >= 2 ? `${hitN}. Treffer in dieser Auswahl` : null,
    });

    running.set(authorId, to);
  }

  return rows;
}
