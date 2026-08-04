import { describe, it, expect } from 'vitest';
import { assessReportReadiness, filterReportsNeedingAttention } from '../billingReadiness';

describe('assessReportReadiness', () => {
  it('flags a report with no CPT codes as incomplete/not ready', () => {
    const result = assessReportReadiness({ cpt_codes: [], psychotherapy_minutes: null });
    expect(result.incomplete).toBe(true);
    expect(result.ready).toBe(false);
  });

  it('flags a report with a cptValidation error as not ready', () => {
    const result = assessReportReadiness({ cpt_codes: ['99213', '99214'], psychotherapy_minutes: 45 });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.ready).toBe(false);
  });

  it('treats a clean, complete claim as ready even with warnings', () => {
    const result = assessReportReadiness({ cpt_codes: ['99214', '90836'], psychotherapy_minutes: null });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0); // missing minutes for 90836
    expect(result.ready).toBe(true);
  });

  it('is ready for a fully valid claim with no warnings', () => {
    const result = assessReportReadiness({ cpt_codes: ['99214', '90836'], psychotherapy_minutes: 50 });
    expect(result.ready).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

describe('filterReportsNeedingAttention', () => {
  it('returns only the reports that are not ready', () => {
    const reports = [
      { id: '1', cpt_codes: [], psychotherapy_minutes: null },
      { id: '2', cpt_codes: ['99214', '90836'], psychotherapy_minutes: 50 },
      { id: '3', cpt_codes: ['99213', '99214'], psychotherapy_minutes: null },
    ];
    expect(filterReportsNeedingAttention(reports).map(r => r.id)).toEqual(['1', '3']);
  });

  it('returns an empty array for null/undefined input', () => {
    expect(filterReportsNeedingAttention(null)).toEqual([]);
    expect(filterReportsNeedingAttention(undefined)).toEqual([]);
  });
});
