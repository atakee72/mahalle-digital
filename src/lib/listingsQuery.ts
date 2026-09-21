/**
 * SERVER-ONLY: imports connectDB (MongoDB). Never import this from a
 * client Svelte / React component — it will pull Node built-ins into the
 * browser bundle and silently break hydration.
 *
 * Pure constants live in marketplaceQueryOptions.ts for cross-boundary import.
 */
import type { Filter } from 'mongodb';
import { ObjectId } from 'mongodb';
import { connectDB } from './mongodb';
import { LISTINGS_QUERY_OPTIONS } from './marketplaceQueryOptions';
import type { Listing } from '../types/listing';

/**
 * Seller fields exposed to clients. ALLOWLIST — never `{ password: 0 }`,
 * which would ship email / isBanned / pendingEmail / strike counts into
 * client-visible SSR props and JSON responses. Same narrowing rationale as
 * populateAuthors in topicsQuery.ts.
 */
// Allowlist projection — widen only after auditing every client-visible
// consumer (same discipline as populateAuthors in topicsQuery.ts).
// `verified` is public-by-display: it drives the seller card's
// "Verifiziert im Kiez" badge.
// `handle` (2026-09-21): shown next to the seller's name — names may repeat, the handle tells two „Petra"s apart.
const SELLER_PROJECTION = { name: 1, image: 1, userPicture: 1, verified: 1, handle: 1 } as const;

/**
 * Resolve seller name + avatar for a batch of listings with ONE $in query.
 *
 * Deliberately a read-time join, never a stored copy: accountDeletion.ts
 * step 6 tombstones a deleted user's `name` to "Ehemaliges Mitglied" and
 * relies on authored content picking that up on the next read. A
 * denormalized sellerName would freeze the pre-deletion name (and go stale
 * on every rename).
 *
 * sellerId is stored as a plain string today; the join here tolerates an
 * ObjectId-valued sellerId too. But buildListingsFilter below compares
 * `{ sellerId: userId }` as a plain string, so switching storage to ObjectId
 * would keep this join working while silently breaking owner visibility —
 * that filter would need updating too.
 * Unresolvable sellers (hard-deleted user, malformed id) yield null, which
 * the cards render as "—".
 */
export async function populateSellers<T extends Record<string, any>>(
  docs: T[],
): Promise<T[]> {
  if (docs.length === 0) return docs;

  const keyOf = (raw: unknown): string | null => {
    if (!raw) return null;
    const s = typeof raw === 'string' ? raw : String(raw);
    // Canonicalize via ObjectId round-trip: ObjectId.isValid() also accepts
    // uppercase hex and other 12-char strings that round-trip to a DIFFERENT
    // canonical form than the map (built from `u._id.toString()`) uses — an
    // uncanonicalized key would join fine but miss the lookup below.
    return ObjectId.isValid(s) ? new ObjectId(s).toHexString() : null;
  };

  const idSet = new Set<string>();
  for (const doc of docs) {
    const key = keyOf(doc.sellerId);
    if (key) idSet.add(key);
  }

  let byId = new Map<string, any>();
  if (idSet.size > 0) {
    const db = await connectDB();
    const users = await db
      .collection('users')
      .find(
        { _id: { $in: Array.from(idSet).map((id) => new ObjectId(id)) } },
        { projection: SELLER_PROJECTION },
      )
      .toArray();
    byId = new Map(users.map((u) => [u._id.toString(), u]));
  }

  return docs.map((doc) => {
    const key = keyOf(doc.sellerId);
    const u = key ? byId.get(key) : undefined;
    return {
      ...doc,
      sellerName: u?.name ?? null,
      sellerImage: u?.userPicture ?? u?.image ?? null,
      sellerVerified: u?.verified === true,
      sellerHandle: typeof u?.handle === 'string' ? u.handle : null,
    };
  });
}

/**
 * Build the combined moderation + marketplace-status visibility filter.
 *
 * Moderation visibility (mirrors forum/calendar precedent):
 *   - approved and legacy (no moderationStatus) → visible to all
 *   - pending + isUserReported=true → visible to all (anti-abuse: reporter
 *     can't hide content by flagging it)
 *   - own pending/rejected → visible only to seller
 *
 * Marketplace status visibility (per A7 + Issue 7):
 *   - available / reserved → visible to everyone (incl. logged-out)
 *   - sold / exchanged / draft → owner-only AND only when explicitly browsing
 *     `view=mine`. Owners don't see their own drafts/sold leaking into the
 *     public feed; they have to ask for the "Meine Anzeigen" view.
 *
 * The `ownerScope: 'mine'` flag widens the status arm to include all of the
 * seller's listings (Task 5.x edit/bump/status flows pass it; the default
 * public browse leaves it off).
 */
export function buildListingsFilter(
  userId: string | null,
  opts: { ownerScope?: 'mine' } = {},
): Filter<any> {
  const modOr = [
    { moderationStatus: 'approved' },
    { moderationStatus: { $exists: false } },
    { moderationStatus: 'pending', isUserReported: true },
    ...(userId
      ? [
          { sellerId: userId, moderationStatus: 'pending' },
          { sellerId: userId, moderationStatus: 'rejected' },
        ]
      : []),
  ];

  // A5 superseded May 2026: drop the 60d hide. Single threshold at 21d
  // keyed off max(lastBumpedAt, createdAt) — the "freshness clock". Past-21d
  // listings disappear from the public feed entirely; only the author sees
  // them (grayed + warning chip in Meine Anzeigen) until they bump or delete.
  // Bumping resets the clock and brings the listing back into public view.
  const TWENTY_ONE_DAYS_MS = 21 * 24 * 60 * 60 * 1000;
  const twentyOneDaysAgo = new Date(Date.now() - TWENTY_ONE_DAYS_MS);

  const statusFilter: Filter<any> =
    userId && opts.ownerScope === 'mine'
      ? {
          $or: [
            { status: { $in: ['available', 'reserved'] } },
            { sellerId: userId }, // owner-only 'mine' view: any status, any age
          ],
        }
      : {
          // Public branch: status in [available, reserved] AND freshness clock
          // (max of lastBumpedAt + createdAt) within the last 21 days. Owners
          // still see their own listings at any age via the sellerId arm.
          // $expr + $ifNull collapses the (lastBumpedAt OR createdAt) decision
          // into one branch; downside is no index use, fine at current scale.
          $or: [
            {
              status: { $in: ['available', 'reserved'] },
              $expr: {
                $gte: [
                  { $ifNull: ['$lastBumpedAt', '$createdAt'] },
                  twentyOneDaysAgo,
                ],
              },
            },
            ...(userId ? [{ sellerId: userId }] : []),
          ],
        };

  return {
    $and: [{ $or: modOr }, statusFilter],
  };
}

export interface ListingsFetchInput {
  /** 'sell' | 'exchange' | 'gift' — omit or 'all' to show everything */
  kind?: 'sell' | 'exchange' | 'gift' | 'all';
  /** category slug — omit or 'all' to show all categories */
  category?: string | 'all';
  /** full-text search across title + descriptionPlainText */
  search?: string;
  /** 'mine' = seller's own listings; 'saved' = listings savedBy userId */
  view?: 'mine' | 'saved' | null;
  limit?: number;
  offset?: number;
}

export interface ListingsFetchResult {
  items: Listing[];
  total: number;
}

export async function fetchListingsForSSR(
  input: ListingsFetchInput,
  userId: string | null,
): Promise<ListingsFetchResult> {
  const db = await connectDB();
  const col = db.collection<Listing>('listings');

  const ownerScope = input.view === 'mine' && userId ? 'mine' : undefined;
  const baseFilter = buildListingsFilter(userId, { ownerScope });
  const extra: Filter<any>[] = [];

  if (input.kind && input.kind !== 'all') {
    extra.push({ listingType: input.kind });
  }
  if (input.category && input.category !== 'all') {
    extra.push({ category: input.category });
  }
  if (input.search) {
    const q = input.search.trim();
    if (q) {
      // Escape regex special chars before constructing the pattern
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      extra.push({
        $or: [
          { title: { $regex: safe, $options: 'i' } },
          { descriptionPlainText: { $regex: safe, $options: 'i' } },
        ],
      });
    }
  }
  if (input.view === 'mine' && userId) {
    extra.push({ sellerId: userId });
  }
  if (input.view === 'saved' && userId) {
    extra.push({ savedBy: userId });
  }

  // Merge extra filters into the base $and array
  const filter: Filter<any> = extra.length
    ? { $and: [...(baseFilter.$and ?? [baseFilter]), ...extra] }
    : baseFilter;

  const projection = Object.fromEntries(
    LISTINGS_QUERY_OPTIONS.fields.map((f) => [f, 1]),
  );

  const limit = input.limit ?? LISTINGS_QUERY_OPTIONS.defaultLimit;
  const offset = input.offset ?? 0;

  const [rawItems, total] = await Promise.all([
    col
      .find(filter, { projection })
      .sort({
        [LISTINGS_QUERY_OPTIONS.sortBy]:
          LISTINGS_QUERY_OPTIONS.sortOrder === 'desc' ? -1 : 1,
      })
      .skip(offset)
      .limit(limit)
      .toArray(),
    col.countDocuments(filter),
  ]);

  // Serialize ObjectIds + Dates to plain strings for SSR transport (forum pattern).
  // A5 — lastBumpedAt is owner-only. The "freshly bumped" strap is the only
  // public signal; the exact timestamp would leak bump cadence to non-owners.
  const items = rawItems.map((it: any) => {
    const sellerIdStr =
      typeof it.sellerId === 'object' ? it.sellerId.toString() : it.sellerId;
    const isOwner = userId && sellerIdStr === userId;

    return {
      ...it,
      _id: it._id?.toString(),
      sellerId: sellerIdStr,
      bundleId: it.bundleId
        ? typeof it.bundleId === 'object'
          ? it.bundleId.toString()
          : it.bundleId
        : null,
      createdAt:
        it.createdAt instanceof Date ? it.createdAt.toISOString() : it.createdAt,
      updatedAt:
        it.updatedAt instanceof Date ? it.updatedAt.toISOString() : it.updatedAt,
      reservedAt:
        it.reservedAt instanceof Date
          ? it.reservedAt.toISOString()
          : it.reservedAt,
      // Strip lastBumpedAt unless the viewer is the seller. The bump strap
      // is derived from this field server-side in Task 2.3/5.x; non-owner
      // callers should receive a boolean (`isBumped`) instead. For v1 the
      // card derives its strap client-side from the truncated value below
      // (24h-rounded) — preserves the "is bumped" signal without leaking
      // exact cadence.
      lastBumpedAt: isOwner
        ? it.lastBumpedAt instanceof Date
          ? it.lastBumpedAt.toISOString()
          : it.lastBumpedAt
        : undefined,
      isBumped:
        it.lastBumpedAt instanceof Date
          ? Date.now() - it.lastBumpedAt.getTime() < 24 * 60 * 60 * 1000
          : false,
      // Owner-facing virtual: true when the listing is past the 21-day public
      // visibility clock. Drives the grayed card + warning chip in Meine
      // Anzeigen. Always false for any listing a non-owner receives (the
      // server-side filter ensures it); variable for the owner's own listings.
      isPubliclyHidden: isPubliclyHiddenFrom(it.lastBumpedAt, it.createdAt),
    };
  }) as Listing[];

  // Seller name/avatar are join-populated, never stored (see populateSellers).
  const withSellers = (await populateSellers(items)) as Listing[];

  return { items: withSellers, total };
}

/**
 * Compute the "past 21d freshness" boolean from the freshness clock.
 * Used in both serializers + by fetchListingDetailForSSR.
 */
export function isPubliclyHiddenFrom(
  lastBumpedAt: Date | string | null | undefined,
  createdAt: Date | string | null | undefined,
): boolean {
  const TWENTY_ONE_DAYS_MS = 21 * 24 * 60 * 60 * 1000;
  const refRaw = lastBumpedAt ?? createdAt;
  if (!refRaw) return false; // missing both — treat as fresh (defensive)
  const refMs = refRaw instanceof Date ? refRaw.getTime() : new Date(refRaw).getTime();
  if (Number.isNaN(refMs)) return false;
  return Date.now() - refMs >= TWENTY_ONE_DAYS_MS;
}

/**
 * Single-document fetcher for SSR detail pages (/marketplace/[id]).
 *
 * Uses ownerScope: 'mine' so the owner can view their own draft/sold/exchanged
 * listings via direct URL. Public visitors will still get null for those status
 * values (the moderation filter handles it).
 *
 * Returns null when:
 *   - id is not a valid ObjectId
 *   - document doesn't exist in the collection
 *   - viewer doesn't satisfy visibility rules (non-owner + rejected/draft/etc.)
 */
export async function fetchListingForSSR(
  id: string,
  userId: string | null,
): Promise<Listing | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await connectDB();
  const col = db.collection<Listing>('listings');

  // ownerScope: 'mine' widens status arm so owner can access draft/sold
  // via direct URL; public visitors still filtered by standard visibility.
  const baseFilter = buildListingsFilter(userId, { ownerScope: 'mine' });
  const item = await col.findOne({
    $and: [{ _id: new ObjectId(id) }, baseFilter],
  } as any);
  if (!item) return null;

  const it = item as any;
  const sellerIdStr =
    typeof it.sellerId === 'object' ? it.sellerId.toString() : it.sellerId;
  const isOwner = !!(userId && sellerIdStr === userId);

  const listing = {
    ...it,
    _id: it._id?.toString(),
    sellerId: sellerIdStr,
    bundleId: it.bundleId
      ? typeof it.bundleId === 'object'
        ? it.bundleId.toString()
        : it.bundleId
      : null,
    createdAt:
      it.createdAt instanceof Date ? it.createdAt.toISOString() : it.createdAt,
    updatedAt:
      it.updatedAt instanceof Date ? it.updatedAt.toISOString() : it.updatedAt,
    reservedAt:
      it.reservedAt instanceof Date
        ? it.reservedAt.toISOString()
        : it.reservedAt,
    // A5: strip lastBumpedAt for non-owners; expose as isBumped boolean instead
    lastBumpedAt: isOwner
      ? it.lastBumpedAt instanceof Date
        ? it.lastBumpedAt.toISOString()
        : it.lastBumpedAt
      : undefined,
    isBumped:
      it.lastBumpedAt instanceof Date
        ? Date.now() - it.lastBumpedAt.getTime() < 24 * 60 * 60 * 1000
        : false,
    isPubliclyHidden: isPubliclyHiddenFrom(it.lastBumpedAt, it.createdAt),
  } as Listing;

  const [withSeller] = await populateSellers([listing]);
  return withSeller as Listing;
}

/**
 * Detail-page fetcher: discriminated union so the page can render the
 * "hidden past 21d" friendly page (HTTP 200) instead of redirecting to
 * not_found. Single raw findOne — no visibility filter, the kind derives
 * from {existence, ownership, freshness}.
 *
 * Used by /marketplace/[id].astro. Edit page keeps using fetchListingForSSR.
 */
export type ListingDetailFetchResult =
  | { kind: 'visible'; listing: Listing }
  | { kind: 'hidden_past_21d' }
  | { kind: 'not_found' };

export async function fetchListingDetailForSSR(
  id: string,
  userId: string | null,
): Promise<ListingDetailFetchResult> {
  if (!ObjectId.isValid(id)) return { kind: 'not_found' };
  const db = await connectDB();
  const col = db.collection<Listing>('listings');
  const item = await col.findOne({ _id: new ObjectId(id) } as any);
  if (!item) return { kind: 'not_found' };

  const it = item as any;
  const sellerIdStr =
    typeof it.sellerId === 'object' ? it.sellerId.toString() : it.sellerId;
  const isOwner = !!(userId && sellerIdStr === userId);

  // Visibility rules (mirror buildListingsFilter):
  //   - Owner: see own at any status, any age
  //   - Non-owner: must be available/reserved AND fresh (within 21d)
  //   - Moderation: must be approved OR (pending + isUserReported) OR legacy
  if (!isOwner) {
    const modOk =
      it.moderationStatus === 'approved' ||
      it.moderationStatus === undefined ||
      it.moderationStatus === null ||
      (it.moderationStatus === 'pending' && it.isUserReported);
    if (!modOk) return { kind: 'not_found' };

    const statusOk =
      it.status === 'available' || it.status === 'reserved';
    if (!statusOk) return { kind: 'not_found' };

    if (isPubliclyHiddenFrom(it.lastBumpedAt, it.createdAt)) {
      return { kind: 'hidden_past_21d' };
    }
  }

  const listing = {
    ...it,
    _id: it._id?.toString(),
    sellerId: sellerIdStr,
    bundleId: it.bundleId
      ? typeof it.bundleId === 'object'
        ? it.bundleId.toString()
        : it.bundleId
      : null,
    createdAt:
      it.createdAt instanceof Date ? it.createdAt.toISOString() : it.createdAt,
    updatedAt:
      it.updatedAt instanceof Date ? it.updatedAt.toISOString() : it.updatedAt,
    reservedAt:
      it.reservedAt instanceof Date
        ? it.reservedAt.toISOString()
        : it.reservedAt,
    lastBumpedAt: isOwner
      ? it.lastBumpedAt instanceof Date
        ? it.lastBumpedAt.toISOString()
        : it.lastBumpedAt
      : undefined,
    isBumped:
      it.lastBumpedAt instanceof Date
        ? Date.now() - it.lastBumpedAt.getTime() < 24 * 60 * 60 * 1000
        : false,
    isPubliclyHidden: isPubliclyHiddenFrom(it.lastBumpedAt, it.createdAt),
  } as Listing;

  const [withSeller] = await populateSellers([listing]);
  return { kind: 'visible', listing: withSeller as Listing };
}
