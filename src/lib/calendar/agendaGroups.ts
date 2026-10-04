// Agenda grouping — pure. A day group lists the events that START on that day (`events`) and,
// separately, the events that started on an EARLIER day and still cover it (`running`).
// The view prints `running` as full rows under today and as one slim line each under any other
// listed day. A day gets a group when an event starts on it; today also gets one when something
// is running. Without `running`, a multi-day event sat only in the group of its start day — a
// past group the agenda hides behind „vergangene anzeigen" — and every later day counted one
// event fewer than the day view (owner reports 2026-10-04).

import { startOfDay } from 'date-fns';
import { eventCoversDay, type EventLike } from './eventTime';

export interface AgendaGroup<E> {
  day: Date;
  /** Events that start on this day, in incoming order. */
  events: E[];
  /** Events that started on an earlier day and still cover this day, in incoming order. */
  running: E[];
}

function asDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

/** Day groups in ascending order. */
export function groupAgenda<E extends EventLike>(events: E[], today: Date): AgendaGroup<E>[] {
  const todayStart = startOfDay(today);
  const map = new Map<number, AgendaGroup<E>>();
  const groupFor = (day: Date) => {
    const key = day.getTime();
    let g = map.get(key);
    if (!g) {
      g = { day, events: [], running: [] };
      map.set(key, g);
    }
    return g;
  };

  const starts = events.map((ev) => startOfDay(asDate(ev.startDate)));
  events.forEach((ev, i) => groupFor(starts[i]).events.push(ev));
  const coversLater = (i: number, day: Date) =>
    starts[i].getTime() < day.getTime() && eventCoversDay(events[i], day);
  if (events.some((_, i) => coversLater(i, todayStart))) groupFor(todayStart);
  for (const g of map.values()) g.running = events.filter((_, i) => coversLater(i, g.day));

  return [...map.values()].sort((a, b) => a.day.getTime() - b.day.getTime());
}
