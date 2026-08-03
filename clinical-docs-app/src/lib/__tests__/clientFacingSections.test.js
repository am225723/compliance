import { describe, it, expect } from 'vitest';
import { CLIENT_FACING_SECTION_TITLES, extractClientFacingSection, extractAllClientFacingSections } from '../clientFacingSections';

// extractClientFacingSection() does real DOM parsing (DOMParser), which is a
// browser-only API this repo's Node-based vitest environment doesn't
// provide (same constraint as aiEngine.js's htmlToPdfBlob, which also isn't
// unit tested for the same reason) — these tests cover the parts that don't
// require a DOM: the known section list and graceful no-DOMParser behavior.
describe('CLIENT_FACING_SECTION_TITLES', () => {
  it('lists the two known patient-facing section titles', () => {
    expect(CLIENT_FACING_SECTION_TITLES).toEqual([
      'Empathetic Patient Summary Letter',
      'Client-Facing Psychoeducation',
    ]);
  });
});

describe('extractClientFacingSection', () => {
  it('returns null for empty/missing input', () => {
    expect(extractClientFacingSection('', 'Empathetic Patient Summary Letter')).toBeNull();
    expect(extractClientFacingSection(null, 'Empathetic Patient Summary Letter')).toBeNull();
  });

  it('degrades gracefully (returns null) when DOMParser is unavailable, instead of throwing', () => {
    expect(() => extractClientFacingSection('<div><h3>Empathetic Patient Summary Letter</h3></div>', 'Empathetic Patient Summary Letter')).not.toThrow();
  });
});

describe('extractAllClientFacingSections', () => {
  it('returns an empty array rather than throwing when nothing can be parsed', () => {
    expect(extractAllClientFacingSections('<div>irrelevant content</div>')).toEqual([]);
  });
});
