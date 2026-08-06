/**
 * Single source of truth for the 4 generatable clinical document types —
 * used by BatchProcessor, AutoPilot, and the Templates manager so the
 * static file name / canonical DB value can't drift out of sync again
 * (this previously caused a 404 on Pre-Intake: 'PreIntake.html' vs the
 * real file 'pre_intake.html').
 */
export const DOCUMENT_TYPES = [
  { key: 'treatment_plan', label: 'Treatment Plan',     file: 'treatment_plan.html' },
  { key: 'session_note',   label: 'DARP Progress Note', file: 'session_note.html'   },
  { key: 'pre_intake',     label: 'Pre-Intake Brief',   file: 'pre_intake.html'     },
  { key: 'follow_up',      label: 'Follow-Up Visit',    file: 'follow_up.html'      },
];

/** Canonical value stored in documents.document_type — 'session_note' the UI
 *  concept maps to 'darp' in the DB, matching supabase_schema.sql's documented
 *  contract (previously the raw template id was stored, silently diverging). */
export const CANONICAL_DOCUMENT_TYPE = {
  treatment_plan: 'treatment_plan',
  session_note:   'darp',
  pre_intake:     'pre_intake',
  follow_up:      'follow_up',
};

export function getDocumentTypeMeta(key) {
  return DOCUMENT_TYPES.find(t => t.key === key) || null;
}

/** Reverse of CANONICAL_DOCUMENT_TYPE — given a documents.document_type value
 *  ('darp', 'treatment_plan', …), find the docTypeKey the generation pipeline
 *  and settings.sourceFiles rules are keyed by ('session_note', …). */
export function docTypeKeyForCanonical(canonical) {
  return Object.keys(CANONICAL_DOCUMENT_TYPE).find(key => CANONICAL_DOCUMENT_TYPE[key] === canonical) || null;
}

/** Default Reports-page "Type of Service" for each generated document type —
 *  used to pre-fill the billing entry auto-created alongside a saved
 *  document. Values match ReportsPage's SERVICE_TYPES options exactly so the
 *  pre-filled dropdown shows a real selection rather than falling through to
 *  "— Select type —". */
export const DEFAULT_SERVICE_TYPE_BY_DOC_TYPE = {
  treatment_plan: 'Treatment Planning',
  session_note:   'Psychotherapy',
  pre_intake:     'Initial Intake',
  follow_up:      'Follow-Up Visit',
};
