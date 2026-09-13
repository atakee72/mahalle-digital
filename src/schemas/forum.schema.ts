import { z } from 'zod';

// MongoDB ObjectId validation
export const ObjectIdSchema = z.string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ObjectId');

// Reusable image schema for forum posts
const PostImageSchema = z.array(z.object({
  url: z.string().url(),
  publicId: z.string()
})).max(5, 'Maximum 5 images allowed').default([]);

// Base Forum Post Schema (shared fields)
const BasePostSchema = z.object({
  title: z.string()
    .min(5, 'Title must be at least 5 characters')
    .max(200, 'Title must be less than 200 characters')
    .trim(),
  body: z.string()
    .min(10, 'Content must be at least 10 characters')
    .max(5000, 'Content must be less than 5000 characters')
    .trim(),
  tags: z.array(z.string().max(30))
    .max(5, 'Maximum 5 tags allowed')
    .default([]),
  images: PostImageSchema
});

// Topic Schema
export const TopicCreateSchema = BasePostSchema.extend({
  type: z.literal('topic').optional()
});

export const TopicUpdateSchema = BasePostSchema.partial().refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

// Announcement Schema
export const AnnouncementCreateSchema = z.object({
  title: z.string()
    .min(5, 'Title must be at least 5 characters')
    .max(200, 'Title must be less than 200 characters')
    .trim(),
  body: z.string()
    .min(10, 'Content must be at least 10 characters')
    .max(5000, 'Content must be less than 5000 characters')
    .trim(),
  tags: z.array(z.string().max(30))
    .max(5, 'Maximum 5 tags allowed')
    .default([]),
  images: PostImageSchema,
  type: z.literal('announcement').optional()
});

export const AnnouncementUpdateSchema = AnnouncementCreateSchema.partial().refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

// Admin-only PATCH schema — extends the community update with an
// optional `pinnedUntil` field. Accepts ISO datetime string (re-pin /
// extend) or null (unpin). When a string is supplied it must parse to a
// future date; past or invalid dates are rejected. The community
// `/api/announcements/edit/[id]` endpoint uses AnnouncementUpdateSchema
// (above) which excludes pinnedUntil — only admin endpoints may touch
// the pinned-until clock.
export const AdminAnnouncementUpdateSchema = AnnouncementCreateSchema.partial()
  .extend({
    pinnedUntil: z
      .union([
        z
          .string()
          .datetime()
          .refine((v) => new Date(v).getTime() > Date.now(), {
            message: 'pinnedUntil must be a future date'
          }),
        z.null()
      ])
      .optional()
  })
  .refine(data => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update'
  });

// Recommendation Schema
export const RecommendationCreateSchema = z.object({
  title: z.string()
    .min(5, 'Title must be at least 5 characters')
    .max(200, 'Title must be less than 200 characters')
    .trim(),
  body: z.string()
    .min(10, 'Content must be at least 10 characters')
    .max(5000, 'Content must be less than 5000 characters')
    .trim(),
  category: z.enum([
    'restaurant',
    'shop',
    'service',
    'event',
    'place',
    'activity',
    'other'
  ]).optional().default('other'),
  tags: z.array(z.string().max(30))
    .max(5, 'Maximum 5 tags allowed')
    .default([]),
  images: PostImageSchema,
  type: z.literal('recommendation').optional()
});

export const RecommendationUpdateSchema = RecommendationCreateSchema.partial().refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

// Kind change (= cross-collection move, POST /api/posts/move/[id]).
const PostCollectionSchema = z.enum(['topics', 'announcements', 'recommendations']);
export const PostMoveSchema = z.object({
  from: PostCollectionSchema,
  to: PostCollectionSchema
});

// Event Schema (Calendar) — kiosk redesign uses 6 categories
// (kiez/oeffentlich/markt/kultur/sport/sonstiges). Capacity + allDay
// are optional in v1; recurring/visibility/isOfficial deferred to v1.1+.
const EventBaseSchema = z.object({
  title: z.string()
    .min(5, 'Title must be at least 5 characters')
    .max(200, 'Title must be less than 200 characters')
    .trim(),
  body: z.string()
    .min(10, 'Description must be at least 10 characters')
    .max(5000, 'Description must be less than 5000 characters')
    .trim(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  location: z.string().max(200).optional(),
  category: z.enum([
    'kiez',
    'oeffentlich',
    'markt',
    'kultur',
    'sport',
    'sonstiges'
  ]).optional().default('kiez'),
  capacity: z.number().int().min(1).max(10000).nullish(),
  allDay: z.boolean().optional().default(false),
  visibility: z.enum(['public', 'private']).optional().default('public'),
  // `isOfficial` is server-controlled (admin-create only); user POSTs are
  // ignored even if present. Same pattern as announcements.
  isOfficial: z.boolean().optional(),
  tags: z.array(z.string().max(30))
    .max(5, 'Maximum 5 tags allowed')
    .default([]),
  type: z.literal('event').optional()
});

export const EventCreateSchema = EventBaseSchema.refine(
  data => data.endDate >= data.startDate,
  { message: 'End date must be after or equal to start date', path: ['endDate'] }
);

export const EventUpdateSchema = EventBaseSchema.partial().refine(
  data => {
    // Check if at least one field is provided
    if (Object.keys(data).length === 0) return false;
    // If both dates are provided, validate that endDate >= startDate
    if (data.startDate && data.endDate) {
      return data.endDate >= data.startDate;
    }
    return true;
  },
  { message: 'At least one field must be provided for update' }
);

// Like/Unlike Schema
export const LikeActionSchema = z.object({
  postId: ObjectIdSchema,
  action: z.enum(['like', 'unlike'])
});

// View Count Schema
export const ViewCountSchema = z.object({
  postId: ObjectIdSchema
});

// Search/Filter Schema
export const SearchFilterSchema = z.object({
  query: z.string().optional(),
  tags: z.array(z.string()).optional(),
  author: ObjectIdSchema.optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  sortBy: z.enum(['date', 'likes', 'views', 'comments']).default('date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0)
});

// Type exports
export type TopicCreate = z.infer<typeof TopicCreateSchema>;
export type TopicUpdate = z.infer<typeof TopicUpdateSchema>;
export type AnnouncementCreate = z.infer<typeof AnnouncementCreateSchema>;
export type AnnouncementUpdate = z.infer<typeof AnnouncementUpdateSchema>;
export type AdminAnnouncementUpdate = z.infer<typeof AdminAnnouncementUpdateSchema>;
export type RecommendationCreate = z.infer<typeof RecommendationCreateSchema>;
export type RecommendationUpdate = z.infer<typeof RecommendationUpdateSchema>;
export type EventCreate = z.infer<typeof EventCreateSchema>;
export type EventUpdate = z.infer<typeof EventUpdateSchema>;
export type LikeAction = z.infer<typeof LikeActionSchema>;
export type ViewCount = z.infer<typeof ViewCountSchema>;
export type SearchFilter = z.infer<typeof SearchFilterSchema>;