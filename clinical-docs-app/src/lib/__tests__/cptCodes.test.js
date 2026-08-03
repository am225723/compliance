import { describe, it, expect } from 'vitest';
import { suggestAddonForMinutes, suggestCptCodes, suggestEmLevel } from '../cptCodes';

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

describe('suggestEmLevel', () => {
  it('defaults to 99214 when the note has no complexity signal', () => {
    expect(suggestEmLevel('<p>Patient seen for routine follow-up.</p>')).toBe('99214');
  });

  it('defaults to 99214 for empty/missing note text', () => {
    expect(suggestEmLevel('')).toBe('99214');
    expect(suggestEmLevel(null)).toBe('99214');
  });

  it('suggests 99215 when a high-complexity signal is documented', () => {
    expect(suggestEmLevel('<p>Patient reports suicidal ideation with a plan.</p>')).toBe('99215');
  });

  it('a single high-complexity signal outweighs low-complexity signals', () => {
    const html = '<p>Stable on current regimen. No new symptoms. Endorses passive suicidal ideation.</p>';
    expect(suggestEmLevel(html)).toBe('99215');
  });

  it('suggests 99213 when at least two low-complexity signals are documented', () => {
    const html = '<p>Stable on current regimen. No new symptoms. Continue current medications.</p>';
    expect(suggestEmLevel(html)).toBe('99213');
  });

  it('does not downgrade to 99213 on a single low-complexity signal alone', () => {
    expect(suggestEmLevel('<p>Stable on current regimen.</p>')).toBe('99214');
  });

  it('is case-insensitive and strips HTML tags before matching', () => {
    const html = '<div><span class="ai-prompt">STABLE ON CURRENT REGIMEN</span><p>NO NEW SYMPTOMS</p></div>';
    expect(suggestEmLevel(html)).toBe('99213');
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

  it('threads the note text through to the E/M level suggestion', () => {
    const html = '<p>Patient in acute crisis, hospitalization discussed.</p>';
    expect(suggestCptCodes('session_note', 45, html)).toEqual(['99215', '90836']);
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
