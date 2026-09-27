// Pure mapping for scripts/repair-allday-event-bounds.ts (dependency-pure).
import { berlinDayStart, berlinDayEnd, isLegacyUtcAllDay } from './berlinDay';

/** Legacy all-day row (UTC midnight → UTC 23:59:59.000) → Berlin day bounds of
 *  the civil days its UTC dates name. Anything else → null (leave alone). */
export function repairedAllDayBounds(start: Date, end: Date): { start: Date; end: Date } | null {
  if (!isLegacyUtcAllDay(start, end)) return null;
  return {
    start: berlinDayStart(start.toISOString().slice(0, 10)),
    end: berlinDayEnd(end.toISOString().slice(0, 10)),
  };
}
