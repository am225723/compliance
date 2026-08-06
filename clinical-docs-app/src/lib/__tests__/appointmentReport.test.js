import { describe, it, expect } from 'vitest';
import { computeFirstVisitKeys, hasDarpNote } from '../appointmentReport';
import { buildExistingNoteIndex } from '../calendarDedup';

describe('computeFirstVisitKeys', () => {
  it('picks the earliest appointment per patient', () => {
    const rows = [
      { key: 'a', patientName: 'John Smith', start: '2026-01-10T10:00:00Z' },
      { key: 'b', patientName: 'John Smith', start: '2026-01-03T10:00:00Z' },
      { key: 'c', patientName: 'Jane Doe', start: '2026-01-05T10:00:00Z' },
    ];
    expect(computeFirstVisitKeys(rows)).toEqual(new Set(['b', 'c']));
  });

  it('ignores rows with no patient name or invalid dates', () => {
    const rows = [
      { key: 'a', patientName: '', start: '2026-01-10T10:00:00Z' },
      { key: 'b', patientName: 'John Smith', start: 'not-a-date' },
    ];
    expect(computeFirstVisitKeys(rows)).toEqual(new Set());
  });

  it('returns an empty set for no rows', () => {
    expect(computeFirstVisitKeys([])).toEqual(new Set());
    expect(computeFirstVisitKeys(undefined)).toEqual(new Set());
  });
});

describe('hasDarpNote', () => {
  it('finds a DARP note linked to the exact calendar occurrence', () => {
    const index = buildExistingNoteIndex([
      { calendar_id: 'cal1', calendar_event_id: 'evt1', calendar_occurrence_start: '2026-01-10T10:00:00Z', document_type: 'darp' },
    ]);
    expect(hasDarpNote(index, { calendarId: 'cal1', eventId: 'evt1', start: '2026-01-10T10:00:00Z' })).toBe(true);
  });

  it('returns false when no note is linked to that occurrence', () => {
    const index = buildExistingNoteIndex([]);
    expect(hasDarpNote(index, { calendarId: 'cal1', eventId: 'evt1', start: '2026-01-10T10:00:00Z' })).toBe(false);
  });

  it('does not match a different document type on the same occurrence', () => {
    const index = buildExistingNoteIndex([
      { calendar_id: 'cal1', calendar_event_id: 'evt1', calendar_occurrence_start: '2026-01-10T10:00:00Z', document_type: 'treatment_plan' },
    ]);
    expect(hasDarpNote(index, { calendarId: 'cal1', eventId: 'evt1', start: '2026-01-10T10:00:00Z' })).toBe(false);
  });
});
