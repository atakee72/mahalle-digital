import type { ObjectId } from 'mongodb';

// Delta format from typewriter-editor
export interface DeltaOp {
  insert: string | object;
  attributes?: Record<string, unknown>;
}

export interface Delta {
  ops: DeltaOp[];
}

// A1: 'gift' added
export type ListingType = 'sell' | 'exchange' | 'gift';

/**
 * @deprecated Legacy category union — kept for archival reference only.
 * New code should use `ListingCategory = string` (read-permissive).
 * Write-path uses KioskCategorySchema from listing.schema.ts.
 */
export type LegacyListingCategory =
  | 'furniture'
  | 'electronics'
  | 'clothing'
  | 'books'
  | 'comics'
  | 'toys'
  | 'handmade'
  | 'home-garden'
  | 'sports'
  | 'other';

// A2: Permissive read-path type — legacy values pass through, new kiosk keys accepted
export type ListingCategory = string;

export type ListingCondition =
  | 'like-new'
  | 'excellent'
  | 'very-good'
  | 'good'
  | 'fair';

// A7: 'reserved' was already present
export type ListingStatus = 'draft' | 'available' | 'reserved' | 'sold' | 'exchanged';

// A3: delivery options
export type ListingDelivery = 'abholung' | 'versand' | 'abholungVersand';

// A4: specs — 5 German free-text fields
export interface ListingSpecs {
  masse?: string;
  material?: string;
  baujahr?: string;
  farbe?: string;
  gewicht?: string;
}

export interface Listing {
  _id?: ObjectId | string;
  title: string;
  description: string | Delta; // Plain text (legacy) or Delta (rich text)
  descriptionPlainText?: string; // Plain text version for search (new listings only)
  listingType: ListingType; // 'sell' | 'exchange' | 'gift'
  exchangeFor?: string; // What the seller wants in return (exchange only)
  category: ListingCategory; // Permissive: legacy values pass through
  condition?: ListingCondition | null;
  price: number;
  originalPrice?: number | null;
  images: string[];
  sellerId: ObjectId | string;
  sellerName?: string | null;
  sellerHandle?: string | null;
  sellerImage?: string | null;
  sellerVerified?: boolean;
  status: ListingStatus;
  moderationStatus?: 'approved' | 'pending' | 'rejected';
  isUserReported?: boolean;
  hasWarningLabel?: boolean;
  warningText?: string;
  rejectionReason?: string;
  views: number;
  savedBy: (ObjectId | string)[];
  createdAt: Date;
  updatedAt: Date;

  // A3: delivery
  delivery?: ListingDelivery | null;

  // A4: specs
  specs?: ListingSpecs | null;

  // A7: reservation timestamp
  reservedAt?: Date | string | null;

  // A5: last bumped timestamp — owner-only. Stripped from non-owner SSR
  // payloads in listingsQuery.ts; do NOT reference directly from public-card
  // render paths. The bump strap derives from `isBumped` below instead.
  lastBumpedAt?: Date | string | null;

  // Server-computed virtual: true when lastBumpedAt is within the last 24h.
  // Exposed to all viewers (including non-owners) so the "frisch hochgeholt"
  // strap renders without leaking the exact bump timestamp.
  isBumped?: boolean;

  // Server-computed virtual: true when the listing is past the 21-day
  // public-visibility clock (max(lastBumpedAt, createdAt) < now - 21d).
  // Drives the grayed card + warning chip in the author's „Meine Anzeigen"
  // view. Always false for any listing a non-owner receives (the server-side
  // filter in buildListingsFilter already excludes past-21d listings from
  // public branches). Variable for the owner's own listings.
  isPubliclyHidden?: boolean;

  // A9: bundle FK — reserved for v2, always null in v1
  bundleId?: string | null;
}

export interface ListingStats {
  totalListings: number;
  activeListings: number;
  soldItems: number;
  totalEarnings: number;
  /** Active listings (available/reserved) past the 21d freshness clock —
      live but hidden from the public feed until the owner bumps. */
  staleCount: number;
}
