/**
 * Short day + month for the forum's heading kicker on narrow phones. Pure.
 *
 * The full dateline („FORUM · DONNERSTAG 30. SEPTEMBER · 21:54") wraps below
 * ~410 px, and a wrapped kicker pushes the whole heading down a line. The
 * abbreviations are the calendar's (date-fns `MMM`: „Sep.", „März", „Juni") —
 * the browser's own `month: 'short'` says „Sept." with a day and „Sep"
 * without, so the two sections would read differently. A table instead of a
 * date-fns import keeps the library out of the forum's bundle; the test pins
 * the table to date-fns for all twelve months.
 */
const MONTHS_DE = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDayMonth(date: Date, locale: 'de' | 'en'): string {
  const dd = String(date.getDate()).padStart(2, '0');
  return locale === 'de' ? `${dd}. ${MONTHS_DE[date.getMonth()]}` : `${dd} ${MONTHS_EN[date.getMonth()]}`;
}
