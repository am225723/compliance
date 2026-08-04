import { describe, it, expect } from 'vitest';
import { diffWords, diffDocumentVersions } from '../textDiff';

describe('diffWords', () => {
  it('returns a single unchanged segment for identical text', () => {
    const segments = diffWords('the quick fox', 'the quick fox');
    expect(segments).toEqual([{ value: 'the quick fox', added: false, removed: false }]);
  });

  it('detects an added word', () => {
    const segments = diffWords('the fox', 'the quick fox');
    expect(segments.some(s => s.added && s.value.includes('quick'))).toBe(true);
    expect(segments.some(s => s.removed)).toBe(false);
  });

  it('detects a removed word', () => {
    const segments = diffWords('the quick fox', 'the fox');
    expect(segments.some(s => s.removed && s.value.includes('quick'))).toBe(true);
    expect(segments.some(s => s.added)).toBe(false);
  });

  it('detects a replaced word as a removal + addition', () => {
    const segments = diffWords('patient is stable', 'patient is improving');
    expect(segments.some(s => s.removed && s.value.includes('stable'))).toBe(true);
    expect(segments.some(s => s.added && s.value.includes('improving'))).toBe(true);
  });

  it('handles empty inputs without throwing', () => {
    expect(diffWords('', '')).toEqual([]);
    expect(diffWords('', 'hello')).toEqual([{ value: 'hello', added: true, removed: false }]);
    expect(diffWords('hello', '')).toEqual([{ value: 'hello', added: false, removed: true }]);
    expect(diffWords(null, undefined)).toEqual([]);
  });

  it('bails out with null instead of hanging on an oversized pair', () => {
    const big = Array.from({ length: 3000 }, (_, i) => `word${i}`).join(' ');
    expect(diffWords(big, big + ' extra')).toBeNull();
  });
});

describe('diffDocumentVersions', () => {
  it('strips HTML tags before diffing', () => {
    const segments = diffDocumentVersions('<p>Patient is <b>stable</b>.</p>', '<p>Patient is <b>improving</b>.</p>');
    expect(segments.some(s => s.removed && s.value.includes('stable'))).toBe(true);
    expect(segments.some(s => s.added && s.value.includes('improving'))).toBe(true);
    expect(segments.every(s => !s.value.includes('<'))).toBe(true);
  });

  it('decodes common HTML entities', () => {
    const segments = diffDocumentVersions('<p>A &amp; B</p>', '<p>A &amp; B</p>');
    expect(segments).toEqual([{ value: 'A & B', added: false, removed: false }]);
  });
});
