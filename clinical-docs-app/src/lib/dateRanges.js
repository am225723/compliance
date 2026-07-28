/**
 * Pure, timezone- and DST-safe date-range calculators for the Calendar
 * Notes date presets. Every preset carries equal weight — none of them,
 * including "Last 90 Days", gets special-cased treatment here or in the UI.
 *
 * All ranges are inclusive of both the start and end calendar day in the
 * given IANA time zone. The Google Calendar API's `timeMax` is exclusive,
 * so the returned `timeMax` is always the start of the day *after* the
 * inclusive end day — callers should not subtract further.
 *
 * DST correctness: day arithmetic (addDays/subDays/startOfMonth/etc.) is
 * done on a "wall clock" Date produced by date-fns-tz's toZonedTime, so
 * "add one day" always advances by one calendar day in `timeZone`
 * regardless of whether that day is 23, 24, or 25 hours long across a DST
 * transition. The wall-clock boundary is converted back to a real UTC
 * instant with fromZonedTime immediately before being returned.
 */
import { startOfDay, endOfMonth, startOfMonth, subDays, subMonths, addDays } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

export const DATE_PRESETS = [
  { id: 'today',     label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7',     label: 'Last 7 Days' },
  { id: 'last30',    label: 'Last 30 Days' },
  { id: 'last90',    label: 'Last 90 Days' },
  { id: 'thisMonth', label: 'This Month' },
  { id: 'prevMonth', label: 'Previous Month' },
  { id: 'custom',    label: 'Custom Range' },
];

/** Parse a 'YYYY-MM-DD' wall-clock date string (e.g. from a <input type="date">). */
export function parseWallClockDate(isoDateStr) {
  const [y, m, d] = isoDateStr.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date string: ${isoDateStr}`);
  return new Date(y, m - 1, d);
}

function toApiRange(startDay, endDayInclusive, timeZone) {
  const timeMin = fromZonedTime(startOfDay(startDay), timeZone).toISOString();
  const timeMax = fromZonedTime(addDays(startOfDay(endDayInclusive), 1), timeZone).toISOString();
  return { timeMin, timeMax };
}

/**
 * Resolve a preset id (or 'custom' with customStart/customEnd 'YYYY-MM-DD'
 * strings) into a { timeMin, timeMax } pair suitable for
 * googleCalendar.listEvents(). `referenceDate` is injectable for tests.
 */
export function getPresetRange(presetId, {
  timeZone = 'UTC', referenceDate = new Date(), customStart, customEnd,
} = {}) {
  const now = toZonedTime(referenceDate, timeZone);

  switch (presetId) {
    case 'today':
      return toApiRange(now, now, timeZone);

    case 'yesterday': {
      const y = subDays(now, 1);
      return toApiRange(y, y, timeZone);
    }

    // "Last N Days" is N calendar days ending today, inclusive of today.
    case 'last7':
      return toApiRange(subDays(now, 6), now, timeZone);

    case 'last30':
      return toApiRange(subDays(now, 29), now, timeZone);

    case 'last90':
      return toApiRange(subDays(now, 89), now, timeZone);

    case 'thisMonth':
      return toApiRange(startOfMonth(now), endOfMonth(now), timeZone);

    case 'prevMonth': {
      const prev = subMonths(now, 1);
      return toApiRange(startOfMonth(prev), endOfMonth(prev), timeZone);
    }

    case 'custom': {
      if (!customStart || !customEnd) {
        throw new Error('Custom range requires both a start and end date.');
      }
      const start = parseWallClockDate(customStart);
      const end = parseWallClockDate(customEnd);
      if (end < start) {
        throw new Error('Custom range end date must be on or after the start date.');
      }
      return toApiRange(start, end, timeZone);
    }

    default:
      throw new Error(`Unknown date preset: ${presetId}`);
  }
}
