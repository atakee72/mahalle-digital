/**
 * Shared default query options for the calendar list view. Used by BOTH
 * the SSR prefetch (calendar.astro → lib/eventsQuery.ts) and the client
 * CalendarContainer via useEventsQuery. The queryKey must match byte-for-byte
 * for react-query initialData to hydrate without triggering a refetch.
 *
 * Dependency-free (pure JS + Date) so it can be imported from both server
 * (MongoDB) and client (React) code without dragging server-only modules
 * into the browser bundle. See CLAUDE.md "Server-only modules bleeding
 * into client bundles" for the pattern.
 *
 * IMPORTANT: month boundaries are computed in UTC on BOTH sides so the
 * serialized ISO strings match regardless of client timezone. The forum
 * doesn't have this problem because its default query has no Date fields;
 * the calendar defaults to the current-month window.
 */

function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function endOfMonthUTC(d: Date): Date {
  // Last ms of the last day of the month in UTC
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

export function getDefaultCalendarQueryOptions(now: Date = new Date()) {
  return {
    sortBy: 'startDate' as const,
    sortOrder: 'asc' as const,
    dateFrom: startOfMonthUTC(now),
    dateTo: endOfMonthUTC(now),
  };
}
