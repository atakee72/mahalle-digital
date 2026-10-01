import { z } from 'zod';

// ============================================================================
// MODERATION SCHEMAS
// ============================================================================

// MongoDB ObjectId validation
const ObjectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ObjectId');

// Moderation decision enum
export const ModerationDecisionSchema = z.enum(['approved', 'pending_review', 'urgent_review']);

// Review status enum
// 'reviewed' is a special filter value meaning "approved OR rejected" (not pending)
export const ModerationReviewStatusSchema = z.enum(['pending', 'approved', 'rejected', 'reviewed']);

// Content type enum
export const ModeratedContentTypeSchema = z.enum([
  'topic',
  'announcement',
  'recommendation',
  'comment',
  'event',
  'marketplace',
  'news'
]);

// Source of flagged content (AI moderation vs user report)
export const FlaggedContentSourceSchema = z.enum(['ai_moderation', 'user_report']);

// User report reasons
export const ReportReasonSchema = z.enum([
  'spam',
  'harassment',
  'hate_speech',
  'violence',
  'inappropriate',
  'misinformation',
  'other'
]);

// Display labels for report reasons (used in UI)
export const REPORT_REASON_LABELS: Record<string, string> = {
  spam: 'Spam or advertising',
  harassment: 'Harassment or bullying',
  hate_speech: 'Hate speech',
  violence: 'Violence or threats',
  inappropriate: 'Inappropriate content',
  misinformation: 'Misinformation',
  other: 'Other'
};

// Flagged content schema (for database)
export const FlaggedContentSchema = z.object({
  // Source: AI moderation vs user report
  source: FlaggedContentSourceSchema,

  // Reference to original content
  contentType: ModeratedContentTypeSchema,
  contentId: z.string().optional(),

  // The content itself
  title: z.string().max(200).optional(),
  body: z.string().max(10000).optional(),
  tags: z.array(z.string()).optional(),
  imageUrls: z.array(z.string().url()).max(10).optional(),

  // Author info (content author)
  authorId: z.string().min(1, 'Author ID is required'),
  authorName: z.string().optional(),
  authorEmail: z.string().email().optional(),

  // AI Moderation details (only for source: 'ai_moderation')
  decision: ModerationDecisionSchema,
  flaggedCategories: z.array(z.string()),
  scores: z.record(z.string(), z.number().min(0).max(1)),
  highestCategory: z.string(),
  maxScore: z.number().min(0).max(1),

  // User Report details (only for source: 'user_report')
  reporterUserId: z.string().optional(),
  reporterName: z.string().optional(),
  reportReason: ReportReasonSchema.optional(),
  reportDetails: z.string().max(500).optional(),
  reportCount: z.number().int().min(1).optional(),

  // Review status
  reviewStatus: ModerationReviewStatusSchema.default('pending'),
  reviewedBy: z.string().optional(),
  reviewedAt: z.coerce.date().optional(),
  reviewNotes: z.string().max(1000).optional(),

  // Warning label
  hasWarningLabel: z.boolean().default(false),
  warningText: z.string().max(200).optional(),
});

// Schema for admin review action
export const ReviewActionSchema = z.object({
  flaggedContentId: ObjectIdSchema,
  action: z.enum(['approve', 'reject', 'approve_with_warning']),
  notes: z.string().max(1000).optional(), // Internal notes (not shown to user)
  rejectionReason: z.string().max(500).optional(), // Shown to user when rejected
  warningText: z.string().max(200).optional(),
});

// Schema for bulk review actions
export const BulkReviewActionSchema = z.object({
  flaggedContentIds: z.array(ObjectIdSchema).min(1).max(50),
  action: z.enum(['approve', 'reject']),
  notes: z.string().max(1000).optional(),
  rejectionReason: z.string().max(500).optional(),
});

// Query schema for fetching flagged content
export const FlaggedContentQuerySchema = z.object({
  reviewStatus: ModerationReviewStatusSchema.optional(),
  contentType: ModeratedContentTypeSchema.optional(),
  decision: ModerationDecisionSchema.optional(),
  source: FlaggedContentSourceSchema.optional(),
  authorId: z.string().optional(),
  sortBy: z.enum(['createdAt', 'maxScore', 'reviewStatus']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  // NOT z.coerce.boolean() — that coerces the string "false" to true.
  urgentFirst: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

// ============================================================================
// USER REPORT SCHEMAS
// ============================================================================

// Schema for user report submission (API request)
export const ReportContentSchema = z.object({
  contentId: ObjectIdSchema,
  contentType: z.enum(['topic', 'comment', 'announcement', 'recommendation', 'event', 'news', 'marketplace']),
  reason: ReportReasonSchema,
  details: z.string().min(10, 'Please provide at least 10 characters explaining the issue').max(500)
});

// Type exports
export type ReportReason = z.infer<typeof ReportReasonSchema>;
