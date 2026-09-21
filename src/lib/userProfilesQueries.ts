/**
 * Batch user-profile query (TanStack Svelte Query).
 *
 * Given a thunk returning user IDs, fetches { id, name, image }[] from
 * /api/users/profiles?ids=... when the modal opens. IDs are deduped
 * and sorted in the cache key so [a, b, a] and [b, a] share an entry.
 *
 * Used by EventDetailModal's attendee cluster — fills in real avatars
 * (KioskAvatar with name + image) over the colored-disc placeholder
 * rendered while the query is in flight.
 */

import { createQuery } from '@tanstack/svelte-query';

export type UserProfile = {
  id: string;
  name: string;
  handle: string | null;
  image: string | null;
};

async function fetchProfiles(ids: string[]): Promise<UserProfile[]> {
  if (ids.length === 0) return [];
  const qs = new URLSearchParams({ ids: ids.join(',') });
  const res = await fetch(`/api/users/profiles?${qs}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`fetch /api/users/profiles ${res.status}`);
  const json = await res.json();
  return (json.users ?? []) as UserProfile[];
}

export function createUserProfilesQuery(idsFn: () => string[]) {
  return createQuery<UserProfile[]>(() => {
    const dedupSorted = [...new Set(idsFn())].sort();
    return {
      queryKey: ['userProfiles', dedupSorted.join(',')] as const,
      queryFn: () => fetchProfiles(dedupSorted),
      enabled: dedupSorted.length > 0,
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false
    };
  });
}
