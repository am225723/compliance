/**
 * Single source of truth for the CPT codes a board-certified psychiatrist
 * bills through Headway — shared by the restricted Reports CPT picker
 * (ReportsPage.jsx) and the claim validator (cptValidation.js) so the two
 * can't drift onto different catalogs. Groups are ordered with the codes
 * used on the overwhelming majority of visits (E/M + psychotherapy add-on)
 * first; 90792 is scoped to new-patient intake only and should not be
 * treated as a default for follow-up visits.
 */
export const CPT_CODE_GROUPS = [
  {
    label: 'E/M — Established Patient (medication management)',
    codes: [
      { code: '99213', description: 'Established patient E/M — Low MDM' },
      { code: '99214', description: 'Established patient E/M — Moderate MDM' },
      { code: '99215', description: 'Established patient E/M — High MDM' },
    ],
  },
  {
    label: 'Psychotherapy Add-On (bill only with an E/M code)',
    codes: [
      { code: '90833', description: 'Add-on — 16–37 min psychotherapy' },
      { code: '90836', description: 'Add-on — 38–52 min psychotherapy' },
      { code: '90838', description: 'Add-on — 53+ min psychotherapy' },
    ],
  },
  {
    label: 'E/M — New Patient (medication management)',
    codes: [
      { code: '99203', description: 'New patient E/M — Low MDM' },
      { code: '99204', description: 'New patient E/M — Moderate MDM' },
      { code: '99205', description: 'New patient E/M — High MDM' },
    ],
  },
  {
    label: 'Stand-Alone Psychotherapy (no medication management)',
    codes: [
      { code: '90832', description: 'Psychotherapy — 16–37 min' },
      { code: '90834', description: 'Psychotherapy — 38–52 min' },
      { code: '90837', description: 'Psychotherapy — 53+ min' },
    ],
  },
  {
    label: 'Interactive Complexity',
    codes: [
      { code: '90785', description: 'Add-on for communication complexity (reported after the psychotherapy code)' },
    ],
  },
  {
    label: 'Crisis Psychotherapy',
    codes: [
      { code: '90839', description: 'First 60 min of crisis psychotherapy' },
      { code: '90840', description: 'Each additional 30 min' },
    ],
  },
  {
    label: 'Family Therapy',
    codes: [
      { code: '90846', description: 'Family psychotherapy without patient present' },
      { code: '90847', description: 'Family psychotherapy with patient present' },
      { code: '90849', description: 'Multiple-family group psychotherapy' },
    ],
  },
  {
    label: 'Group Therapy',
    codes: [
      { code: '90853', description: 'Group psychotherapy' },
    ],
  },
  {
    label: 'Initial Evaluation (new-patient intake only)',
    codes: [
      { code: '90792', description: 'Psychiatric diagnostic evaluation with medical services — do not combine with an E/M code on the same encounter' },
    ],
  },
];

export const CPT_CODE_LOOKUP = new Map(
  CPT_CODE_GROUPS.flatMap(g => g.codes).map(c => [c.code, c.description])
);

export const VALID_CPT_CODES = new Set(CPT_CODE_LOOKUP.keys());

export const EM_ESTABLISHED_CODES = ['99213', '99214', '99215'];
export const EM_NEW_CODES = ['99203', '99204', '99205'];
export const EM_CODES = [...EM_ESTABLISHED_CODES, ...EM_NEW_CODES];

/** Psychotherapy add-on codes (bill only alongside an E/M code) and their
 *  documented time range in minutes. 90838's range has no upper bound. */
export const ADDON_TIME_RANGES = {
  90833: [16, 37],
  90836: [38, 52],
  90838: [53, Infinity],
};
export const ADDON_CODES = Object.keys(ADDON_TIME_RANGES).map(String);

/** Stand-alone psychotherapy codes (no medication management) and their
 *  documented time range in minutes. */
export const STANDALONE_THERAPY_TIME_RANGES = {
  90832: [16, 37],
  90834: [38, 52],
  90837: [53, Infinity],
};
export const STANDALONE_THERAPY_CODES = Object.keys(STANDALONE_THERAPY_TIME_RANGES).map(String);

export const INITIAL_EVAL_CODE = '90792';
export const CRISIS_FIRST_CODE = '90839';
export const CRISIS_ADDITIONAL_CODE = '90840';
export const CRISIS_CODES = [CRISIS_FIRST_CODE, CRISIS_ADDITIONAL_CODE];
export const FAMILY_THERAPY_CODES = ['90846', '90847', '90849'];
export const INTERACTIVE_COMPLEXITY_CODE = '90785';

/** Add-on code whose documented time range contains `minutes`, or null if none fits (open-ended 90838 catches anything 53+). */
export function suggestAddonForMinutes(minutes) {
  if (minutes == null) return null;
  for (const [code, [min, max]] of Object.entries(ADDON_TIME_RANGES)) {
    if (minutes >= min && minutes <= max) return code;
  }
  return null;
}

/**
 * Best-guess starting CPT code(s) for a freshly auto-created draft Reports
 * row, keyed by the generated document's type — a convenience pre-fill the
 * clinician reviews and corrects, not a billing decision. Deliberately
 * conservative: prefers E/M + psychotherapy add-on over the intake-only
 * 90792 code for session notes, and leaves treatment_plan blank since there's
 * no single code that reliably fits (it's typically billed alongside
 * whichever E/M/evaluation visit produced it).
 */
export function suggestCptCodes(docTypeKey, minutes = null) {
  if (docTypeKey === 'session_note') {
    return ['99214', suggestAddonForMinutes(minutes) || '90836'];
  }
  if (docTypeKey === 'follow_up') {
    return ['99213'];
  }
  if (docTypeKey === 'pre_intake') {
    return [INITIAL_EVAL_CODE];
  }
  return [];
}
