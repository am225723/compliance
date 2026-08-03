import { describe, it, expect } from 'vitest';
import { validateCptClaim } from '../cptValidation';

describe('validateCptClaim', () => {
  it('accepts an empty claim (a fresh draft row) with no errors or warnings', () => {
    const { errors, warnings } = validateCptClaim([], null);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('accepts a lone E/M code with no errors or warnings', () => {
    const { errors, warnings } = validateCptClaim(['99214'], null);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('accepts a valid E/M + add-on combo with matching minutes', () => {
    const { errors, warnings } = validateCptClaim(['99214', '90836'], 45);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('accepts a valid crisis claim (90839 + 90840)', () => {
    const { errors } = validateCptClaim(['90839', '90840'], null);
    expect(errors).toHaveLength(0);
  });

  it('accepts a lone initial evaluation code', () => {
    const { errors, warnings } = validateCptClaim(['90792'], null);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('rejects a legacy/unknown CPT code', () => {
    const { errors } = validateCptClaim(['90791'], null);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('90791')]));
  });

  it('rejects more than one E/M code', () => {
    const { errors } = validateCptClaim(['99214', '99215'], null);
    expect(errors.some(e => e.includes('Only one E/M code'))).toBe(true);
  });

  it('rejects more than one psychotherapy add-on', () => {
    const { errors } = validateCptClaim(['99214', '90833', '90838'], null);
    expect(errors.some(e => e.includes('Only one psychotherapy add-on'))).toBe(true);
  });

  it('rejects an add-on with no E/M code', () => {
    const { errors } = validateCptClaim(['90836'], 45);
    expect(errors.some(e => e.includes('requires an E/M code'))).toBe(true);
  });

  it('rejects 90792 combined with an E/M code', () => {
    const { errors } = validateCptClaim(['90792', '99214'], null);
    expect(errors.some(e => e.includes('90792'))).toBe(true);
  });

  it('rejects 90840 without 90839', () => {
    const { errors } = validateCptClaim(['90840'], null);
    expect(errors.some(e => e.includes('90840 requires 90839'))).toBe(true);
  });

  it('warns (does not error) when a stand-alone therapy code is combined with an E/M code', () => {
    const { errors, warnings } = validateCptClaim(['99214', '90837'], 60);
    expect(errors).toHaveLength(0);
    expect(warnings.some(w => w.includes('stand-alone'))).toBe(true);
  });

  it('warns when minutes are missing for a timed add-on code', () => {
    const { errors, warnings } = validateCptClaim(['99214', '90833'], null);
    expect(errors).toHaveLength(0);
    expect(warnings.some(w => w.includes('No psychotherapy minutes'))).toBe(true);
  });

  it('warns when minutes fall outside the selected add-on\'s range', () => {
    const { warnings } = validateCptClaim(['99214', '90833'], 45); // 90833 expects 16-37
    expect(warnings.some(w => w.includes('outside'))).toBe(true);
  });

  it('accepts minutes at the lower boundary of a range', () => {
    const { warnings } = validateCptClaim(['99214', '90833'], 16);
    expect(warnings.some(w => w.includes('outside'))).toBe(false);
  });

  it('accepts minutes at the upper boundary of a range', () => {
    const { warnings } = validateCptClaim(['99214', '90833'], 37);
    expect(warnings.some(w => w.includes('outside'))).toBe(false);
  });

  it('accepts any minutes at or above the open-ended 90838 range (53+)', () => {
    const { warnings } = validateCptClaim(['99214', '90838'], 120);
    expect(warnings.some(w => w.includes('outside'))).toBe(false);
  });

  it('reports multiple errors at once', () => {
    const { errors } = validateCptClaim(['bogus', '99214', '99215'], null);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts minutes above 240 for the open-ended 90838 range (no artificial ceiling)', () => {
    const { errors, warnings } = validateCptClaim(['99214', '90838'], 300);
    expect(errors).toHaveLength(0);
    expect(warnings.some(w => w.includes('outside'))).toBe(false);
  });

  it('rejects crisis psychotherapy combined with an E/M code', () => {
    const { errors } = validateCptClaim(['99214', '90839'], null);
    expect(errors.some(e => e.includes('Crisis psychotherapy'))).toBe(true);
  });

  it('rejects 90840 combined with an E/M code even alongside its required 90839', () => {
    const { errors } = validateCptClaim(['99214', '90839', '90840'], null);
    expect(errors.some(e => e.includes('Crisis psychotherapy'))).toBe(true);
  });

  it('rejects 90785 (Interactive Complexity) with no other code in the claim', () => {
    const { errors } = validateCptClaim(['90785'], null);
    expect(errors.some(e => e.includes('90785') && e.includes('primary psychiatric service'))).toBe(true);
  });

  it('rejects 90785 with an E/M code but no psychotherapy code', () => {
    const { errors } = validateCptClaim(['99214', '90785'], null);
    expect(errors.some(e => e.includes('90785') && e.includes('also requires a psychotherapy code'))).toBe(true);
  });

  it('accepts 90785 with an E/M code plus a psychotherapy add-on', () => {
    const { errors } = validateCptClaim(['99214', '90836', '90785'], 45);
    expect(errors).toHaveLength(0);
  });

  it('accepts 90785 with a stand-alone psychotherapy code (no E/M)', () => {
    const { errors } = validateCptClaim(['90837', '90785'], 60);
    expect(errors).toHaveLength(0);
  });

  it('rejects 90785 combined with crisis psychotherapy', () => {
    const { errors } = validateCptClaim(['90839', '90785'], null);
    expect(errors.some(e => e.includes('90785') && e.includes('crisis psychotherapy'))).toBe(true);
  });

  it('rejects 90785 combined with family psychotherapy', () => {
    const { errors } = validateCptClaim(['90847', '90785'], null);
    expect(errors.some(e => e.includes('90785') && e.includes('family psychotherapy'))).toBe(true);
  });
});
