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
