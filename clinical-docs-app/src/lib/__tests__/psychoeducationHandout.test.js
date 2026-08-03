import { describe, it, expect } from 'vitest';
import { buildHandoutHtml } from '../psychoeducationHandout';

describe('buildHandoutHtml', () => {
  it('includes the section html and a patient name header', () => {
    const html = buildHandoutHtml({
      sectionHtml: '<div>Some psychoeducation content</div>',
      sectionText: 'Some psychoeducation content',
      patientName: 'John Smith',
    });
    expect(html).toContain('Some psychoeducation content');
    expect(html).toContain('Prepared for John Smith');
    expect(html).toContain('Client-Facing Psychoeducation');
  });

  it('omits the patient line when no patient name is given', () => {
    const html = buildHandoutHtml({ sectionHtml: '<div>x</div>', sectionText: 'x' });
    expect(html).not.toContain('Prepared for');
  });

  it('embeds a matched diagram when the section text has a matching keyword', () => {
    const html = buildHandoutHtml({
      sectionHtml: '<div>Discussed sleep hygiene tonight.</div>',
      sectionText: 'Discussed sleep hygiene tonight.',
    });
    expect(html).toContain('Sleep Hygiene Checklist');
    expect(html).toContain('<svg');
  });

  it('embeds no diagram when nothing matches', () => {
    const html = buildHandoutHtml({ sectionHtml: '<div>General wellness notes.</div>', sectionText: 'General wellness notes.' });
    expect(html).not.toContain('<svg');
  });
});
