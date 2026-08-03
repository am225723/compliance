import { describe, it, expect } from 'vitest';
import { extractDateFromFileName, extractLatestDateFromFileNames } from '../dateExtraction';

describe('extractDateFromFileName', () => {
  it('parses ISO dates with dashes, underscores, and dots', () => {
    expect(extractDateFromFileName('Session_2026-07-15.pdf')).toBe('2026-07-15');
    expect(extractDateFromFileName('Session_2026_07_15.pdf')).toBe('2026-07-15');
    expect(extractDateFromFileName('Session.2026.07.15.pdf')).toBe('2026-07-15');
  });

  it('parses compact ISO dates', () => {
    expect(extractDateFromFileName('Notes_20260715.docx')).toBe('2026-07-15');
  });

  it('parses US MM-DD-YYYY dates', () => {
    expect(extractDateFromFileName('07-15-2026 session notes.pdf')).toBe('2026-07-15');
    expect(extractDateFromFileName('7.15.2026 notes.pdf')).toBe('2026-07-15');
  });

  it('parses US MM-DD-YY dates with a 2-digit year', () => {
    expect(extractDateFromFileName('07-15-26 notes.pdf')).toBe('2026-07-15');
  });

  it('parses month-name dates in either order', () => {
    expect(extractDateFromFileName('July 15 2026 session.pdf')).toBe('2026-07-15');
    expect(extractDateFromFileName('Jul-15-2026.pdf')).toBe('2026-07-15');
    expect(extractDateFromFileName('15 July 2026.pdf')).toBe('2026-07-15');
    expect(extractDateFromFileName('July 15th, 2026.pdf')).toBe('2026-07-15');
  });

  it('returns null when no date is present', () => {
    expect(extractDateFromFileName('Intake Packet.pdf')).toBeNull();
    expect(extractDateFromFileName('')).toBeNull();
    expect(extractDateFromFileName(undefined)).toBeNull();
  });

  it('rejects an out-of-range calendar date', () => {
    expect(extractDateFromFileName('2026-13-40.pdf')).toBeNull();
  });
});

describe('extractLatestDateFromFileNames', () => {
  it('picks the most recent date among several files', () => {
    const names = ['2026-06-01 intake.pdf', '2026-07-15 session.pdf', '2026-06-20 followup.pdf'];
    expect(extractLatestDateFromFileNames(names)).toBe('2026-07-15');
  });

  it('ignores files with no date and still returns the best match', () => {
    const names = ['cover sheet.pdf', '2026-07-15 session.pdf', 'consent form.pdf'];
    expect(extractLatestDateFromFileNames(names)).toBe('2026-07-15');
  });

  it('returns null when nothing is dated', () => {
    expect(extractLatestDateFromFileNames(['cover sheet.pdf', 'consent form.pdf'])).toBeNull();
  });

  it('returns null for an empty or missing list', () => {
    expect(extractLatestDateFromFileNames([])).toBeNull();
    expect(extractLatestDateFromFileNames(undefined)).toBeNull();
  });
});
