/**
 * Saved-events query + mutation factories (TanStack Svelte Query).
 *
 * Mirrors the existing savedPosts API (`/api/posts/save`). One query
 * for the user's saved event id list, one mutation that POSTs
 * `{ eventId, action: 'save'|'unsave' }`.
 *
 * The cache (`qk.savedEvents`) is the single source of truth: both the
 * MERKEN button state per AgendaRow and the "Gespeichert" filter on the
 * category rail read it. Optimistic flips happen in onMutate so the UI
 * reflects the toggle immediately; onError rolls back from the snapshot
 * and onSettled re-invalidates once for the server reconciliation.
 */

import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { qk } from './queryKeys';

const API_URL = '/api';

// ─── Query ────────────────────────────────────────────────────────────

async function fetchSavedEventIds(): Promise<string[]> {
  const res = await fetch(`${API_URL}/events/save`, { credentials: 'include' });
  if (!res.ok) throw new Error(`fetch /api/events/save ${res.status}`);
  const json = await res.json();
  return (json.savedIds ?? []) as string[];
}

export function createSavedEventsQuery(enabled: () => boolean) {
  return createQuery<string[]>(() => ({
    queryKey: qk.savedEvents,
    queryFn: fetchSavedEventIds,
    enabled: enabled(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false
  }));
}

// ─── Mutation ─────────────────────────────────────────────────────────

type SaveEventInput = {
  eventId: string;
  action: 'save' | 'unsave';
};

async function saveEventReq({ eventId, action }: SaveEventInput) {
  const res = await fetch(`${API_URL}/events/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ eventId, action })
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || `Failed to ${action} event`);
  }
  return res.json();
}

export function createSaveEventMutation() {
  const qc = useQueryClient();

  return createMutation(() => ({
    mutationFn: saveEventReq,
    onMutate: async ({ eventId, action }: SaveEventInput) => {
      await qc.cancelQueries({ queryKey: qk.savedEvents });
      const prev = qc.getQueryData<string[]>(qk.savedEvents);
      const next =
        action === 'save'
          ? [...(prev ?? []), eventId]
          : (prev ?? []).filter((id) => id !== eventId);
      qc.setQueryData(qk.savedEvents, next);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) {
        qc.setQueryData(qk.savedEvents, ctx.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.savedEvents });
    }
  }));
}
