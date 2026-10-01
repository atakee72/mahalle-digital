import { z } from 'zod';

// Schema for user-submitted news
export const NewsSubmitSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(200),
  description: z.string().min(10, 'Description must be at least 10 characters').max(1000),
  sourceUrl: z.string().url('Please provide a valid URL'),
  sourceName: z.string().min(1, 'Source name is required').max(100),
  imageUrl: z.string().url().optional().or(z.literal('')),
  submitterComment: z.string().max(500).optional(),
  sektion: z.enum(['politik', 'kultur', 'lokales', 'wirtschaft', 'verkehr', 'klima', 'sport']),
});

// Schema for query parameters when listing news
export const NewsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(50).default(12),
  offset: z.coerce.number().min(0).default(0),
  sortBy: z.enum(['publishedAt', 'approvedAt', 'viewCount']).default('approvedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  source: z.enum(['ai_fetched', 'user_submitted']).optional(),
  search: z.string().max(100).optional(),
  dateFrom: z.string().optional(), // ISO date string, e.g. '2026-03-01'
  dateTo: z.string().optional(), // ISO date string, e.g. '2025-03-01' (for archive: older than)
});

