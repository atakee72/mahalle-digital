/**
 * Calendar mutations — TanStack Svelte Query mutations for events.
 * Mirrors src/lib/forumMutations.ts. Each mutation owns optimistic +
 * rollback semantics and shares the RateLimitError class so the
 * compose page can swap the form for RateLimitPanel on 429.
 */

import { createMutation, useQueryClient } from '@tanstack/svelte-query';
import { RateLimitError } from './errors';

export { RateLimitError };

const API_URL = '/api';

// ─── Create event ──────────────────────────────────────────────────────

type CreateEventInput = {
  title: string;
  body: string;
  startDate: string; // ISO datetime
  endDate: string;
  category: string;
  capacity?: number | null;
  allDay?: boolean;
  visibility?: 'public' | 'private';
  location?: string;
  tags?: string[];
};

async function createEventReq(input: CreateEventInput) {
  const res = await fetch(`${API_URL}/events/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input)
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    if (res.status === 429) {
      throw new RateLimitError(
        error.dailyLimit ?? 5,
        error.currentCount ?? 0,
        error.message ?? 'Daily event limit reached'
      );
    }
    const details = error.details
      ? Object.values(error.details).join(', ')
      : '';
    throw new Error(details || error.error || 'Failed to create event');
  }

  return res.json() as Promise<{
    event: any;
    message: string;
    moderationStatus?: 'pending' | 'approved' | 'rejected';
  }>;
}

export function createEventMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: createEventReq,
    onSettled: () => {
      // Single invalidation pattern (per CLAUDE.md gotcha — never stack
      // onSuccess + onSettled with refetchType: 'all').
      queryClient.invalidateQueries({ queryKey: ['calendar', 'events'] });
    }
  }));
}

// ─── Edit event ────────────────────────────────────────────────────────

type EditEventInput = CreateEventInput;

async function editEventReq({ id, input }: { id: string; input: EditEventInput }) {
  const res = await fetch(`${API_URL}/events/edit/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input)
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    const details = error.details
      ? Object.values(error.details).join(', ')
      : '';
    throw new Error(details || error.error || 'Failed to update event');
  }
  return res.json() as Promise<{
    event: any;
    message: string;
    moderationStatus?: 'pending' | 'approved' | 'rejected';
  }>;
}

export function editEventMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: editEventReq,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar', 'events'] });
    }
  }));
}

// ─── RSVP ──────────────────────────────────────────────────────────────

type RsvpInput = {
  eventId: string;
  status: 'going' | 'maybe' | 'cancel';
};

async function rsvpReq(input: RsvpInput) {
  const res = await fetch(`${API_URL}/events/${input.eventId}/rsvp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ status: input.status })
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'RSVP failed');
  }
  return res.json() as Promise<{
    success: boolean;
    status: 'going' | 'maybe' | null;
    rsvps: {
      going: string[];
      maybe: string[];
      goingCount: number;
      maybeCount: number;
    };
  }>;
}

export function rsvpMutation(currentUserId: string) {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: rsvpReq,
    // Optimistic update: flip the user's id in the cached event's rsvps
    // arrays so the UI reflects the change immediately.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['calendar', 'events'] });
      const prev = queryClient.getQueryData<any[]>(['calendar', 'events']);
      if (prev) {
        const next = prev.map((ev) => {
          if (String(ev._id) !== input.eventId) return ev;
          const going: string[] = (ev.rsvps?.going ?? []).filter(
            (id: string) => id !== currentUserId
          );
          const maybe: string[] = (ev.rsvps?.maybe ?? []).filter(
            (id: string) => id !== currentUserId
          );
          if (input.status === 'going') going.push(currentUserId);
          else if (input.status === 'maybe') maybe.push(currentUserId);
          return { ...ev, rsvps: { going, maybe } };
        });
        queryClient.setQueryData(['calendar', 'events'], next);
      }
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(['calendar', 'events'], ctx.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar', 'events'] });
    }
  }));
}
