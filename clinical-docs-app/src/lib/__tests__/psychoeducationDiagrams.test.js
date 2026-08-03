import { describe, it, expect } from 'vitest';
import { matchDiagrams, PSYCHOEDUCATION_DIAGRAMS } from '../psychoeducationDiagrams';

describe('matchDiagrams', () => {
  it('returns an empty array when no keywords match', () => {
    expect(matchDiagrams('Patient reports improved mood.')).toEqual([]);
  });

  it('matches a diagram whose keyword appears in the text', () => {
    const result = matchDiagrams('We discussed sleep hygiene strategies.');
    expect(result.map(d => d.id)).toEqual(['sleep_hygiene']);
  });

  it('is case-insensitive', () => {
    const result = matchDiagrams('SLEEP HYGIENE was reviewed.');
    expect(result.map(d => d.id)).toEqual(['sleep_hygiene']);
  });

  it('can match more than one diagram', () => {
    const text = 'Reviewed sleep hygiene and the daily medication schedule.';
    const result = matchDiagrams(text);
    expect(result.map(d => d.id).sort()).toEqual(['medication_schedule', 'sleep_hygiene']);
  });

  it('caps results at `max`', () => {
    const text = 'sleep hygiene, cognitive restructuring, medication schedule all discussed.';
    expect(matchDiagrams(text, 1)).toHaveLength(1);
    expect(matchDiagrams(text, 2)).toHaveLength(2);
  });

  it('every diagram has a non-empty id, title, keywords, and svg', () => {
    for (const d of PSYCHOEDUCATION_DIAGRAMS) {
      expect(d.id).toBeTruthy();
      expect(d.title).toBeTruthy();
      expect(d.keywords.length).toBeGreaterThan(0);
      expect(d.svg).toContain('<svg');
    }
  });
});
