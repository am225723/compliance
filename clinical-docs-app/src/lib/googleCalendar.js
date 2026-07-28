/**
 * Google Calendar (read-only) integration. Shares the same OAuth token
 * client and refresh machinery as googleDrive.js — Calendar access is just
 * an additional scope (calendar.readonly) on the same connection, not a
 * separate auth flow.
 */
import { ensureValidToken } from './googleDrive';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

async function calendarRequest(path, params = {}) {
  const token = await ensureValidToken();
  const url = new URL(`${CALENDAR_API}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Calendar API error ${res.status}: ${await res.text()}`);
  return res.json();
}

/** List calendars the connected account can read. */
export async function listCalendars() {
  const calendars = [];
  let pageToken;
  do {
    const data = await calendarRequest('/users/me/calendarList', { maxResults: 250, pageToken });
    for (const c of data.items || []) {
      if (c.deleted) continue;
      calendars.push({
        id: c.id,
        summary: c.summary || c.id,
        primary: !!c.primary,
        accessRole: c.accessRole,
        backgroundColor: c.backgroundColor || null,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return calendars;
}

function normalizeEvent(ev, calendarId) {
  const start = ev.start?.dateTime || ev.start?.date || null;
  const end = ev.end?.dateTime || ev.end?.date || null;
  const allDay = !ev.start?.dateTime;
  const durationMinutes = (start && end && !allDay)
    ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
    : null;

  return {
    eventId: ev.id,
    calendarId,
    title: ev.summary || '(No title)',
    description: ev.description || '',
    location: ev.location || '',
    start,
    end,
    allDay,
    durationMinutes,
    attendees: (ev.attendees || []).map(a => ({
      email: a.email, displayName: a.displayName || null, responseStatus: a.responseStatus || null,
    })),
    // Present on expanded instances of a recurring series (singleEvents=true below).
    recurringEventId: ev.recurringEventId || null,
    // Present only on the recurring series master, not on instances.
    recurrence: ev.recurrence || null,
    status: ev.status,
    htmlLink: ev.htmlLink || null,
  };
}

/**
 * List events for one calendar within [timeMin, timeMax) (timeMax is
 * exclusive per the Calendar API — callers building an "inclusive end date"
 * range, see lib/dateRanges.js, must pass the start of the following day).
 *
 * singleEvents=true expands recurring events into individual occurrences
 * and resolves DST transitions — Google's API does the RRULE/timezone math,
 * so this module doesn't reimplement recurrence expansion.
 */
export async function listEvents(calendarId, { timeMin, timeMax, timeZone, query } = {}) {
  const events = [];
  let pageToken;
  do {
    const data = await calendarRequest(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      timeMin,
      timeMax,
      timeZone,
      q: query,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
      pageToken,
      showDeleted: false,
    });
    for (const ev of data.items || []) {
      if (ev.status === 'cancelled') continue;
      events.push(normalizeEvent(ev, calendarId));
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return events;
}

/**
 * Fetch events across multiple calendars and merge them, sorted by start
 * time. A failure on one calendar doesn't block the others — failures are
 * returned separately so the UI can surface which calendar(s) had trouble.
 */
export async function listEventsForCalendars(calendarIds, options) {
  const errors = [];
  const results = await Promise.all(calendarIds.map(async (id) => {
    try {
      return await listEvents(id, options);
    } catch (e) {
      errors.push({ calendarId: id, message: e.message });
      return [];
    }
  }));
  const events = results.flat().sort((a, b) => new Date(a.start) - new Date(b.start));
  return { events, errors };
}
