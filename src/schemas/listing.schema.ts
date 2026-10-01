import { z } from 'zod';

// Delta format schema (from typewriter-editor)
export const DeltaOpSchema = z.object({
  insert: z.union([z.string(), z.record(z.unknown())]),
  attributes: z.record(z.unknown()).optional()
});

export const DeltaSchema = z.object({
  ops: z.array(DeltaOpSchema)
});

// A1: add 'gift' listing type
export const ListingTypeSchema = z.enum(['sell', 'exchange', 'gift']);

/**
 * @deprecated Legacy category enum — not for new code.
 * Kept so existing API route imports don't break until Task 8 sweeps them to KioskCategorySchema.
 * Legacy keys are passthrough on read (DB is permissive); all new writes use KioskCategorySchema.
 */
export const ListingCategorySchema = z.enum([
  'furniture',
  'electronics',
  'clothing',
  'books',
  'comics',
  'toys',
  'handmade',
  'home-garden',
  'sports',
  'other'
]);

// A2: New write-path category enum (9 German keys)
// Legacy keys documented below for archaeology — NOT validated, DB accepts on read (passthrough).
// Legacy: 'furniture', 'electronics', 'clothing', 'books', 'comics', 'toys', 'handmade', 'home-garden', 'sports', 'other'
// One-time backfill: scripts/migrate-legacy-categories.ts mapped all legacy rows to the keys below.
// Taxonomy expanded 9 → 13 keys: added 'garten' (split from werkzeug's "& Garten"), 'spielzeug'
// (split from kind/Kinder), 'handgemacht' (was sonstiges-bound), 'sport' (was sonstiges-bound).
// 'kind' renamed → 'kinder'.
export const KioskCategorySchema = z.enum([
  'moebel',
  'garten',
  'werkzeug',
  'kleidung',
  'medien',
  'elektronik',
  'fahrrad',
  'pflanze',
  'kinder',
  'spielzeug',
  'handgemacht',
  'sport',
  'sonstiges',
]);

// i3: Condition — English keys, 5 values, unchanged
export const ListingConditionSchema = z.enum([
  'like-new',
  'excellent',
  'very-good',
  'good',
  'fair'
]);

// A7: 'reserved' was already present — kept as-is
export const ListingStatusSchema = z.enum([
  'draft',
  'available',
  'reserved',
  'sold',
  'exchanged'
]);

// A3: delivery enum
export const DeliverySchema = z.enum(['abholung', 'versand', 'abholungVersand']);

// A4: specs — 5 German free-text fields, no 'condition' (flat top-level enum)
export const SpecsSchema = z.object({
  masse:    z.string().max(80).optional(),
  material: z.string().max(80).optional(),
  baujahr:  z.string().max(20).optional(), // string, not number — allows "ca. 1970", "60er"
  farbe:    z.string().max(40).optional(),
  gewicht:  z.string().max(40).optional(),
}).optional();

export const ListingCreateSchema = z.object({
  title: z
    .string()
    .min(5, 'Title must be at least 5 characters')
    .max(100, 'Title must be less than 100 characters')
    .trim(),
  // Accept either Delta (rich text) or string (legacy plain text)
  description: z.union([DeltaSchema, z.string()]),
  // Plain text version for validation and search
  descriptionPlainText: z
    .string()
    .min(20, 'Description must be at least 20 characters')
    .max(2000, 'Description must be less than 2000 characters')
    .trim(),
  listingType: ListingTypeSchema.optional().default('sell'),
  exchangeFor: z.string().max(150, 'Exchange request must be less than 150 characters').optional(),
  category: KioskCategorySchema,
  // A4 + Task 4.1 OptionalDetails — condition lives in the "Details (optional)"
  // section of compose. Keep it top-level (not nested under specs) but optional.
  condition: ListingConditionSchema.optional(),
  // Optional at the base: exchange/gift listings carry no price and the
  // compose form sends none (MarketComposeInner passes undefined). The
  // superRefine below enforces that 'sell' listings DO have a price — making
  // this required here rejected every exchange/gift publish with
  // `price: Required` before the refine ever ran.
  price: z
    .number()
    .min(0)
    .max(100000, 'Price must be less than 100,000')
    .optional(),
  originalPrice: z
    .number()
    .min(0)
    .max(100000)
    .optional()
    .nullable(),
  images: z
    .array(z.string().url('Each image must be a valid URL'))
    .min(1, 'At least one image is required')
    .max(5, 'Maximum 5 images allowed'),
  delivery: DeliverySchema,
  specs: SpecsSchema,
}).superRefine((data, ctx) => {
  if (data.listingType === 'sell' && (!data.price || data.price < 0.01)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Price must be greater than 0 for sell listings',
      path: ['price'],
    });
  }
  if (data.listingType === 'gift' && data.price && data.price > 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'gift listings cannot have a price',
      path: ['price'],
    });
  }
  if (data.listingType === 'exchange' && data.price && data.price > 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'exchange listings cannot have a price; create separate sell + exchange listings if you want both',
      path: ['price'],
    });
  }
});

export const ListingUpdateSchema = z.object({
  title: z
    .string()
    .min(5, 'Title must be at least 5 characters')
    .max(100, 'Title must be less than 100 characters')
    .trim()
    .optional(),
  // Accept either Delta (rich text) or string (legacy plain text)
  description: z.union([DeltaSchema, z.string()]).optional(),
  // Plain text version for validation and search
  descriptionPlainText: z
    .string()
    .min(20, 'Description must be at least 20 characters')
    .max(2000, 'Description must be less than 2000 characters')
    .trim()
    .optional(),
  listingType: ListingTypeSchema.optional(),
  exchangeFor: z.string().max(150).optional().nullable(),
  category: KioskCategorySchema.optional(),
  condition: ListingConditionSchema.optional(),
  price: z
    .number()
    .min(0)
    .max(100000, 'Price must be less than 100,000')
    .optional(),
  originalPrice: z
    .number()
    .min(0)
    .max(100000)
    .optional()
    .nullable(),
  images: z
    .array(z.string().url('Each image must be a valid URL'))
    .min(1, 'At least one image is required')
    .max(5, 'Maximum 5 images allowed')
    .optional(),
  status: ListingStatusSchema.optional(),
  delivery: DeliverySchema.optional(),
  specs: SpecsSchema,
}).superRefine((data, ctx) => {
  if (Object.keys(data).length === 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'At least one field must be provided for update',
      path: [],
    });
  }
  // Only validate price constraints if both listingType and price are present in the partial update
  if (data.listingType !== undefined && data.price !== undefined) {
    if (data.listingType === 'sell' && data.price < 0.01) {
      ctx.addIssue({
        code: 'custom',
        message: 'Price must be greater than 0 for sell listings',
        path: ['price'],
      });
    }
    if (data.listingType === 'gift' && data.price > 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'gift listings cannot have a price',
        path: ['price'],
      });
    }
    if (data.listingType === 'exchange' && data.price > 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'exchange listings cannot have a price; create separate sell + exchange listings if you want both',
        path: ['price'],
      });
    }
  }
});

export const ListingFilterSchema = z.object({
  category: z.string().or(z.literal('all')).optional(),
  condition: ListingConditionSchema.or(z.literal('all')).optional(),
  listingType: ListingTypeSchema.or(z.literal('all')).optional(),
  priceMin: z.coerce.number().min(0).optional(),
  priceMax: z.coerce.number().max(100000).optional(),
  status: ListingStatusSchema.optional(),
  search: z.string().optional(),
  sortBy: z.enum(['newest', 'oldest', 'price-asc', 'price-desc']).default('newest'),
  limit: z.coerce.number().min(1).max(50).default(12),
  offset: z.coerce.number().min(0).default(0)
});

// Step-specific schemas for wizard validation
export const ListingStep1Schema = z.object({
  title: z
    .string()
    .min(5, 'Title must be at least 5 characters')
    .max(100, 'Title must be less than 100 characters')
    .trim(),
  description: z
    .string()
    .min(20, 'Description must be at least 20 characters')
    .max(2000, 'Description must be less than 2000 characters')
    .trim(),
  listingType: ListingTypeSchema.optional().default('sell'),
  category: KioskCategorySchema,
  condition: ListingConditionSchema
});

export const ListingStep2Schema = z.object({
  images: z
    .array(z.string().url('Each image must be a valid URL'))
    .min(1, 'At least one image is required')
    .max(5, 'Maximum 5 images allowed')
});

export const ListingStep3Schema = z.object({
  price: z
    .number()
    .min(0.01, 'Price must be greater than 0')
    .max(100000, 'Price must be less than 100,000'),
  originalPrice: z
    .number()
    .min(0)
    .max(100000)
    .optional()
    .nullable()
});

// Relaxed schema for saving drafts — only title required
export const ListingDraftSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required to save a draft')
    .max(100, 'Title must be less than 100 characters')
    .trim(),
  description: z.union([DeltaSchema, z.string()]).optional(),
  descriptionPlainText: z
    .string()
    .max(2000, 'Description must be less than 2000 characters')
    .trim()
    .optional(),
  listingType: ListingTypeSchema.optional().default('sell'),
  exchangeFor: z.string().max(150).optional(),
  category: KioskCategorySchema.optional(),
  condition: ListingConditionSchema.optional(),
  price: z
    .number()
    .min(0)
    .max(100000)
    .optional(),
  originalPrice: z
    .number()
    .min(0)
    .max(100000)
    .optional()
    .nullable(),
  images: z
    .array(z.string().url('Each image must be a valid URL'))
    .max(5, 'Maximum 5 images allowed')
    .optional()
    .default([]),
  delivery: DeliverySchema.optional(),
  specs: SpecsSchema,
  draftId: z.string().optional() // For updating an existing draft
});

