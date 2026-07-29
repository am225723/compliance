import { describe, it, expect } from 'vitest';
import {
  fileMatchesPattern, getSourceRules, resolveSourceFiles, validateSelectedSourceFiles,
} from '../sourceFileSelection';

describe('fileMatchesPattern', () => {
  it('ignores case, extension, punctuation, underscores, and hyphens', () => {
    expect(fileMatchesPattern('Zoom_Note-2024.pdf', 'zoom note')).toBe(true);
    expect(fileMatchesPattern('ZOOMNOTE.docx', 'zoomnote')).toBe(true);
    expect(fileMatchesPattern('pre-intake_form.pdf', 'pre intake')).toBe(true);
  });

  it('matches regardless of which separator form the file vs. the pattern use', () => {
    // Underscore/hyphen in the file name vs. no separator in the pattern.
    expect(fileMatchesPattern('Zoom_Note-2024.pdf', 'zoomnote')).toBe(true);
    // No separator in the file name vs. a space-separated pattern.
    expect(fileMatchesPattern('ZOOMNOTE.pdf', 'zoom note')).toBe(true);
  });

  it('is a substring match, not exact', () => {
    expect(fileMatchesPattern('Smith Session Note Jan 2026.pdf', 'session note')).toBe(true);
  });

  it('returns false when the pattern does not appear', () => {
    expect(fileMatchesPattern('Insurance Card.pdf', 'zoom note')).toBe(false);
  });

  it('returns false for an empty pattern', () => {
    expect(fileMatchesPattern('anything.pdf', '')).toBe(false);
  });
});

describe('getSourceRules', () => {
  it('filters out disabled rules and trims patterns', () => {
    const settings = {
      sourceFiles: {
        session_note: [
          { id: 'a', enabled: true, patterns: [' zoom note ', 'transcript'] },
          { id: 'b', enabled: false, patterns: ['treatment plan'] },
        ],
      },
    };
    const rules = getSourceRules(settings, 'session_note');
    expect(rules).toHaveLength(1);
    expect(rules[0].patterns).toEqual(['zoom note', 'transcript']);
  });

  it('returns an empty array when no rules are configured', () => {
    expect(getSourceRules({}, 'session_note')).toEqual([]);
  });
});

describe('resolveSourceFiles', () => {
  const files = [
    { id: 'f1', name: 'Zoom Note Jan.pdf' },
    { id: 'f2', name: 'Insurance Card.pdf' },
  ];

  it('preselects every file when there are no rules', () => {
    const result = resolveSourceFiles(files, []);
    expect(result.selectedFileIds.sort()).toEqual(['f1', 'f2']);
    expect(result.missingRequired).toEqual([]);
  });

  it('preselects only files matching an enabled rule', () => {
    const rules = [{ id: 'r1', label: 'Zoom note', required: false, patterns: ['zoom note'] }];
    const result = resolveSourceFiles(files, rules);
    expect(result.selectedFileIds).toEqual(['f1']);
    expect(result.missingOptional).toHaveLength(0);
  });

  it('flags a required rule with no matches as missingRequired', () => {
    const rules = [{ id: 'r1', label: 'Treatment Plan', required: true, patterns: ['treatment plan'] }];
    const result = resolveSourceFiles(files, rules);
    expect(result.selectedFileIds).toEqual([]);
    expect(result.missingRequired).toHaveLength(1);
    expect(result.missingRequired[0].rule.label).toBe('Treatment Plan');
  });

  it('flags an optional rule with no matches as missingOptional, not missingRequired', () => {
    const rules = [{ id: 'r1', label: 'Assessment', required: false, patterns: ['assessment'] }];
    const result = resolveSourceFiles(files, rules);
    expect(result.missingRequired).toHaveLength(0);
    expect(result.missingOptional).toHaveLength(1);
  });
});

describe('validateSelectedSourceFiles', () => {
  const files = [
    { id: 'f1', name: 'Zoom Note Jan.pdf' },
    { id: 'f2', name: 'Treatment Plan.pdf' },
  ];

  it('only counts files present in selectedFileIds', () => {
    const rules = [{ id: 'r1', label: 'Zoom note', required: true, patterns: ['zoom note'] }];
    const result = validateSelectedSourceFiles(files, ['f1'], rules);
    expect(result.selectedFiles.map(f => f.id)).toEqual(['f1']);
    expect(result.missingRequired).toHaveLength(0);
  });

  it('reports missingRequired when the required file was deselected', () => {
    const rules = [{ id: 'r1', label: 'Treatment Plan', required: true, patterns: ['treatment plan'] }];
    const result = validateSelectedSourceFiles(files, ['f1'], rules);
    expect(result.missingRequired).toHaveLength(1);
    expect(result.missingRequired[0].rule.label).toBe('Treatment Plan');
  });
});
