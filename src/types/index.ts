import { ObjectId } from 'mongodb';
import type { MentionRef } from '../lib/mentions/mentions';
import type { BroadcastRef } from '../lib/mentions/broadcast';

// User Types
export interface User {
  _id?: ObjectId | string;
  name: string;
  email: string;
  password?: string; // Excluded from client-side
  firstName?: string;
  surName?: string;
  userName?: string;
  userPicture?: string;
  hobbies?: string[];
  roleBadge?: string;
  // Authorisation role. `'admin'` unlocks the admin dashboard +
  // official-announcement composer + bypasses AI moderation on
  // /api/admin/announcements/create. Defaults to undefined / 'user'.
  role?: 'user' | 'admin';
  topics?: string[];
  comments?: string[];
  likes?: string[];
  // Moderation strike system
  moderationStrikes?: number; // Current strike count (max 3 before ban)
  strikeHistory?: {
    date: Date;
    reason: string;
    contentType: string;
    contentId: string;
    reviewedBy: string;
  }[];
  isBanned?: boolean;
  bannedAt?: Date;
  bannedReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Edit History Type
export interface EditHistory {
  originalTitle: string;
  originalBody: string;
  editedAt: Date;
  editedBy: string; // NextAuth user ID
}

// Topic Types
export interface Topic {
  /** „@handle" mentions resolved at save time — see src/lib/mentions. */
  mentions?: MentionRef[];
  /** „@alle" Admin-Hinweis (admin only): the token is stripped from `body` and kept here — see src/lib/mentions/broadcast.ts. */
  broadcast?: BroadcastRef;
  _id?: ObjectId | string;
  title: string;
  body: string;
  author: ObjectId | string | User;
  comments: (ObjectId | string)[];
  views: number;
  likes: number;
  likedBy: (ObjectId | string)[];
  tags: string[];
  images?: { url: string; publicId: string }[];
  date: number;
  wasLiked?: number;
  editHistory?: EditHistory[]; // Track all edits
  isEdited?: boolean; // Quick flag to check if post was edited
  lastEditedAt?: Date; // When was it last edited
  // Moderation fields
  moderationStatus?: 'approved' | 'pending' | 'rejected';
  isUserReported?: boolean; // True if reported by community (vs AI flagged)
  rejectionReason?: string; // Why the post was rejected (shown to author)
  hasWarningLabel?: boolean;
  warningText?: string;
  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

// Comment Types
export interface Comment {
  /** „@handle" mentions resolved at save time — see src/lib/mentions. */
  mentions?: MentionRef[];
  /** „@alle" Admin-Hinweis (admin only): the token is stripped from `body` and kept here — see src/lib/mentions/broadcast.ts. */
  broadcast?: BroadcastRef;
  _id?: ObjectId | string;
  body: string;
  author: ObjectId | string | User;
  relevantPostId: ObjectId | string;
  date: number;
  upvotes: number;
  user?: User[]; // Denormalized user data
  userName?: string[];
  // Moderation fields
  moderationStatus?: 'approved' | 'pending' | 'rejected';
  isUserReported?: boolean; // True if reported by community
  hasWarningLabel?: boolean; // Approved with content warning
  warningText?: string; // Warning message to display
  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
  editedAt?: Date;
}

// Announcement Types
export interface Announcement {
  /** „@handle" mentions resolved at save time — see src/lib/mentions. */
  mentions?: MentionRef[];
  /** „@alle" Admin-Hinweis (admin only): the token is stripped from `body` and kept here — see src/lib/mentions/broadcast.ts. */
  broadcast?: BroadcastRef;
  _id?: ObjectId | string;
  title: string;
  content: string;
  body?: string;
  description?: string;
  author: ObjectId | string | User;
  comments: (ObjectId | string)[];
  views: number;
  likes: number;
  likedBy: (ObjectId | string)[];
  tags: string[];
  images?: { url: string; publicId: string }[];
  date: number;
  editHistory?: EditHistory[];
  isEdited?: boolean;
  lastEditedAt?: Date;
  // Moderation fields
  moderationStatus?: 'approved' | 'pending' | 'rejected';
  hasWarningLabel?: boolean;
  warningText?: string;
  // Official-announcement fields. Set only by the admin endpoints at
  // /api/admin/announcements/*; never settable from the community
  // /api/announcements/create endpoint (Zod strips unknown keys).
  isOfficial?: boolean;
  pinnedUntil?: Date | null;
  editCount?: number; // incremented by admin PATCH when title/body change
  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

// Recommendation Types
export interface Recommendation {
  /** „@handle" mentions resolved at save time — see src/lib/mentions. */
  mentions?: MentionRef[];
  /** „@alle" Admin-Hinweis (admin only): the token is stripped from `body` and kept here — see src/lib/mentions/broadcast.ts. */
  broadcast?: BroadcastRef;
  _id?: ObjectId | string;
  title: string;
  content: string;
  body?: string;
  description?: string;
  author: ObjectId | string | User;
  category?: string;
  comments: (ObjectId | string)[];
  views: number;
  likes: number;
  likedBy: (ObjectId | string)[];
  tags: string[];
  images?: { url: string; publicId: string }[];
  date: number;
  editHistory?: EditHistory[];
  isEdited?: boolean;
  lastEditedAt?: Date;
  // Moderation fields
  moderationStatus?: 'approved' | 'pending' | 'rejected';
  hasWarningLabel?: boolean;
  warningText?: string;
  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

// Event Types (Calendar) — kiosk redesign:
//   - 6 categories (kiez/oeffentlich/markt/kultur/sport/sonstiges)
//   - capacity?: cap on going-RSVPs — ENFORCED (2026-09-06): the RSVP API rejects an
//     over-cap 'going' with 409 event_full (atomic), and RsvpButtons disables "ich komme"
//     + shows "ausgebucht" when full. Absent/null capacity = unlimited.
//   - allDay?: explicit flag; otherwise time component of startDate/endDate is shown
//   - rsvps?: embedded arrays of user IDs. v1 single-neighbourhood scale.
export type EventCategory =
  | 'kiez'
  | 'oeffentlich'
  | 'markt'
  | 'kultur'
  | 'sport'
  | 'sonstiges';

export interface Event {
  _id?: ObjectId | string;
  title: string;
  body: string; // description
  author: ObjectId | string | User;
  startDate: Date;
  endDate: Date;
  location?: string;
  category?: EventCategory;
  capacity?: number;
  allDay?: boolean;
  visibility?: 'public' | 'private';
  isOfficial?: boolean;
  tags: string[];
  comments: (ObjectId | string)[];
  views: number;
  likes: number;
  likedBy: (ObjectId | string)[];
  rsvps?: {
    going: (ObjectId | string)[];
    maybe: (ObjectId | string)[];
  };
  date: number; // creation timestamp
  editHistory?: EditHistory[];
  isEdited?: boolean;
  lastEditedAt?: Date;
  // Moderation fields
  moderationStatus?: 'approved' | 'pending' | 'rejected';
  isUserReported?: boolean;
  rejectionReason?: string;
  hasWarningLabel?: boolean;
  warningText?: string;
  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

// News Types (Newsboard)
export interface NewsItem {
  _id?: ObjectId | string;
  source: 'ai_fetched' | 'user_submitted';
  title: string;
  description: string;
  imageUrl?: string;
  sourceUrl: string;
  sourceName: string;
  // AI metadata (for ai_fetched items)
  aiRelevanceScore?: number;
  fetchDate?: string; // YYYY-MM-DD, for day-grouped sorting by relevance
  aiCategory?: string;
  aiReason?: string;
  // User submission
  submittedBy?: ObjectId | string | User;
  submitterComment?: string;
  // Moderation fields
  moderationStatus: 'approved' | 'pending' | 'rejected';
  isUserReported?: boolean;
  hasWarningLabel?: boolean;
  warningText?: string;
  // Engagement
  viewCount: number;
  // Timestamps
  publishedAt: Date;
  fetchedAt: Date;
  approvedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

// Saved Items (cross-feature bookmarks)
export interface SavedItem {
  _id?: ObjectId | string;
  userId: string;
  itemId: string;
  itemType: 'news' | 'listing' | 'topic' | 'event';
  savedAt: Date;
}

// Auth Types
export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// JWT Payload Type
export interface JWTPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

// ============================================================================
// MODERATION TYPES
// ============================================================================

export type ModerationDecision = 'approved' | 'pending_review' | 'urgent_review';
export type ModerationReviewStatus = 'pending' | 'approved' | 'rejected';
export type ModeratedContentType = 'topic' | 'announcement' | 'recommendation' | 'comment' | 'event' | 'marketplace' | 'news';
export type FlaggedContentSource = 'ai_moderation' | 'user_report';
export type ReportReason = 'spam' | 'harassment' | 'hate_speech' | 'violence' | 'inappropriate' | 'misinformation' | 'other';

export interface FlaggedContent {
  _id?: ObjectId | string;

  // Source: AI moderation vs user report
  source: FlaggedContentSource;

  // Reference to original content
  contentType: ModeratedContentType;
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

  // AI Moderation details (only for source: 'ai_moderation')
  decision: ModerationDecision;
  flaggedCategories: string[];
  scores: Record<string, number>;
  highestCategory: string;
  maxScore: number;

  // User Report details (only for source: 'user_report')
  reporterUserId?: string;
  reporterUserIds?: string[];  // All users who reported (for duplicate check)
  reporterName?: string;
  reportReason?: ReportReason;
  reportDetails?: string;
  reportCount?: number; // Track multiple reports on same content

  // Review status
  reviewStatus: ModerationReviewStatus;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
  rejectionReason?: string;

  // Set when the author self-deletes the content while a report/flag is open.
  // The record STAYS in the queue (reviewStatus unchanged) and stays strikeable
  // from the stored snapshot; the admin card renders a "deleted" badge.
  contentDeleted?: boolean;
  contentDeletedAt?: Date;

  // If approved, should it have a warning label?
  hasWarningLabel?: boolean;
  warningText?: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// LISTING AUDIT TRAIL — provable record of moderation state at edit time
// ============================================================================

export type ListingAuditEvent = 'edit_warning_cleared' | 'edit_rejection_cleared';

export interface ListingAuditTrail {
  _id?: ObjectId | string;
  /** Listing this snapshot refers to (string form, matches listings._id.toString()). */
  listingId: string;
  /** Discriminator. `edit_warning_cleared` = author edited a listing that had a
   *  warning label; `edit_rejection_cleared` = author edited a rejected listing. */
  event: ListingAuditEvent;
  editedAt: Date;
  /** userId of the editing user. Always === listing.sellerId given canMutate ownership
   *  gate; field is here for self-contained audit reads without joining users. */
  editedBy: string;

  // ─── Pre-edit content snapshot ────────────────────────────────────────────
  preEditTitle?: string;
  preEditBody?: string; // descriptionPlainText at the moment of edit
  preEditImages?: string[];

  // ─── Pre-edit warning state (set when event === 'edit_warning_cleared') ───
  /** Always true for `edit_warning_cleared`; always false for rejection events
   *  unless a listing somehow carried BOTH warning AND rejected (defensive). */
  hadWarningLabel: boolean;
  preEditWarningText?: string;

  // ─── Pre-edit rejection state (set when event === 'edit_rejection_cleared') ─
  /** Currently only `'rejected'` (the only moderation state that can trigger a
   *  rejection-cleared event). Field exists for self-contained reads — clearer
   *  than inferring from the event discriminator alone. */
  preEditModerationStatus?: 'rejected';
  preEditRejectionReason?: string;

  createdAt: Date;
}