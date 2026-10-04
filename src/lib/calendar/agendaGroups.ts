// Agenda grouping — pure. An event is listed under its START day; an event that started on an
// earlier day and still covers today is ALSO listed under today, first in that group. Without
// that, a running multi-day event sat only in a past day group, which the agenda hides behind
// „vergangene anzeigen" — the day view showed it, the agenda did not (owner report 2026-10-04).

import { startOfDay } from 'date-fns';
import { eventCoversDay, type EventLike } from './eventTime';

export interface AgendaGroup<E> {
  day: Date;
  events: E[];
}

function asDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

/** Day groups in ascending order. `events` keep their incoming order inside a group. */
export function groupAgenda<E extends EventLike>(events: E[], today: Date): AgendaGroup<E>[] {
  const todayStart = startOfDay(today);
  const map = new Map<number, AgendaGroup<E>>();
  const groupFor = (day: Date) => {
    const key = day.getTime();
    let g = map.get(key);
    if (!g) {
      g = { day, events: [] };
      map.set(key, g);
    }
    return g;
  };

  const running: E[] = [];
  for (const ev of events) {
    const startDay = startOfDay(asDate(ev.startDate));
    groupFor(startDay).events.push(ev);
    if (startDay.getTime() < todayStart.getTime() && eventCoversDay(ev, todayStart)) running.push(ev);
  }
  if (running.length > 0) {
    const g = groupFor(todayStart);
    g.events = [...running, ...g.events];
  }
  return [...map.values()].sort((a, b) => a.day.getTime() - b.day.getTime());
}
