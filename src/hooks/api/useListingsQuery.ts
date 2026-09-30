/**
 * Client-side fetch helper for marketplace listings.
 *
 * The marketplace browse orchestrator is a Svelte 5 component (not React),
 * so this file exports a plain async function rather than a React hook.
 * The Svelte orchestrator (Task 2.5) calls fetchListingsClient() inside a
 * $effect, mirroring the pattern used by MarketplaceBrowseInner.svelte.
 *
 * There is no React Query in the project any more (removed 2026-09-30);
 * a future React surface would add it back and wrap this function.
 */
import type { Listing } from '../../types/listing';

export interface ListingsQueryFilters {
  /** 'sell' | 'exchange' | 'gift' — omit or 'all' to show everything */
  kind?: 'sell' | 'exchange' | 'gift' | 'all';
  /** category slug — omit or 'all' to show all categories */
  category?: string | 'all';
  /** full-text search across title + descriptionPlainText */
  search?: string;
  /** 'mine' = seller's own listings; 'saved' = listings savedBy user */
  view?: 'mine' | 'saved' | null;
  limit?: number;
  offset?: number;
}

export interface ListingsQueryResponse {
  items: Listing[];
  total: number;
}

/**
 * Fetch listings from the API. Safe to call from any client context
 * (Svelte $effect, React useEffect, etc.).
 */
export async function fetchListingsClient(
  filters: ListingsQueryFilters,
): Promise<ListingsQueryResponse> {
  const params = new URLSearchParams();
  if (filters.kind && filters.kind !== 'all') params.set('kind', filters.kind);
  if (filters.category && filters.category !== 'all')
    params.set('category', filters.category);
  if (filters.search) params.set('search', filters.search);
  if (filters.view) params.set('view', filters.view);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));

  const res = await fetch(`/api/listings?${params.toString()}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Listings fetch failed: ${res.status}`);
  return res.json();
}
