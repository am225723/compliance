import { describe, it, expect } from 'vitest';
import { matchPatientFolders, classifyMatch } from '../patientMatching';

const FOLDERS = [
  { id: '1', name: 'John Smith' },
  { id: '2', name: 'Johnny Appleseed' },
  { id: '3', name: 'Jane Doe' },
  { id: '4', name: 'Robert Johnson' },
];

describe('matchPatientFolders', () => {
  it('finds a single unambiguous match', () => {
    const matches = matchPatientFolders('Jane Doe', FOLDERS);
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('3');
  });

  it('is case-insensitive', () => {
    const matches = matchPatientFolders('jane doe', FOLDERS);
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('3');
  });

  it('matches bidirectionally (folder name is a substring of the input)', () => {
    const matches = matchPatientFolders('Jane Doe (Telehealth)', FOLDERS);
    expect(matches.map((m) => m.id)).toEqual(['3']);
  });

  it('flags an ambiguous match when multiple folders could apply', () => {
    // "John" is a substring of "John Smith", "Johnny Appleseed", and even
    // "Robert Johnson" — a good demonstration of why ambiguous substring
    // matches always need a human to pick, never an automatic guess.
    const matches = matchPatientFolders('John', FOLDERS);
    expect(matches.map((m) => m.id).sort()).toEqual(['1', '2', '4']);
    expect(classifyMatch(matches)).toBe('ambiguous');
  });

  it('returns no matches for an unknown name', () => {
    const matches = matchPatientFolders('Nobody Here', FOLDERS);
    expect(matches).toHaveLength(0);
    expect(classifyMatch(matches)).toBe('not_found');
  });

  it('returns no matches for an empty/whitespace name', () => {
    expect(matchPatientFolders('', FOLDERS)).toHaveLength(0);
    expect(matchPatientFolders('   ', FOLDERS)).toHaveLength(0);
  });

  it('classifies a single match as matched', () => {
    const matches = matchPatientFolders('Robert Johnson', FOLDERS);
    expect(classifyMatch(matches)).toBe('matched');
  });
});
