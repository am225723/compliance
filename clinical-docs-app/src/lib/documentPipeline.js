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
import { DOCUMENT_TYPES, CANONICAL_DOCUMENT_TYPE, getDocumentTypeMeta } from './documentTypes';

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

/** Read every source file for a patient into one combined text blob. */
export async function collectSourceText(patient, onLog) {
  let sourceText = `PATIENT: ${patient.name}\n\n`;
  const sourceFileList = [];
  for (const file of patient.files) {
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
 * Treatment Plan as Pass-1 context, when one exists.
 */
export async function generateDocumentForPatient({
  patient, docTypeKey, sourceText, systemPrompt, provider, keys, model,
  getTemplateHtml, fetchLatestDocument, onLog,
}) {
  const meta = getDocumentTypeMeta(docTypeKey);
  if (!meta) throw new Error(`Unknown document type: ${docTypeKey}`);
  const templateHtml = await loadTemplateHtml(docTypeKey, getTemplateHtml);

  let userPrompt;
  if (docTypeKey === 'treatment_plan') {
    userPrompt = buildTreatmentPlanPrompt(sourceText, templateHtml);
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

  const outputHtml = await generateClinicalDocument({ provider, keys, model, systemPrompt, userPrompt });
  return { outputHtml, templateLabel: meta.label };
}

/** Upload a generated document to Drive (HTML and/or a real PDF) and save its record to Supabase. */
export async function saveGeneratedDocument({
  patient, docTypeKey, outputHtml, settings, provider, model, saveDocument, source = 'manual',
  calendarLink = null, // { calendarId, eventId, occurrenceStart } | null — set by Calendar Notes
}) {
  const meta = getDocumentTypeMeta(docTypeKey);
  if (!meta) throw new Error(`Unknown document type: ${docTypeKey}`);

  const lastName = patient.name.trim().split(/\s+/).pop() || patient.name;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const fileName = buildFileName(settings.namingConvention, docTypeKey, lastName, today);

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

  return { savedOutputs, saved };
}

export { DOCUMENT_TYPES };
