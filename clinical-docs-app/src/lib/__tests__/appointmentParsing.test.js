import { describe, it, expect } from 'vitest';
import { parseAppointmentDeterministic } from '../appointmentParsing';

describe('parseAppointmentDeterministic', () => {
  it('an alias match always wins, with high confidence and no review needed', () => {
    const result = parseAppointmentDeterministic(
      { title: 'jsmith - follow up', description: '' },
      { knownPatients: [], aliases: { jsmith: 'John Smith' } },
    );
    expect(result).toMatchObject({ name: 'John Smith', confidence: 'high', method: 'alias', needsReview: false });
  });

  it('a single known-patient mention in the title is high confidence, no review needed', () => {
    const result = parseAppointmentDeterministic(
      { title: 'John Smith - Follow Up', description: '' },
      { knownPatients: [{ id: '1', name: 'John Smith' }, { id: '2', name: 'Jane Doe' }] },
    );
    expect(result).toMatchObject({ name: 'John Smith', confidence: 'high', method: 'known-patient', needsReview: false });
  });

  it('falls back to the description when the title has no known-patient mention', () => {
    const result = parseAppointmentDeterministic(
      { title: 'Appointment', description: 'Follow-up for John Smith today' },
      { knownPatients: [{ id: '1', name: 'John Smith' }] },
    );
    expect(result).toMatchObject({ name: 'John Smith', confidence: 'high', needsReview: false });
  });

  it('matches on last name alone when it is specific enough (>= 4 chars)', () => {
    const result = parseAppointmentDeterministic(
      { title: 'Review labs for Montgomery', description: '' },
      { knownPatients: [{ id: '1', name: 'Elizabeth Montgomery' }] },
    );
    expect(result).toMatchObject({ name: 'Elizabeth Montgomery', confidence: 'high', needsReview: false });
  });

  it('flags ambiguity when more than one known patient could match, and requires review', () => {
    const result = parseAppointmentDeterministic(
      { title: 'Appt with John Smith and John Smithson', description: '' },
      { knownPatients: [{ id: '1', name: 'John Smith' }, { id: '2', name: 'John Smithson' }] },
    );
    expect(result.confidence).toBe('low');
    expect(result.needsReview).toBe(true);
    expect(result.name).toBeNull();
    expect(result.candidates.sort()).toEqual(['John Smith', 'John Smithson']);
  });

  it('regex-extracts a name from "Name - Type" titles when no known patient matches, and requires review', () => {
    const result = parseAppointmentDeterministic(
      { title: 'Jane Doe - Follow Up', description: '' },
      { knownPatients: [] },
    );
    expect(result).toMatchObject({ name: 'Jane Doe', confidence: 'medium', method: 'regex', needsReview: true });
  });

  it('regex-extracts a name from "Type - Name" titles, skipping the leading stopword phrase', () => {
    const result = parseAppointmentDeterministic(
      { title: 'Follow Up - John Smith', description: '' },
      { knownPatients: [] },
    );
    expect(result).toMatchObject({ name: 'John Smith', confidence: 'medium', needsReview: true });
  });

  it('regex-extracts a name after "w/" or "with"', () => {
    const result = parseAppointmentDeterministic(
      { title: 'Therapy Session w/ Robert Johnson', description: '' },
      { knownPatients: [] },
    );
    expect(result).toMatchObject({ name: 'Robert Johnson', confidence: 'medium', needsReview: true });
  });

  it('does not mistake a pure scheduling phrase for a name', () => {
    const result = parseAppointmentDeterministic(
      { title: 'Follow Up', description: '' },
      { knownPatients: [] },
    );
    expect(result).toMatchObject({ name: null, confidence: 'none', method: 'none', needsReview: true });
  });

  it('returns needsReview=true for every confidence level below high', () => {
    const none = parseAppointmentDeterministic({ title: 'Blocked', description: '' }, {});
    const medium = parseAppointmentDeterministic({ title: 'Jane Doe - Follow Up', description: '' }, {});
    expect(none.needsReview).toBe(true);
    expect(medium.needsReview).toBe(true);
  });
});
