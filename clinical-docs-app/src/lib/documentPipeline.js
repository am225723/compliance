/**
 * Shared document generation + save pipeline, used by both the manual
 * Batch Processor and the autonomous AutoPilot watcher so the two never
 * drift out of sync.
 */
import { downloadFileText, uploadFile } from './googleDrive';
import {
  buildTreatmentPlanPrompt, buildDARPPrompt, extractPdfText,
  generateClinicalDocument, htmlToPdfBlob,
} from './aiEngine';
import { applyNamingConvention } from './settings';
import { DOCUMENT_TYPES, CANONICAL_DOCUMENT_TYPE, DEFAULT_SERVICE_TYPE_BY_DOC_TYPE, getDocumentTypeMeta } from './documentTypes';
import { extractLatestDateFromFileNames } from './dateExtraction';
import { getSessionSourceFiles } from './sessionSourceFiles';

const NAMING_KEY = {
  treatment_plan: 'treatmentPlan',
  session_note:   'darp',
  pre_intake:     'preIntake',
  follow_up:      'followUp',
};

export function buildFileName(namingConvention, docTypeKey, lastName, dateStr) {
  const key = NAMING_KEY[docTypeKey] || docTypeKey;
  const template = namingConvention?.[key] || `[LastName]_[Date]_${docTypeKey}`;
  return applyNamingConvention(template, lastName, dateStr);
}

/** Compact YYYYMMDD form used in file names — `dateForFilename` is an ISO
 *  'YYYY-MM-DD' (from a source file name) or null to fall back to today. */
export function computeOutputFileNameBase(namingConvention, docTypeKey, patientName, dateForFilename) {
  const lastName = patientName.trim().split(/\s+/).pop() || patientName;
  const dateStr = (dateForFilename || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  return buildFileName(namingConvention, docTypeKey, lastName, dateStr);
}

/**
 * Expand one matched patient into the concrete list of documents a
 * generation run will actually produce for the selected document type:
 *
 *  - session_note: one DARP Progress Note per Zoom-note / Notes-by-Gemini
 *    source file found (each session gets its own note), falling back to a
 *    single combined note when no such file is present or all were
 *    deselected — matching prior single-note-per-patient behavior.
 *  - treatment_plan: when a Zoom-note / Notes-by-Gemini file exists anywhere
 *    in the folder, the oldest one first bootstraps a DARP Progress Note
 *    (Pass 1), which then feeds into the Treatment Plan as extra context
 *    alongside its normal configured sources (intake, assessment, etc.).
 *  - pre_intake / follow_up: unchanged, a single output from the patient's
 *    currently selected files.
 *
 * Each returned output is a *plan*, not a generated document — `key` is a
 * stable identifier used to track its generation/review/save status.
 */
export function planPatientOutputs(patient, docTypeKey) {
  const files = patient.files || [];
  const selectedIds = new Set(patient.selectedFileIds || []);
  const selectedFiles = files.filter(f => selectedIds.has(f.id));

  if (docTypeKey === 'session_note') {
    const sessionFiles = getSessionSourceFiles(files).filter(f => selectedIds.has(f.id));
    if (sessionFiles.length === 0) {
      return [{
        key: `${patient.name}::session_note`,
        patientName: patient.name, docTypeKey: 'session_note',
        label: 'DARP Progress Note',
        sourceFiles: selectedFiles,
        dateForFilename: null,
        isBootstrap: false, dependsOnKey: null,
      }];
    }
    const extrasBase = selectedFiles.filter(f => !sessionFiles.some(sf => sf.id === f.id));
    return sessionFiles.map((sf, i) => ({
      key: `${patient.name}::session_note::${sf.id}`,
      patientName: patient.name, docTypeKey: 'session_note',
      label: sessionFiles.length > 1
        ? `DARP Progress Note ${i + 1} of ${sessionFiles.length} — ${sf.name}`
        : 'DARP Progress Note',
      sourceFiles: [sf, ...extrasBase],
      dateForFilename: sf.extractedDate,
      isBootstrap: false, dependsOnKey: null,
    }));
  }

  if (docTypeKey === 'treatment_plan') {
    const sessionFiles = getSessionSourceFiles(files); // not gated by selectedFileIds — treatment_plan's own rules don't preselect these
    const outputs = [];
    let bootstrapKey = null;
    if (sessionFiles.length > 0) {
      const oldest = sessionFiles[0];
      bootstrapKey = `${patient.name}::session_note::bootstrap::${oldest.id}`;
      outputs.push({
        key: bootstrapKey,
        patientName: patient.name, docTypeKey: 'session_note',
        label: `First Session Note (auto-generated from ${oldest.name} for Treatment Plan context)`,
        sourceFiles: [oldest],
        dateForFilename: oldest.extractedDate,
        isBootstrap: true, dependsOnKey: null,
      });
    }
    outputs.push({
      key: `${patient.name}::treatment_plan`,
      patientName: patient.name, docTypeKey: 'treatment_plan',
      label: 'Treatment Plan',
      sourceFiles: selectedFiles,
      dateForFilename: null,
      isBootstrap: false, dependsOnKey: bootstrapKey,
    });
    return outputs;
  }

  const meta = getDocumentTypeMeta(docTypeKey);
  return [{
    key: `${patient.name}::${docTypeKey}`,
    patientName: patient.name, docTypeKey,
    label: meta?.label || docTypeKey,
    sourceFiles: selectedFiles,
    dateForFilename: null,
    isBootstrap: false, dependsOnKey: null,
  }];
}

// Rough expected output length per detail level, used only to drive a
// smooth in-flight progress bar while a document streams in — not an exact
// prediction. Capped short of 100% so the bar never claims "done" before the
// stream actually finishes.
const EXPECTED_CHARS_BY_DETAIL = {
  'Bulleted Summary': 2500,
  'Standard':          4500,
  'Highly Detailed':   7500,
};
const MAX_STREAMING_PERCENT = 96;

export function estimateGenerationPercent(detailLevel, charsSoFar) {
  const expected = EXPECTED_CHARS_BY_DETAIL[detailLevel] || EXPECTED_CHARS_BY_DETAIL.Standard;
  return Math.min(MAX_STREAMING_PERCENT, Math.round((charsSoFar / expected) * 100));
}

/**
 * Read source files for a patient into one combined text blob. When
 * `selectedFiles` is provided (Source File Selection feature), only those
 * files are read; otherwise every discovered file is read (prior behavior).
 */
export async function collectSourceText(patient, onLog, selectedFiles = null) {
  let sourceText = `PATIENT: ${patient.name}\n\n`;
  const sourceFileList = [];
  const filesToRead = Array.isArray(selectedFiles) ? selectedFiles : patient.files;
  for (const file of filesToRead) {
    try {
      onLog?.(`Reading: ${file.name}`, 'info');
      const content = await downloadFileText(file.id, file.mimeType);
      const text = content instanceof ArrayBuffer ? await extractPdfText(content) : content;
      sourceText += `\n--- ${file.name} ---\n${text}\n`;
      sourceFileList.push(file.name);
    } catch (e) {
      onLog?.(`Could not read ${file.name}: ${e.message}`, 'warn');
    }
  }
  return { sourceText, sourceFileList };
}

async function loadTemplateHtml(docTypeKey, getTemplateHtml) {
  const meta = getDocumentTypeMeta(docTypeKey);
  if (!meta) throw new Error(`Unknown document type: ${docTypeKey}`);
  const override = getTemplateHtml?.(docTypeKey);
  if (override) return override;
  const res = await fetch(`/templates/${meta.file}`);
  if (!res.ok) throw new Error(`Failed to load template ${meta.file} (${res.status})`);
  return res.text();
}

/**
 * Generate one document (in-memory only, not saved) for a patient + document
 * type. DARP notes automatically chain in the patient's most recently saved
 * Treatment Plan as Pass-1 context, when one exists. Treatment Plans can
 * optionally chain in a just-generated bootstrap DARP note (see
 * planPatientOutputs) as extra context alongside their normal sources.
 */
export async function generateDocumentForPatient({
  patient, docTypeKey, sourceText, systemPrompt, provider, keys, model,
  getTemplateHtml, fetchLatestDocument, onLog, onChunk, bootstrapNoteHtml = null,
}) {
  const meta = getDocumentTypeMeta(docTypeKey);
  if (!meta) throw new Error(`Unknown document type: ${docTypeKey}`);
  const templateHtml = await loadTemplateHtml(docTypeKey, getTemplateHtml);

  let userPrompt;
  if (docTypeKey === 'treatment_plan') {
    const effectiveSourceText = bootstrapNoteHtml
      ? `${sourceText}\n\n--- AUTO-GENERATED FIRST SESSION NOTE (for clinical context) ---\n${bootstrapNoteHtml}\n`
      : sourceText;
    userPrompt = buildTreatmentPlanPrompt(effectiveSourceText, templateHtml);
  } else if (docTypeKey === 'session_note') {
    let treatmentPlanHtml = '';
    const latestPlan = await fetchLatestDocument?.(patient.name, 'treatment_plan');
    if (latestPlan?.content_html) {
      treatmentPlanHtml = latestPlan.content_html;
      onLog?.(`Chained Pass 1: using saved Treatment Plan from ${new Date(latestPlan.created_at).toLocaleDateString()}`, 'info');
    } else {
      onLog?.(`No saved Treatment Plan found for ${patient.name} — generating DARP note without Pass-1 context.`, 'warn');
    }
    userPrompt = buildDARPPrompt(sourceText, treatmentPlanHtml, templateHtml);
  } else {
    userPrompt = sourceText + '\n\nGenerate a clinical document based on the above patient information using the provided template structure.';
  }

  const outputHtml = await generateClinicalDocument({ provider, keys, model, systemPrompt, userPrompt, onChunk });
  return { outputHtml, templateLabel: meta.label };
}

/** Upload a generated document to Drive (HTML and/or a real PDF) and save its record to Supabase. */
export async function saveGeneratedDocument({
  patient, docTypeKey, outputHtml, settings, provider, model, saveDocument, source = 'manual',
  calendarLink = null, // { calendarId, eventId, occurrenceStart, durationMinutes? } | null — set by Calendar Notes
  saveReport = null,   // optional — auto-creates a linked draft Reports row for billing/visit tracking
  fileNameBase = null, // precomputed via computeOutputFileNameBase — reused as-is so a previewed filename matches what's actually saved
  dateOfServiceOverride = null, // ISO 'YYYY-MM-DD' — e.g. the specific source file's extracted date for a per-session output
}) {
  const meta = getDocumentTypeMeta(docTypeKey);
  if (!meta) throw new Error(`Unknown document type: ${docTypeKey}`);

  const lastName = patient.name.trim().split(/\s+/).pop() || patient.name;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const fileName = fileNameBase || buildFileName(settings.namingConvention, docTypeKey, lastName, today);

  const wantsHtml = settings.outputFormat === 'HTML' || settings.outputFormat === 'Both';
  const wantsPdf  = settings.outputFormat === 'PDF'  || settings.outputFormat === 'Both';

  const savedOutputs = [];

  if (wantsHtml) {
    const file = await uploadFile(patient.folderId, `${fileName}.html`, outputHtml, 'text/html');
    savedOutputs.push({ name: `${fileName}.html`, id: file.id, link: file.webViewLink, type: meta.label });
  }
  if (wantsPdf) {
    const pdfBlob = await htmlToPdfBlob(outputHtml);
    const file = await uploadFile(patient.folderId, `${fileName}.pdf`, pdfBlob, 'application/pdf');
    savedOutputs.push({ name: `${fileName}.pdf`, id: file.id, link: file.webViewLink, type: `${meta.label} (PDF)` });
  }

  const driveLink = savedOutputs[0]?.link || null;
  const saved = await saveDocument({
    patient_name:   patient.name,
    document_type:  CANONICAL_DOCUMENT_TYPE[docTypeKey] || docTypeKey,
    content_html:   outputHtml,
    ai_provider:    provider,
    ai_model:       model || undefined,
    output_format:  settings.outputFormat,
    drive_file_url: driveLink,
    source,
    ...(calendarLink ? {
      calendar_id: calendarLink.calendarId,
      calendar_event_id: calendarLink.eventId,
      calendar_occurrence_start: calendarLink.occurrenceStart,
    } : {}),
  });

  if (!saved) {
    // The Drive upload(s) above already succeeded, but the Supabase insert
    // failed (e.g. blocked by the calendar-occurrence dedup constraint, or a
    // transient DB error) — treat this as a failure rather than resolving
    // silently, or callers will mark the item "done" with no DB record.
    throw new Error('Document uploaded to Drive but the database record could not be saved.');
  }

  if (saveReport) {
    // Best-effort: a draft billing row makes the Reports page useful without
    // extra clicks, but it's a convenience on top of the document that just
    // saved successfully — never let it fail the save the user is waiting on.
    try {
      // Prefer the actual session date over the date the document happened to
      // be generated: the linked calendar occurrence is authoritative when
      // present, otherwise fall back to a date found in the source file
      // names (patients' folders are typically named/dated per visit), and
      // only default to today as a last resort.
      const dateOfService = dateOfServiceOverride
        || (calendarLink?.occurrenceStart ? new Date(calendarLink.occurrenceStart).toISOString().slice(0, 10) : null)
        || extractLatestDateFromFileNames((patient.files || []).map(f => f.name))
        || new Date().toISOString().slice(0, 10);
      await saveReport({
        document_id: saved.id,
        patient_name: patient.name,
        type_of_service: DEFAULT_SERVICE_TYPE_BY_DOC_TYPE[docTypeKey] || null,
        date_of_service: dateOfService,
        psychotherapy_minutes: calendarLink?.durationMinutes ?? null,
      });
    } catch (e) {
      console.error('Auto-create report entry failed:', e);
    }
  }

  return { savedOutputs, saved };
}

export { DOCUMENT_TYPES };
