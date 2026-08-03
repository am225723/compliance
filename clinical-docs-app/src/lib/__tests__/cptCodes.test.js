import { describe, it, expect } from 'vitest';
import { suggestAddonForMinutes, suggestCptCodes } from '../cptCodes';

describe('suggestAddonForMinutes', () => {
  it('returns null when minutes is not given', () => {
    expect(suggestAddonForMinutes(null)).toBeNull();
  });

  it('picks the add-on whose range contains the minutes', () => {
    expect(suggestAddonForMinutes(20)).toBe('90833');
    expect(suggestAddonForMinutes(45)).toBe('90836');
    expect(suggestAddonForMinutes(60)).toBe('90838');
  });

  it('treats the open-ended 90838 range as covering anything 53+', () => {
    expect(suggestAddonForMinutes(300)).toBe('90838');
  });
});

describe('suggestCptCodes', () => {
  it('suggests E/M + an add-on for session_note, preferring E/M over 90792', () => {
    const codes = suggestCptCodes('session_note', 45);
    expect(codes).toEqual(['99214', '90836']);
    expect(codes).not.toContain('90792');
  });

  it('falls back to a default add-on for session_note when minutes are unknown', () => {
    expect(suggestCptCodes('session_note', null)).toEqual(['99214', '90836']);
  });

  it('suggests 90792 for pre_intake', () => {
    expect(suggestCptCodes('pre_intake')).toEqual(['90792']);
  });

  it('suggests an established E/M code for follow_up', () => {
    expect(suggestCptCodes('follow_up')).toEqual(['99213']);
  });

  it('suggests nothing for treatment_plan (no single code reliably fits)', () => {
    expect(suggestCptCodes('treatment_plan')).toEqual([]);
  });
});
