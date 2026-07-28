/**
 * Existing-note (duplicate generation) detection for Calendar Notes.
 *
 * Timestamps round-trip through two different systems (the Calendar API's
 * RFC3339 strings going in, Postgres' timestamptz formatting coming back
 * out of Supabase) that don't necessarily render identical strings for the
 * same instant — so keys are always built from a normalized ISO timestamp,
 * never a raw string comparison, or a real duplicate could slip through.
 */

export function normalizeTimestamp(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

export function calendarOccurrenceKey(calendarId, eventId, occurrenceStart, documentType) {
  return [calendarId, eventId, normalizeTimestamp(occurrenceStart), documentType].join('|');
}

/** Build a lookup index from the rows returned by fetchExistingCalendarNotes(). */
export function buildExistingNoteIndex(existingNotes) {
  const index = new Map();
  for (const note of existingNotes || []) {
    const key = calendarOccurrenceKey(
      note.calendar_id, note.calendar_event_id, note.calendar_occurrence_start, note.document_type,
    );
    index.set(key, note);
  }
  return index;
}

/** Look up whether a note already exists for one (appointment occurrence, document type) pair. */
export function findExistingNote(index, { calendarId, eventId, occurrenceStart, documentType }) {
  return index.get(calendarOccurrenceKey(calendarId, eventId, occurrenceStart, documentType)) || null;
}
