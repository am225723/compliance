import { describe, it, expect } from 'vitest';
import { docTypeKeyForCanonical, CANONICAL_DOCUMENT_TYPE } from '../documentTypes';

describe('docTypeKeyForCanonical', () => {
  it('reverses every entry in CANONICAL_DOCUMENT_TYPE', () => {
    for (const [docTypeKey, canonical] of Object.entries(CANONICAL_DOCUMENT_TYPE)) {
      expect(docTypeKeyForCanonical(canonical)).toBe(docTypeKey);
    }
  });

  it('maps the DB value "darp" back to the "session_note" doc type key', () => {
    expect(docTypeKeyForCanonical('darp')).toBe('session_note');
  });

  it('returns null for an unknown canonical value', () => {
    expect(docTypeKeyForCanonical('not_a_real_type')).toBeNull();
  });
});
