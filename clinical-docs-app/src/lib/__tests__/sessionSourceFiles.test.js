import { describe, it, expect } from 'vitest';
import { isSessionSourceFile, getSessionSourceFiles } from '../sessionSourceFiles';

describe('isSessionSourceFile', () => {
  it('matches Zoom note file names', () => {
    expect(isSessionSourceFile('Zoom_Note-2026-01-15.pdf')).toBe(true);
  });

  it('matches Notes by Gemini file names', () => {
    expect(isSessionSourceFile('Notes by Gemini - Smith 2026-02-01.pdf')).toBe(true);
    expect(isSessionSourceFile('NotesByGemini_20260201.docx')).toBe(true);
  });

  it('does not match unrelated files', () => {
    expect(isSessionSourceFile('Insurance Card.pdf')).toBe(false);
    expect(isSessionSourceFile('Intake Form.pdf')).toBe(false);
  });
});

describe('getSessionSourceFiles', () => {
  it('filters to only session-source files', () => {
    const files = [
      { id: 'a', name: 'Insurance Card.pdf' },
      { id: 'b', name: 'Zoom Note 2026-01-15.pdf' },
      { id: 'c', name: 'Notes by Gemini 2026-02-01.pdf' },
    ];
    const result = getSessionSourceFiles(files);
    expect(result.map(f => f.id)).toEqual(['b', 'c']);
  });

  it('sorts oldest-dated file first', () => {
    const files = [
      { id: 'later', name: 'Zoom Note 2026-03-01.pdf' },
      { id: 'earlier', name: 'Zoom Note 2026-01-15.pdf' },
      { id: 'middle', name: 'Notes by Gemini 2026-02-01.pdf' },
    ];
    const result = getSessionSourceFiles(files);
    expect(result.map(f => f.id)).toEqual(['earlier', 'middle', 'later']);
  });

  it('annotates each file with its extracted date', () => {
    const files = [{ id: 'a', name: 'Zoom Note 2026-01-15.pdf' }];
    const [result] = getSessionSourceFiles(files);
    expect(result.extractedDate).toBe('2026-01-15');
  });

  it('sorts undated files after dated ones, by name', () => {
    const files = [
      { id: 'undated-z', name: 'Zoom Note Zebra.pdf' },
      { id: 'dated', name: 'Zoom Note 2026-01-15.pdf' },
      { id: 'undated-a', name: 'Zoom Note Alpha.pdf' },
    ];
    const result = getSessionSourceFiles(files);
    expect(result.map(f => f.id)).toEqual(['dated', 'undated-a', 'undated-z']);
  });

  it('returns an empty array when no session-source files are present', () => {
    const files = [{ id: 'a', name: 'Insurance Card.pdf' }];
    expect(getSessionSourceFiles(files)).toEqual([]);
  });
});
