import { describe, it, expect } from 'vitest';
import { buildFileName, computeOutputFileNameBase, planPatientOutputs } from '../documentPipeline';

const namingConvention = {
  treatmentPlan: '[LastName]_[Date]_TreatmentPlan',
  darp:          '[LastName]_[Date]_DARP',
  preIntake:     '[LastName]_[Date]_PreIntake',
  followUp:      '[LastName]_[Date]_FollowUp',
};

describe('buildFileName', () => {
  it('applies the configured template for a document type', () => {
    expect(buildFileName(namingConvention, 'session_note', 'Smith', '20260115')).toBe('Smith_20260115_DARP');
  });

  it('falls back to a generic template when none is configured', () => {
    expect(buildFileName({}, 'session_note', 'Smith', '20260115')).toBe('Smith_20260115_session_note');
  });
});

describe('computeOutputFileNameBase', () => {
  it('uses the last name and compacts a given ISO date', () => {
    expect(computeOutputFileNameBase(namingConvention, 'treatment_plan', 'John Smith', '2026-01-15'))
      .toBe('Smith_20260115_TreatmentPlan');
  });

  it("falls back to today's date when no date is given", () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    expect(computeOutputFileNameBase(namingConvention, 'treatment_plan', 'John Smith', null))
      .toBe(`Smith_${today}_TreatmentPlan`);
  });

  it('appends a disambiguating suffix when given one', () => {
    expect(computeOutputFileNameBase(namingConvention, 'session_note', 'John Smith', '2026-01-15', '-2'))
      .toBe('Smith_20260115_DARP-2');
  });
});

function patientWithFiles(files, selectedFileIds) {
  return {
    name: 'John Smith',
    files,
    selectedFileIds: selectedFileIds ?? files.map(f => f.id),
  };
}

describe('planPatientOutputs — session_note', () => {
  it('produces one DARP note per selected Zoom/Gemini session file', () => {
    const files = [
      { id: 'zoom1', name: 'Zoom Note 2026-01-15.pdf' },
      { id: 'zoom2', name: 'Zoom Note 2026-02-01.pdf' },
    ];
    const outputs = planPatientOutputs(patientWithFiles(files), 'session_note');
    expect(outputs).toHaveLength(2);
    expect(outputs[0].sourceFiles.map(f => f.id)).toEqual(['zoom1']);
    expect(outputs[0].dateForFilename).toBe('2026-01-15');
    expect(outputs[1].sourceFiles.map(f => f.id)).toEqual(['zoom2']);
    expect(outputs[1].dateForFilename).toBe('2026-02-01');
    expect(outputs.every(o => o.docTypeKey === 'session_note')).toBe(true);
    expect(outputs.every(o => !o.isBootstrap && !o.dependsOnKey)).toBe(true);
  });

  it('includes non-session-source selected files as shared context on every note', () => {
    const files = [
      { id: 'zoom1', name: 'Zoom Note 2026-01-15.pdf' },
      { id: 'tp', name: 'Treatment Plan.pdf' },
    ];
    const outputs = planPatientOutputs(patientWithFiles(files), 'session_note');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].sourceFiles.map(f => f.id).sort()).toEqual(['tp', 'zoom1']);
  });

  it('falls back to a single combined note when no session-source file is selected', () => {
    const files = [{ id: 'transcript', name: 'Chart Note.pdf' }];
    const outputs = planPatientOutputs(patientWithFiles(files), 'session_note');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].label).toBe('DARP Progress Note');
    expect(outputs[0].sourceFiles.map(f => f.id)).toEqual(['transcript']);
  });

  it('respects a deselected (unchecked) session-source file', () => {
    const files = [
      { id: 'zoom1', name: 'Zoom Note 2026-01-15.pdf' },
      { id: 'zoom2', name: 'Zoom Note 2026-02-01.pdf' },
    ];
    const outputs = planPatientOutputs(patientWithFiles(files, ['zoom1']), 'session_note');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].sourceFiles.map(f => f.id)).toEqual(['zoom1']);
  });

  it('gives same-dated (or both undated) session files distinct dedupe suffixes so filenames never collide', () => {
    const files = [
      { id: 'zoomA', name: 'Zoom Note 2026-01-15 A.pdf' },
      { id: 'zoomB', name: 'Zoom Note 2026-01-15 B.pdf' },
    ];
    const outputs = planPatientOutputs(patientWithFiles(files), 'session_note');
    expect(outputs).toHaveLength(2);
    expect(outputs[0].dateForFilename).toBe(outputs[1].dateForFilename); // same extracted date
    expect(outputs[0].dedupeSuffix).not.toBe(outputs[1].dedupeSuffix);

    const namesA = computeOutputFileNameBase(namingConvention, outputs[0].docTypeKey, outputs[0].patientName, outputs[0].dateForFilename, outputs[0].dedupeSuffix);
    const namesB = computeOutputFileNameBase(namingConvention, outputs[1].docTypeKey, outputs[1].patientName, outputs[1].dateForFilename, outputs[1].dedupeSuffix);
    expect(namesA).not.toBe(namesB);
  });

  it('leaves the dedupe suffix empty when there is only one session file', () => {
    const files = [{ id: 'zoom1', name: 'Zoom Note 2026-01-15.pdf' }];
    const outputs = planPatientOutputs(patientWithFiles(files), 'session_note');
    expect(outputs[0].dedupeSuffix).toBe('');
  });

  it('uses the configured session_source rule patterns from Settings, when customized', () => {
    const files = [{ id: 'custom1', name: 'MyCustomTranscriptTool 2026-01-15.pdf' }];
    const settings = {
      sourceFiles: {
        session_note: [
          { id: 'session_source', enabled: true, patterns: ['mycustomtranscripttool'] },
        ],
      },
    };
    const withoutCustomPatterns = planPatientOutputs(patientWithFiles(files), 'session_note');
    expect(withoutCustomPatterns[0].label).toBe('DARP Progress Note'); // falls back to the single-combined-note path — pattern doesn't match the default list

    const withCustomPatterns = planPatientOutputs(patientWithFiles(files), 'session_note', settings);
    expect(withCustomPatterns).toHaveLength(1);
    expect(withCustomPatterns[0].sourceFiles.map(f => f.id)).toEqual(['custom1']);
    expect(withCustomPatterns[0].dateForFilename).toBe('2026-01-15'); // only reachable via the per-session-file planning path
  });
});

describe('planPatientOutputs — treatment_plan', () => {
  it('bootstraps a First Session Note from the oldest session-source file, ahead of the plan', () => {
    const files = [
      { id: 'intake', name: 'Intake Form.pdf' },
      { id: 'zoom2', name: 'Zoom Note 2026-02-01.pdf' },
      { id: 'zoom1', name: 'Zoom Note 2026-01-15.pdf' },
    ];
    const outputs = planPatientOutputs(patientWithFiles(files, ['intake']), 'treatment_plan');
    expect(outputs).toHaveLength(2);

    const [bootstrap, plan] = outputs;
    expect(bootstrap.isBootstrap).toBe(true);
    expect(bootstrap.docTypeKey).toBe('session_note');
    expect(bootstrap.sourceFiles.map(f => f.id)).toEqual(['zoom1']); // oldest, not zoom2
    expect(bootstrap.dateForFilename).toBe('2026-01-15');

    expect(plan.docTypeKey).toBe('treatment_plan');
    expect(plan.dependsOnKey).toBe(bootstrap.key);
    expect(plan.sourceFiles.map(f => f.id)).toEqual(['intake']); // treatment plan's own selected sources, unaffected
  });

  it('finds the oldest session-source file regardless of selectedFileIds (not gated like session_note mode)', () => {
    const files = [
      { id: 'intake', name: 'Intake Form.pdf' },
      { id: 'zoom1', name: 'Zoom Note 2026-01-15.pdf' },
    ];
    // Only 'intake' is selected — treatment_plan's default rules don't preselect Zoom notes.
    const outputs = planPatientOutputs(patientWithFiles(files, ['intake']), 'treatment_plan');
    expect(outputs).toHaveLength(2);
    expect(outputs[0].sourceFiles.map(f => f.id)).toEqual(['zoom1']);
  });

  it('produces just the Treatment Plan when no session-source file exists', () => {
    const files = [{ id: 'intake', name: 'Intake Form.pdf' }];
    const outputs = planPatientOutputs(patientWithFiles(files), 'treatment_plan');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].docTypeKey).toBe('treatment_plan');
    expect(outputs[0].dependsOnKey).toBeNull();
  });
});

describe('planPatientOutputs — pre_intake / follow_up', () => {
  it('returns a single output using the selected files, unchanged from before', () => {
    const files = [{ id: 'a', name: 'Intake Form.pdf' }];
    const outputs = planPatientOutputs(patientWithFiles(files), 'pre_intake');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].docTypeKey).toBe('pre_intake');
    expect(outputs[0].sourceFiles.map(f => f.id)).toEqual(['a']);
  });
});
