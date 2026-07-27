import { describe, it, expect } from 'vitest';
import {
  normalizeTimestamp, calendarOccurrenceKey, buildExistingNoteIndex, findExistingNote,
} from '../calendarDedup';

describe('normalizeTimestamp', () => {
  it('produces the same canonical string for two different renderings of the same instant', () => {
    // A Calendar API RFC3339 string vs. how Postgres/PostgREST tends to render timestamptz.
    const a = normalizeTimestamp('2026-07-27T14:00:00.000Z');
    const b = normalizeTimestamp('2026-07-27T14:00:00+00:00');
    expect(a).toBe(b);
  });

  it('is empty for a missing value', () => {
    expect(normalizeTimestamp(null)).toBe('');
    expect(normalizeTimestamp(undefined)).toBe('');
  });
});

describe('duplicate note detection', () => {
  const existingNotes = [
    {
      calendar_id: 'cal-1', calendar_event_id: 'evt-1',
      calendar_occurrence_start: '2026-07-27T14:00:00+00:00', // Postgres-style rendering
      document_type: 'darp',
    },
  ];

  it('detects a duplicate even when the incoming timestamp string is formatted differently', () => {
    const index = buildExistingNoteIndex(existingNotes);
    const found = findExistingNote(index, {
      calendarId: 'cal-1', eventId: 'evt-1',
      occurrenceStart: '2026-07-27T14:00:00.000Z', // Calendar-API-style rendering, same instant
      documentType: 'darp',
    });
    expect(found).not.toBeNull();
  });

  it('does not flag a different document type for the same occurrence as a duplicate', () => {
    const index = buildExistingNoteIndex(existingNotes);
    const found = findExistingNote(index, {
      calendarId: 'cal-1', eventId: 'evt-1',
      occurrenceStart: '2026-07-27T14:00:00.000Z',
      documentType: 'treatment_plan',
    });
    expect(found).toBeNull();
  });

  it('does not flag a different occurrence of the same recurring event as a duplicate', () => {
    const index = buildExistingNoteIndex(existingNotes);
    const found = findExistingNote(index, {
      calendarId: 'cal-1', eventId: 'evt-1',
      occurrenceStart: '2026-08-03T14:00:00.000Z', // a week later
      documentType: 'darp',
    });
    expect(found).toBeNull();
  });

  it('does not cross-match a different calendar', () => {
    const index = buildExistingNoteIndex(existingNotes);
    const found = findExistingNote(index, {
      calendarId: 'cal-2', eventId: 'evt-1',
      occurrenceStart: '2026-07-27T14:00:00.000Z',
      documentType: 'darp',
    });
    expect(found).toBeNull();
  });

  it('calendarOccurrenceKey normalizes the timestamp segment', () => {
    const k1 = calendarOccurrenceKey('c', 'e', '2026-07-27T14:00:00.000Z', 'darp');
    const k2 = calendarOccurrenceKey('c', 'e', '2026-07-27T14:00:00+00:00', 'darp');
    expect(k1).toBe(k2);
  });
});
