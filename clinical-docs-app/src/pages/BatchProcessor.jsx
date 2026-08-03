import { useState, useRef, useEffect } from 'react';
import {
  ClipboardList, Search, CheckCircle2, AlertTriangle,
  Play, Loader2, FileText, FilePlus, SkipForward, Eye,
  FolderOpen, List, RefreshCw, XCircle, Info, Heart, Calendar,
  HelpCircle, Code, Save, History, Ban, AlertCircle
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import {
  findPatientFormsFolder, listSubfolders, listPatientFiles,
} from '../lib/googleDrive';
import { buildSystemPrompt, AI_PROVIDERS } from '../lib/aiEngine';
import { getProviderKeys, isProviderConfigured } from '../lib/settings';
import { DOCUMENT_TYPES, getDocumentTypeMeta } from '../lib/documentTypes';
import {
  collectSourceText, generateDocumentForPatient, saveGeneratedDocument, estimateGenerationPercent,
  planPatientOutputs, computeOutputFileNameBase,
} from '../lib/documentPipeline';
import { withRetry } from '../lib/retry';
import { matchPatientFolders, classifyMatch } from '../lib/patientMatching';
import { getSourceRules, resolveSourceFiles, validateSelectedSourceFiles } from '../lib/sourceFileSelection';
import {
  detectDuplicateSourceFiles, validateBatchBefore, generateBatchId,
  saveGenerationLog, saveGenerationError, completeGenerationLog,
} from '../lib/generationAudit';
import DeduplicationWarning from '../components/DeduplicationWarning';
import DocumentReviewQueue from '../components/DocumentReviewQueue';

const PHASE = {
  IDLE: 'idle', MATCHING: 'matching', PREVIEW: 'preview', CONFIRM: 'confirm',
  GENERATING: 'generating', REVIEW: 'review', SAVING: 'saving', DONE: 'done',
};

const BATCH_STORAGE_KEY = 'clinicaldocs_batch_inflight';

const TEMPLATE_ICONS = {
  treatment_plan: Heart,
  session_note:   ClipboardList,
  pre_intake:     FileText,
  follow_up:      Calendar,
};
const TEMPLATE_COLORS = {
  treatment_plan: 'from-blue-600 to-indigo-600',
  session_note:   'from-teal-600 to-emerald-600',
  pre_intake:     'from-violet-600 to-purple-600',
  follow_up:      'from-rose-600 to-pink-600',
};

function StatusBadge({ status }) {
  const map = {
    pending:    { color: 'bg-slate-700 text-slate-300',       label: 'Pending' },
    matched:    { color: 'bg-blue-500/20 text-blue-300',      label: 'Matched' },
    ambiguous:  { color: 'bg-amber-500/20 text-amber-300',    label: 'Needs Resolution' },
    not_found:  { color: 'bg-red-500/20 text-red-400',        label: 'Folder Not Found' },
    generating: { color: 'bg-violet-500/20 text-violet-300',  label: 'Generating…' },
    generated:  { color: 'bg-teal-500/20 text-teal-300',      label: 'Ready for Review' },
    saving:     { color: 'bg-blue-500/20 text-blue-300',      label: 'Saving to Drive…' },
    done:       { color: 'bg-emerald-500/20 text-emerald-300', label: 'Complete' },
    error:      { color: 'bg-red-500/20 text-red-400',        label: 'Error' },
    skipped:    { color: 'bg-slate-600/20 text-slate-400',    label: 'Skipped' },
    planned:    { color: 'bg-slate-700 text-slate-300',       label: 'Planned' },
  };
  const { color, label } = map[status] || map.pending;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>
      {(status === 'generating' || status === 'saving')
        ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
        : null}
      {label}
    </span>
  );
}

function normalizeResumedOutputs(list) {
  return (list || []).map(o => {
    // generatedOutput.html is deliberately never persisted (it's the full
    // clinical note — PHI at rest) — see the persistence effect below. Any
    // status implying in-memory content that isn't yet durably saved to
    // Drive/Supabase ('done') can't be trusted after a resume; demote it
    // back to 'planned' so it gets regenerated instead of reviewed/saved
    // with a missing body.
    if (o.status === 'generating' || o.status === 'generated' || o.status === 'saving') {
      return { ...o, status: 'planned', generatedOutput: null };
    }
    return o;
  });
}

function resumeStablePhase(storedPhase) {
  // Only DONE (everything already saved — nothing left that only lives in
  // memory) is safe to resume into directly. Every other phase, including
  // REVIEW, can involve generated content that was deliberately never
  // persisted, so drop back to PREVIEW and let files get re-verified and
  // regenerated rather than resuming into a plan with missing document bodies.
  if (storedPhase === PHASE.DONE || storedPhase === PHASE.IDLE) return storedPhase;
  return PHASE.PREVIEW;
}

export default function BatchProcessor() {
  const { settings, driveConnected, saveDocument, saveReport, getTemplateHtml, fetchLatestDocument, user, updateDocumentReview, regenerateDocument } = useApp();
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [singleClientMode, setSingleClientMode] = useState(false);
  const [batchInput, setBatchInput] = useState('');
  const [patients, setPatients] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [log, setLog] = useState([]);
  const [summary, setSummary] = useState(null);
  const [expandedFiles, setExpandedFiles] = useState({});
  const [previewMode, setPreviewMode] = useState({}); // { [name]: 'rendered' | 'raw' }
  const [resumeBanner, setResumeBanner] = useState(null);
  const [batchPreValidationErrors, setBatchPreValidationErrors] = useState([]);
  const [batchPreValidationWarnings, setBatchPreValidationWarnings] = useState([]);
  const [generationLogId, setGenerationLogId] = useState(null);
  const abortRef = useRef(false);
  const persistTimeoutRef = useRef(null);

  const [selectedTemplate, setSelectedTemplate] = useState('treatment_plan');
  const [progress, setProgress] = useState({ percent: 0, current: 0, total: 0, step: '' });

  function addLog(msg, type = 'info') {
    setLog(prev => [...prev, { msg, type, ts: new Date().toLocaleTimeString() }]);
  }

  function updatePatientByName(name, patch) {
    setPatients(prev => prev.map(p => p.name === name ? { ...p, ...patch } : p));
  }

  function updateOutputByKey(key, patch) {
    setOutputs(prev => prev.map(o => o.key === key ? { ...o, ...patch } : o));
  }

  function toggleOutputIncluded(key) {
    setOutputs(prev => prev.map(o => o.key === key ? { ...o, included: !o.included } : o));
  }

  function togglePatientSourceFile(patientName, fileId) {
    setPatients(prev => prev.map(patient => {
      if (patient.name !== patientName) return patient;
      const selected = new Set(patient.selectedFileIds || []);
      if (selected.has(fileId)) selected.delete(fileId); else selected.add(fileId);
      return { ...patient, selectedFileIds: [...selected] };
    }));
  }

  function applyConfiguredFileRules(patientName) {
    setPatients(prev => prev.map(patient => {
      if (patient.name !== patientName) return patient;
      const resolution = resolveSourceFiles(patient.files, getSourceRules(settings, selectedTemplate));
      return { ...patient, selectedFileIds: resolution.selectedFileIds, sourceRuleResults: resolution.ruleResults };
    }));
  }

  // The document-type selector stays enabled through Preview, so switching it
  // after matching must re-resolve every matched patient's source-file
  // selection against the new type's rules — otherwise handleGenerate would
  // validate a selection that was resolved for the previous document type.
  useEffect(() => {
    if (phase !== PHASE.PREVIEW) return;
    setPatients(prev => prev.map(patient => {
      if (patient.status !== 'matched') return patient;
      const resolution = resolveSourceFiles(patient.files, getSourceRules(settings, selectedTemplate));
      return { ...patient, selectedFileIds: resolution.selectedFileIds, sourceRuleResults: resolution.ruleResults };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate]);

  // ── Resumable batches: offer to restore an interrupted run ──────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BATCH_STORAGE_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw);
      if (snap?.phase && snap.phase !== PHASE.IDLE && snap.patients?.length) {
        setResumeBanner(snap);
      }
    } catch { /* ignore corrupted snapshot */ }
  }, []);

  // Debounced so the frequent genPercent updates during streaming (many
  // per document) don't each trigger a synchronous JSON.stringify + Web
  // Storage write of the whole patients array.
  useEffect(() => {
    if (phase === PHASE.IDLE) {
      localStorage.removeItem(BATCH_STORAGE_KEY);
      return;
    }
    clearTimeout(persistTimeoutRef.current);
    persistTimeoutRef.current = setTimeout(() => {
      try {
        // generatedOutput.html is the full clinical note (PHI) — never park
        // that in localStorage. Resume only needs the plan; a resumed run
        // re-generates any document that isn't safely saved to Drive/Supabase.
        const persistableOutputs = outputs.map(({ generatedOutput: _generatedOutput, ...rest }) => rest);
        localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify({
          phase, patients, outputs: persistableOutputs, batchInput, selectedTemplate, summary, ts: Date.now(),
        }));
      } catch (e) {
        console.warn('Could not persist batch snapshot for resume:', e);
      }
    }, 400);
    return () => clearTimeout(persistTimeoutRef.current);
  }, [phase, patients, outputs, batchInput, selectedTemplate, summary]);

  function handleResumeBatch() {
    if (!resumeBanner) return;
    setBatchInput(resumeBanner.batchInput || '');
    setSelectedTemplate(resumeBanner.selectedTemplate || 'treatment_plan');
    setPatients(resumeBanner.patients || []);
    setOutputs(normalizeResumedOutputs(resumeBanner.outputs));
    setSummary(resumeBanner.summary || null);
    setPhase(resumeStablePhase(resumeBanner.phase));
    setResumeBanner(null);
    addLog('Resumed previous batch session.');
  }

  function handleDiscardResume() {
    localStorage.removeItem(BATCH_STORAGE_KEY);
    setResumeBanner(null);
  }

  // ── Phase 1: Match patients to Drive folders ──────────────────────────────
  async function handleMatch() {
    const names = batchInput.split('\n').map(s => s.trim()).filter(Boolean);
    if (!names.length) return;
    if (!driveConnected) { addLog('Google Drive not connected. Go to Settings first.', 'error'); return; }

    setPhase(PHASE.MATCHING);
    setLog([]);
    setPatients([]);
    addLog('Locating PatientForms directory…');

    try {
      const root = await findPatientFormsFolder();
      addLog(`Found PatientForms (ID: ${root.id})`);

      const subfolders = await listSubfolders(root.id);
      addLog(`Found ${subfolders.length} patient subfolders`);

      const result = await Promise.all(names.map(async (name) => {
        const candidates = matchPatientFolders(name, subfolders);
        const status = classifyMatch(candidates);
        const base = { name, candidates, error: null, selectedFileIds: [], sourceRuleResults: [] };

        if (status === 'not_found') {
          addLog(`⚠ "${name}" — Folder Not Found`, 'warn');
          return { ...base, status, folderId: null, folderName: null, files: [], error: 'Folder Not Found' };
        }

        if (status === 'ambiguous') {
          addLog(`⚠ "${name}" matched ${candidates.length} folders (${candidates.map(c => c.name).join(', ')}) — resolve manually`, 'warn');
          return { ...base, status, folderId: null, folderName: null, files: [] };
        }

        const match = candidates[0];
        const files = await listPatientFiles(match.id);
        const sourceResolution = resolveSourceFiles(files, getSourceRules(settings, selectedTemplate));
        addLog(`✓ "${name}" → "${match.name}" (${files.length} target files)`);
        return {
          ...base, status, folderId: match.id, folderName: match.name, files,
          selectedFileIds: sourceResolution.selectedFileIds, sourceRuleResults: sourceResolution.ruleResults,
        };
      }));

      setPatients(result);
      setPhase(PHASE.PREVIEW);
    } catch (e) {
      addLog(`Error: ${e.message}`, 'error');
      setPhase(PHASE.IDLE);
    }
  }

  async function resolveAmbiguous(name, folderId) {
    const patient = patients.find(p => p.name === name);
    const candidate = patient?.candidates.find(c => c.id === folderId);
    if (!candidate) return;
    try {
      const files = await listPatientFiles(candidate.id);
      const sourceResolution = resolveSourceFiles(files, getSourceRules(settings, selectedTemplate));
      updatePatientByName(name, {
        status: 'matched', folderId: candidate.id, folderName: candidate.name, files, error: null,
        selectedFileIds: sourceResolution.selectedFileIds, sourceRuleResults: sourceResolution.ruleResults,
      });
      addLog(`✓ Resolved "${name}" → "${candidate.name}"`);
    } catch (e) {
      updatePatientByName(name, { status: 'error', error: e.message });
    }
  }

  function skipPatient(name) {
    updatePatientByName(name, { status: 'skipped' });
  }

  function toggleFileExpand(name) {
    setExpandedFiles(prev => ({ ...prev, [name]: !prev[name] }));
  }

  function updateProgress(percent, current, total, step) {
    setProgress({ percent, current, total, step });
  }

  // ── Phase 1.5: Build the planned outputs list + move to the Confirm screen ──
  function handleProceedToConfirm() {
    const confirmed = patients.filter(p => p.status === 'matched');
    if (confirmed.length === 0) {
      addLog('No matched patients to generate for.', 'error');
      return;
    }
    if (patients.some(p => p.status === 'ambiguous')) {
      addLog('Resolve all ambiguous folder matches before generating.', 'error');
      return;
    }

    const docTypeKey = selectedTemplate;
    const meta = getDocumentTypeMeta(docTypeKey);
    if (!meta) { addLog('No template selected.', 'error'); return; }

    const built = confirmed.flatMap(patient => planPatientOutputs(patient, docTypeKey, settings).map(planned => ({
      ...planned,
      fileNameBase: computeOutputFileNameBase(settings.namingConvention, planned.docTypeKey, planned.patientName, planned.dateForFilename, planned.dedupeSuffix),
      included: true,
      status: 'planned',
      genPercent: 0,
      generatedOutput: null,
      approved: true,
      error: null,
      savedOutputs: [],
    })));

    setOutputs(built);
    setPhase(PHASE.CONFIRM);
  }

  // ── Phase 2: Generate (in memory only — nothing is saved yet) ───────────
  async function handleGenerate() {
    const activeOutputs = outputs.filter(o => o.included);
    if (activeOutputs.length === 0) {
      addLog('No planned outputs selected to generate.', 'error');
      return;
    }

    const docTypeKey = selectedTemplate;
    const provider = settings.aiProvider || 'gemini';
    const keys = getProviderKeys(settings);
    if (!isProviderConfigured(provider, keys)) {
      addLog(`${AI_PROVIDERS[provider]?.label || provider} API key not configured. Go to Settings.`, 'error');
      return;
    }

    // Check for duplicates and pre-collect warnings, once per patient involved
    let hasDedupeWarnings = false;
    [...new Set(activeOutputs.map(o => o.patientName))].forEach(name => {
      const patient = patients.find(p => p.name === name);
      if (!patient) return;
      const duplicates = detectDuplicateSourceFiles(patient.files, patient.sourceRuleResults || []);
      if (duplicates.length > 0) {
        addLog(`⚠ ${name}: ${duplicates.length} file(s) match multiple rules and will be included twice`, 'warn');
        hasDedupeWarnings = true;
      }
    });
    if (hasDedupeWarnings) {
      addLog('💡 Tip: Modify source file rules to avoid duplication, or manually adjust file selection per patient', 'info');
    }

    setPhase(PHASE.GENERATING);
    abortRef.current = false;

    const total = activeOutputs.length;
    updateProgress(0, 0, total, 'Starting...');

    // Create generation log for audit trail
    const batchId = generateBatchId();
    const batchLog = await saveGenerationLog(supabase, {
      userId: user?.id,
      batchId,
      batchName: `Batch ${docTypeKey} ${new Date().toLocaleDateString()}`,
      docTypeKey,
      settingsSnapshot: {
        aiProvider: provider,
        aiModel: settings.aiModel,
        detailLevel: settings.detailLevel,
        sourceFileRules: settings.sourceFiles,
      },
    });
    setGenerationLogId(batchLog?.id);
    if (!batchLog) addLog('⚠ Warning: Could not create audit log', 'warn');

    const systemPrompt = buildSystemPrompt(settings.detailLevel);
    let successCount = 0;
    let failureCount = 0;
    let stepNum = 0;
    const resultsByKey = {};
    const patientOrder = [...new Set(activeOutputs.map(o => o.patientName))];

    outer:
    for (const patientName of patientOrder) {
      if (abortRef.current) { addLog('\n⏹ Generation cancelled.', 'warn'); break; }
      const patient = patients.find(p => p.name === patientName);
      const patientOutputs = activeOutputs.filter(o => o.patientName === patientName);

      addLog(`\n━━━ ${patientName} ━━━`);

      if (!patient) {
        const msg = `No matched folder record found for ${patientName} — re-run matching.`;
        addLog(`  ❌ ${msg}`, 'error');
        patientOutputs.forEach(o => {
          stepNum += 1;
          updateOutputByKey(o.key, { status: 'error', error: msg, approved: false });
          failureCount += 1;
          updateProgress(Math.round((stepNum / total) * 100), stepNum, total, 'Done');
        });
        continue;
      }

      // Per-patient selected-file check against the doc type's configured
      // rules — run once per patient (not per output) since it validates the
      // same underlying selectedFileIds every one of this patient's outputs draws from.
      const rules = getSourceRules(settings, docTypeKey);
      const validation = validateSelectedSourceFiles(patient.files, patient.selectedFileIds, rules);
      validation.missingOptional.forEach(({ rule }) => addLog(`  ⚠ Optional source not found: ${rule.label}`, 'warn'));
      if (validation.missingRequired.length > 0) {
        const msg = `Required source file missing: ${validation.missingRequired.map(x => x.rule.label).join(', ')}`;
        addLog(`  ❌ ${msg}`, 'error');
        patientOutputs.forEach(o => {
          stepNum += 1;
          updateOutputByKey(o.key, { status: 'error', error: msg, approved: false });
          failureCount += 1;
          updateProgress(Math.round((stepNum / total) * 100), stepNum, total, 'Done');
        });
        continue;
      }

      for (const out of patientOutputs) {
        if (abortRef.current) { addLog('\n⏹ Generation cancelled.', 'warn'); break outer; }

        stepNum += 1;
        updateProgress(Math.round(((stepNum - 1) / total) * 100), stepNum, total, `Processing ${patientName} — ${out.label}...`);
        updateOutputByKey(out.key, { status: 'generating', genPercent: 0 });

        try {
          const { sourceText, sourceFileList } = await collectSourceText(patient, (msg, type) => addLog(`  ${msg}`, type), out.sourceFiles);

          if (sourceFileList.length === 0) {
            addLog(`  ✅ No source files for ${patientName} — ${out.label}, skipping.`);
            updateOutputByKey(out.key, { status: 'skipped', error: 'No source files' });
            continue;
          }

          addLog(`  ✓ Using ${sourceFileList.length} source file(s): ${sourceFileList.join(', ')}`);
          addLog(`  🔮 Generating ${out.label}...`);

          let bootstrapNoteHtml = null;
          if (out.dependsOnKey) {
            const dep = resultsByKey[out.dependsOnKey];
            if (dep?.html) {
              bootstrapNoteHtml = dep.html;
            } else {
              addLog(`  ⚠ First Session Note wasn't generated — building the Treatment Plan without that extra context.`, 'warn');
            }
          }

          let lastGenPercent = -1;
          const { outputHtml, templateLabel } = await withRetry(
            () => generateDocumentForPatient({
              patient, docTypeKey: out.docTypeKey, sourceText, systemPrompt, provider, keys,
              model: settings.aiModel || undefined,
              getTemplateHtml, fetchLatestDocument, bootstrapNoteHtml,
              onLog: (msg, type) => addLog(`  ${msg}`, type),
              onChunk: (_delta, fullText) => {
                const pct = estimateGenerationPercent(settings.detailLevel, fullText.length);
                if (pct !== lastGenPercent) {
                  lastGenPercent = pct;
                  updateOutputByKey(out.key, { genPercent: pct });
                }
              },
            }),
            { retries: 2, onRetry: (e, n) => { lastGenPercent = -1; updateOutputByKey(out.key, { genPercent: 0 }); addLog(`  ⟳ Retry ${n}/2 after error: ${e.message}`, 'warn'); } }
          );

          addLog(`  ✓ ${templateLabel} generated (${outputHtml.length} chars)`);
          resultsByKey[out.key] = { html: outputHtml };
          updateOutputByKey(out.key, {
            status: 'generated',
            generatedOutput: { html: outputHtml, templateLabel, sourceFileList },
            approved: true,
            error: null,
          });
          successCount += 1;
        } catch (e) {
          addLog(`  ❌ Error for ${patientName} — ${out.label}: ${e.message}`, 'error');
          updateOutputByKey(out.key, { status: 'error', error: e.message, approved: false });
          failureCount += 1;

          if (batchLog?.id) {
            await saveGenerationError(supabase, {
              userId: user?.id,
              generationLogId: batchLog.id,
              patientName,
              error: e,
              docTypeKey: out.docTypeKey,
            });
          }
        }

        updateProgress(Math.round((stepNum / total) * 100), stepNum, total, 'Done');
      }
    }

    // Update generation log with final stats
    if (batchLog?.id) {
      const skipCount = total - successCount - failureCount;
      await completeGenerationLog(supabase, {
        generationLogId: batchLog.id,
        successfulCount: successCount,
        failedCount: failureCount,
        skippedCount: skipCount,
      });
    }

    setPhase(PHASE.REVIEW);
    addLog('\n✅ Generation complete — review documents before saving to Drive.');
  }

  function updateGeneratedHtml(key, html) {
    setOutputs(prev => prev.map(o =>
      o.key === key ? { ...o, generatedOutput: { ...o.generatedOutput, html } } : o
    ));
  }

  function togglePreviewMode(key) {
    setPreviewMode(prev => ({ ...prev, [key]: prev[key] === 'raw' ? 'rendered' : 'raw' }));
  }

  function handleReviewStatusChange(key, status) {
    if (status === 'approved') {
      updateOutputByKey(key, { approved: true });
    } else if (status === 'rejected') {
      updateOutputByKey(key, { approved: false });
    }
  }

  /** Re-run generation for a single already-generated (or failed) output in place, without re-running the whole batch. */
  async function handleRegenerateClick(key) {
    const output = outputs.find(o => o.key === key);
    if (!output) return;
    const patient = patients.find(p => p.name === output.patientName);
    if (!patient) {
      addLog(`Cannot regenerate — no matched folder record for ${output.patientName}. Re-run matching first.`, 'error');
      return;
    }

    const provider = settings.aiProvider || 'gemini';
    const keys = getProviderKeys(settings);
    if (!isProviderConfigured(provider, keys)) {
      addLog(`${AI_PROVIDERS[provider]?.label || provider} API key not configured. Go to Settings.`, 'error');
      return;
    }

    updateOutputByKey(key, { regenerating: true, error: null });
    addLog(`\n🔄 Regenerating ${output.patientName} — ${output.label}...`);

    try {
      const { sourceText, sourceFileList } = await collectSourceText(patient, (msg, type) => addLog(`  ${msg}`, type), output.sourceFiles);
      if (sourceFileList.length === 0) {
        throw new Error('No source files available to regenerate from.');
      }

      let bootstrapNoteHtml = null;
      if (output.dependsOnKey) {
        bootstrapNoteHtml = outputs.find(o => o.key === output.dependsOnKey)?.generatedOutput?.html || null;
        if (!bootstrapNoteHtml) {
          addLog(`  ⚠ First Session Note wasn't available — regenerating Treatment Plan without that extra context.`, 'warn');
        }
      }

      const systemPrompt = buildSystemPrompt(settings.detailLevel);
      const { outputHtml, templateLabel } = await withRetry(
        () => generateDocumentForPatient({
          patient, docTypeKey: output.docTypeKey, sourceText, systemPrompt, provider, keys,
          model: settings.aiModel || undefined,
          getTemplateHtml, fetchLatestDocument, bootstrapNoteHtml,
          onLog: (msg, type) => addLog(`  ${msg}`, type),
        }),
        { retries: 2, onRetry: (e, n) => addLog(`  ⟳ Retry ${n}/2: ${e.message}`, 'warn') }
      );

      updateOutputByKey(key, {
        status: 'generated', regenerating: false,
        generatedOutput: { html: outputHtml, templateLabel, sourceFileList },
        approved: true, error: null,
      });
      addLog(`  ✅ ${output.label} regenerated (${outputHtml.length} chars)`);
    } catch (e) {
      updateOutputByKey(key, { regenerating: false, error: e.message });
      addLog(`  ❌ Regeneration failed for ${output.patientName} — ${output.label}: ${e.message}`, 'error');
    }
  }

  // ── Phase 3: Save approved documents to Drive + Supabase ────────────────
  async function handleSaveApproved() {
    const approved = outputs.filter(o => o.status === 'generated' && o.approved);
    if (approved.length === 0) {
      addLog('No approved documents to save.', 'error');
      return;
    }

    setPhase(PHASE.SAVING);
    abortRef.current = false;
    const auditRows = [];
    const total = approved.length;
    updateProgress(0, 0, total, 'Saving...');

    for (let i = 0; i < approved.length; i++) {
      const out = approved[i];
      if (abortRef.current) { addLog('\n⏹ Save cancelled.', 'warn'); break; }
      const patient = patients.find(p => p.name === out.patientName);

      updateOutputByKey(out.key, { status: 'saving' });
      updateProgress(Math.round((i / total) * 100), i + 1, total, `Saving ${out.patientName} — ${out.label}...`);

      try {
        const { savedOutputs } = await withRetry(
          () => saveGeneratedDocument({
            patient,
            docTypeKey: out.docTypeKey,
            outputHtml: out.generatedOutput.html,
            settings,
            provider: settings.aiProvider || 'gemini',
            model: settings.aiModel || undefined,
            saveDocument,
            saveReport,
            source: 'manual',
            fileNameBase: out.fileNameBase,
            dateOfServiceOverride: out.dateForFilename,
          }),
          { retries: 2, onRetry: (e, n) => addLog(`  ⟳ Retry ${n}/2 saving ${out.patientName} — ${out.label}: ${e.message}`, 'warn') }
        );

        updateOutputByKey(out.key, { status: 'done', savedOutputs });
        auditRows.push({ key: out.key, name: out.patientName, label: out.label, status: 'done', files: out.generatedOutput.sourceFileList, outputs: savedOutputs });
        addLog(`  ✅ ${out.patientName} — ${out.label} saved — ${savedOutputs.length} file(s)`);
      } catch (e) {
        updateOutputByKey(out.key, { status: 'error', error: e.message });
        auditRows.push({ key: out.key, name: out.patientName, label: out.label, status: 'error', error: e.message, files: [], outputs: [] });
        addLog(`  ❌ Save failed for ${out.patientName} — ${out.label}: ${e.message}`, 'error');
      }
    }

    updateProgress(100, total, total, 'Complete');
    setSummary(auditRows);
    setPhase(PHASE.DONE);
    addLog('\n✅ Batch save complete.');
  }

  function handleCancel() {
    abortRef.current = true;
  }

  function handleReset() {
    setPhase(PHASE.IDLE);
    setPatients([]);
    setOutputs([]);
    setLog([]);
    setSummary(null);
    setBatchInput('');
    setExpandedFiles({});
    setGenerationLogId(null);
    setBatchPreValidationErrors([]);
    setBatchPreValidationWarnings([]);
    localStorage.removeItem(BATCH_STORAGE_KEY);
  }

  const hasAmbiguous = patients.some(p => p.status === 'ambiguous');
  const generatedForReview = outputs.filter(o => o.status === 'generated' || (o.status === 'error' && phase !== PHASE.PREVIEW));

  return (
    <div className="min-h-full bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto">

        {/* Resume banner */}
        {phase === PHASE.IDLE && resumeBanner && (
          <div className="mb-5 rounded-2xl border border-teal-500/25 bg-teal-500/8 px-5 py-4 flex items-center gap-3">
            <History className="w-4 h-4 text-teal-400 flex-shrink-0" />
            <p className="text-xs text-teal-200 flex-1">
              <strong className="text-teal-300">An interrupted batch was found</strong> ({resumeBanner.patients?.length || 0} patient(s), last active {new Date(resumeBanner.ts).toLocaleString()}). Resume where you left off?
            </p>
            <button onClick={handleResumeBatch} className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-black transition-all">
              Resume
            </button>
            <button onClick={handleDiscardResume} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-xs font-bold transition-all">
              Discard
            </button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
              <ClipboardList className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black text-white">Batch Processor</h1>
              <p className="text-xs text-slate-500">AI-powered clinical document generation from Google Drive patient files</p>
            </div>
          </div>
          {phase !== PHASE.IDLE && (
            <div className="flex items-center gap-2">
              {(phase === PHASE.GENERATING || phase === PHASE.SAVING) && (
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 text-red-400 hover:text-red-300 text-xs font-bold transition-colors border border-red-500/20"
                >
                  <Ban className="w-3.5 h-3.5" /> Cancel
                </button>
              )}
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white text-xs font-bold transition-colors border border-white/10"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Reset
              </button>
            </div>
          )}
        </div>

        {/* Config summary bar */}
        <div className="flex flex-wrap gap-2 mb-6">
          {[
            { label: 'Format', value: settings.outputFormat },
            { label: 'Detail', value: settings.detailLevel },
            { label: 'Drive', value: driveConnected ? 'Connected' : 'Not Connected', warn: !driveConnected },
            {
              label: 'AI',
              value: (() => {
                const provider = settings.aiProvider || 'gemini';
                const providerLabel = AI_PROVIDERS[provider]?.label || provider;
                const hasKey = isProviderConfigured(provider, getProviderKeys(settings));
                return `${providerLabel}${hasKey ? '' : ' (no key)'}`;
              })(),
              warn: !isProviderConfigured(settings.aiProvider || 'gemini', getProviderKeys(settings)),
            },
          ].map(({ label, value, warn }) => (
            <div key={label} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold ${warn ? 'bg-red-500/10 border-red-500/25 text-red-400' : 'bg-white/5 border-white/10 text-slate-300'}`}>
              <span className="text-slate-500">{label}:</span> {value}
              {warn && <AlertTriangle className="w-3 h-3" />}
            </div>
          ))}
        </div>

        {/* Template Selector */}
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-full bg-teal-500/20 flex items-center justify-center text-xs font-black text-teal-400">
              <FileText className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-sm font-black text-white">Select Document Type</h2>
          </div>
          <p className="text-xs text-slate-500 mb-3">Choose which type of clinical document to generate for this batch.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {DOCUMENT_TYPES.map(t => {
              const Icon = TEMPLATE_ICONS[t.key];
              const isSelected = selectedTemplate === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setSelectedTemplate(t.key)}
                  disabled={phase === PHASE.GENERATING || phase === PHASE.SAVING}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl border text-center transition-all ${
                    isSelected
                      ? `bg-gradient-to-br ${TEMPLATE_COLORS[t.key]} text-white shadow-lg border-white/20`
                      : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white hover:border-white/20'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  <span className="text-xs font-bold leading-tight">{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Progress Bar */}
        {(phase === PHASE.GENERATING || phase === PHASE.SAVING) && (
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 mb-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 text-teal-400 animate-spin" />
                <h2 className="text-sm font-black text-white">{phase === PHASE.SAVING ? 'Saving Documents' : 'Generating Documents'}</h2>
              </div>
              <span className="text-2xl font-black text-teal-300">{progress.percent}%</span>
            </div>
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-gradient-to-r from-teal-600 to-emerald-500 transition-all duration-300 ease-out"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">
                Document <span className="font-bold text-white">{progress.current}</span> of <span className="font-bold text-white">{progress.total}</span>
              </span>
              <span className="text-slate-400">{progress.step}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Left column: input + patients */}
          <div className="lg:col-span-3 space-y-4">

            {/* Step 1: Batch Input */}
            {phase !== PHASE.REVIEW && phase !== PHASE.DONE && (
              <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center text-xs font-black text-violet-400">1</div>
                    <h2 className="text-sm font-black text-white">{singleClientMode ? 'Enter Client Name' : 'Enter Patient Names'}</h2>
                  </div>
                  {phase === PHASE.IDLE && (
                    <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
                      <button
                        type="button"
                        onClick={() => { if (singleClientMode) { setSingleClientMode(false); setBatchInput(''); } }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                          !singleClientMode ? 'bg-violet-500/20 text-violet-300' : 'text-slate-500 hover:text-white'
                        }`}
                      >
                        Batch
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (!singleClientMode) { setSingleClientMode(true); setBatchInput(''); } }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                          singleClientMode ? 'bg-violet-500/20 text-violet-300' : 'text-slate-500 hover:text-white'
                        }`}
                      >
                        Single Client
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-500 mb-3">
                  {singleClientMode
                    ? 'Name must match a folder inside PatientForms.'
                    : 'One patient name per line. Names must match folder names inside PatientForms.'}
                </p>
                {singleClientMode ? (
                  <input
                    type="text"
                    value={batchInput}
                    onChange={e => setBatchInput(e.target.value)}
                    disabled={phase !== PHASE.IDLE}
                    placeholder="John Smith"
                    className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 font-mono focus:outline-none focus:border-violet-500/40 disabled:opacity-50"
                  />
                ) : (
                  <textarea
                    value={batchInput}
                    onChange={e => setBatchInput(e.target.value)}
                    disabled={phase !== PHASE.IDLE}
                    rows={6}
                    placeholder={'John Smith\nJane Doe\nRobert Johnson'}
                    className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 font-mono focus:outline-none focus:border-violet-500/40 resize-none disabled:opacity-50"
                  />
                )}
                <button
                  onClick={handleMatch}
                  disabled={!batchInput.trim() || !driveConnected || phase === PHASE.MATCHING}
                  className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-black transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-violet-500/20"
                >
                  {phase === PHASE.MATCHING
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning Drive…</>
                    : singleClientMode
                      ? <><Search className="w-4 h-4" /> Find Client in Drive</>
                      : <><Search className="w-4 h-4" /> Match Patients to Drive Folders</>
                  }
                </button>
              </div>
            )}

            {/* Step 2: Preview & Verify Sources (+ resolve ambiguous matches) */}
            {phase === PHASE.PREVIEW && patients.length > 0 && (
              <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-teal-500/20 flex items-center justify-center text-xs font-black text-teal-400">2</div>
                  <div>
                    <h2 className="text-sm font-black text-white">Verify Source Files</h2>
                    <p className="text-[10px] text-slate-500">Click ± to see which documents will be used</p>
                  </div>
                  <span className="ml-auto text-xs text-teal-400 font-semibold">Confirm before generating</span>
                </div>

                <div className="space-y-2">
                  {patients.map((p) => (
                    <div key={p.name} className={`rounded-xl border p-3 ${
                      p.status === 'not_found' || p.status === 'error' ? 'border-red-500/30 bg-red-500/5'
                      : p.status === 'ambiguous' ? 'border-amber-500/30 bg-amber-500/5'
                      : 'border-white/10 bg-white/3'
                    }`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FolderOpen className="w-4 h-4 text-slate-500 flex-shrink-0" />
                          <span className="text-sm font-bold text-white truncate">{p.name}</span>
                          {p.folderName && p.folderName !== p.name && (
                            <span className="text-xs text-slate-500">→ {p.folderName}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <StatusBadge status={p.status} />
                          {p.files.length > 0 && (
                            <button
                              onClick={() => toggleFileExpand(p.name)}
                              className="text-slate-500 hover:text-white transition-colors"
                            >
                              <List className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* File list — checkbox per file lets the preselected match be verified or overridden */}
                      {expandedFiles[p.name] && p.files.length > 0 && (
                        <div className="mt-2 pl-6 space-y-1">
                          <button
                            type="button"
                            onClick={() => applyConfiguredFileRules(p.name)}
                            className="mb-1.5 px-2 py-1 rounded-md bg-teal-500/10 border border-teal-500/25 text-teal-300 text-[10px] font-bold hover:bg-teal-500/20 transition-colors"
                          >
                            Re-apply Settings Rules
                          </button>
                          {p.files.map(f => (
                            <label key={f.id} className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={(p.selectedFileIds || []).includes(f.id)}
                                onChange={() => togglePatientSourceFile(p.name, f.id)}
                                className="accent-teal-500"
                              />
                              <FileText className="w-3 h-3 flex-shrink-0" />
                              {f.name}
                              <span className="text-slate-600 text-[10px]">({f.mimeType?.split('/').pop()})</span>
                            </label>
                          ))}
                          {p.sourceRuleResults?.some(r => r.rule.required && r.matches.length === 0) && (
                            <p className="text-[10px] text-red-400 flex items-center gap-1 pt-1">
                              <AlertTriangle className="w-3 h-3" /> Missing required: {p.sourceRuleResults.filter(r => r.rule.required && r.matches.length === 0).map(r => r.rule.label).join(', ')}
                            </p>
                          )}
                          {p.sourceRuleResults?.some(r => !r.rule.required && r.matches.length === 0) && (
                            <p className="text-[10px] text-amber-400 flex items-center gap-1 pt-1">
                              <Info className="w-3 h-3" /> Missing optional: {p.sourceRuleResults.filter(r => !r.rule.required && r.matches.length === 0).map(r => r.rule.label).join(', ')}
                            </p>
                          )}
                          <DeduplicationWarning
                            duplicates={detectDuplicateSourceFiles(p.files, p.sourceRuleResults || [])}
                            patientName={p.name}
                          />
                        </div>
                      )}

                      {/* Ambiguous resolution UI */}
                      {p.status === 'ambiguous' && (
                        <div className="mt-2 pl-6 space-y-2">
                          <p className="text-xs text-amber-400 flex items-center gap-1">
                            <HelpCircle className="w-3 h-3" /> Matched {p.candidates.length} folders — pick the right one:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {p.candidates.map(c => (
                              <button
                                key={c.id}
                                onClick={() => resolveAmbiguous(p.name, c.id)}
                                className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold transition-colors"
                              >
                                {c.name}
                              </button>
                            ))}
                            <button
                              onClick={() => skipPatient(p.name)}
                              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white text-xs font-semibold transition-colors"
                            >
                              Skip patient
                            </button>
                          </div>
                        </div>
                      )}

                      {p.status === 'not_found' && (
                        <div className="mt-1.5 pl-6 space-y-1">
                          <p className="text-xs text-red-400 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> No matching folder found in PatientForms. This patient will be skipped.
                          </p>
                        </div>
                      )}
                      {p.status === 'error' && p.error && (
                        <p className="mt-1.5 pl-6 text-xs text-red-400">{p.error}</p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Continue button */}
                {hasAmbiguous && (
                  <p className="mt-3 text-xs text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> Resolve all ambiguous matches above before continuing.
                  </p>
                )}
                <button
                  onClick={handleProceedToConfirm}
                  disabled={!patients.some(p => p.status === 'matched') || hasAmbiguous}
                  className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-black transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
                >
                  <Eye className="w-4 h-4" />
                  Continue to Confirm Outputs
                  <span className="text-xs opacity-70">({patients.filter(p => p.status === 'matched').length} patients)</span>
                </button>
              </div>
            )}

            {/* Step 2.5: Confirm exactly what will be generated — per client, per document */}
            {(phase === PHASE.CONFIRM || phase === PHASE.GENERATING) && outputs.length > 0 && (
              <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center text-xs font-black text-violet-400">3</div>
                  <div>
                    <h2 className="text-sm font-black text-white">Confirm Outputs</h2>
                    <p className="text-[10px] text-slate-500">Exactly what will be generated for each client, from which files, saved under which name</p>
                  </div>
                  {phase === PHASE.CONFIRM && (
                    <span className="ml-auto text-xs text-violet-400 font-semibold">Uncheck anything you don't want generated</span>
                  )}
                </div>

                <div className="space-y-3">
                  {patients.filter(p => p.status === 'matched').map(p => {
                    const patientOutputs = outputs.filter(o => o.patientName === p.name);
                    if (patientOutputs.length === 0) return null;
                    return (
                      <div key={p.name} className="rounded-xl border border-white/10 bg-white/3 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <FolderOpen className="w-4 h-4 text-slate-500 flex-shrink-0" />
                          <span className="text-sm font-bold text-white truncate">{p.name}</span>
                        </div>
                        <div className="space-y-2 pl-6">
                          {patientOutputs.map(o => (
                            <div key={o.key} className="rounded-lg border border-white/10 bg-slate-950/60 p-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <label className="flex items-start gap-2 text-xs text-white font-semibold cursor-pointer min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={o.included}
                                    onChange={() => toggleOutputIncluded(o.key)}
                                    disabled={phase !== PHASE.CONFIRM}
                                    className="accent-violet-500 mt-0.5 flex-shrink-0"
                                  />
                                  <span className="min-w-0">
                                    {o.label}
                                    {o.isBootstrap && (
                                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[9px] font-bold align-middle">AUTO — PASS 1</span>
                                    )}
                                  </span>
                                </label>
                                <StatusBadge status={o.status} />
                              </div>
                              <p className="mt-1.5 text-[10px] text-slate-500">
                                Source file(s): {o.sourceFiles.length > 0 ? o.sourceFiles.map(f => f.name).join(', ') : '—'}
                              </p>
                              <p className="mt-1 text-[10px] text-teal-300 font-mono">
                                → {o.fileNameBase}{settings.outputFormat === 'Both' ? '.html / .pdf' : settings.outputFormat === 'PDF' ? '.pdf' : '.html'}
                              </p>
                              {o.status === 'generating' && (
                                <div
                                  role="progressbar"
                                  aria-label={`Generating ${o.label} for ${p.name}`}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-valuenow={o.genPercent || 0}
                                  className="mt-2 w-full h-1.5 bg-slate-800 rounded-full overflow-hidden"
                                >
                                  <div
                                    className="h-full bg-gradient-to-r from-violet-600 to-teal-500 transition-all duration-300 ease-out"
                                    style={{ width: `${o.genPercent || 0}%` }}
                                  />
                                </div>
                              )}
                              {o.status === 'error' && o.error && (
                                <p className="mt-1.5 text-[10px] text-red-400">{o.error}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {phase === PHASE.CONFIRM && (
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => setPhase(PHASE.PREVIEW)}
                      className="flex-shrink-0 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white text-sm font-bold transition-all"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleGenerate}
                      disabled={!outputs.some(o => o.included)}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-black transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
                    >
                      <Play className="w-4 h-4" />
                      Confirm & Generate All Documents
                      <span className="text-xs opacity-70">({outputs.filter(o => o.included).length} document{outputs.filter(o => o.included).length !== 1 ? 's' : ''})</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Step 4: Review generated documents before saving */}
            {phase === PHASE.REVIEW && (
              <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-black text-emerald-400">4</div>
                  <div>
                    <h2 className="text-sm font-black text-white">Review Before Saving</h2>
                    <p className="text-[10px] text-slate-500">Edit content if needed, then approve which documents get saved to Drive</p>
                  </div>
                </div>

                {/* Document review queue */}
                <DocumentReviewQueue
                  items={generatedForReview}
                  onReviewStatusChange={handleReviewStatusChange}
                  onRegenerateClick={handleRegenerateClick}
                  phase={phase}
                />

                {/* Review items with HTML edit mode */}
                <div className="space-y-3 mt-5">
                  {generatedForReview.map(o => (
                    o.status === 'generated' && (
                      <div key={o.key} className="rounded-xl border border-white/10 bg-white/3 p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="text-sm font-bold text-white truncate">{o.patientName} <span className="text-slate-500 font-normal">— {o.label}</span></span>
                          <button
                            onClick={() => togglePreviewMode(o.key)}
                            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors flex-shrink-0"
                          >
                            <Code className="w-3.5 h-3.5" />
                            {previewMode[o.key] === 'raw' ? 'Preview' : 'Edit HTML'}
                          </button>
                        </div>

                        {previewMode[o.key] === 'raw' ? (
                          <textarea
                            value={o.generatedOutput.html}
                            onChange={e => updateGeneratedHtml(o.key, e.target.value)}
                            rows={10}
                            className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-300 font-mono focus:outline-none focus:border-teal-500/40 resize-y"
                          />
                        ) : (
                          <iframe
                            title={`preview-${o.key}`}
                            sandbox=""
                            srcDoc={o.generatedOutput.html}
                            className="w-full h-64 rounded-lg border border-white/10 bg-white"
                          />
                        )}
                      </div>
                    )
                  ))}
                </div>

                <button
                  onClick={handleSaveApproved}
                  disabled={!outputs.some(o => o.status === 'generated' && o.approved)}
                  className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-black transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
                >
                  <Save className="w-4 h-4" />
                  Save Approved Documents to Drive
                  <span className="text-xs opacity-70">
                    ({outputs.filter(o => o.status === 'generated' && o.approved).length} of {outputs.filter(o => o.status === 'generated').length})
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Right column: Activity log */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 h-full flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <h2 className="text-xs font-black text-slate-400 uppercase tracking-wider">Activity Log</h2>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 max-h-80 lg:max-h-[500px] font-mono text-[11px]">
                {log.length === 0 && (
                  <p className="text-slate-600 italic">Log output will appear here…</p>
                )}
                {log.map((entry, i) => (
                  <p key={i} className={
                    entry.type === 'error' ? 'text-red-400'
                    : entry.type === 'warn' ? 'text-amber-400'
                    : 'text-slate-400'
                  }>
                    <span className="text-slate-700 mr-1">{entry.ts}</span>
                    {entry.msg}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Summary Audit Dashboard ── */}
        {phase === PHASE.DONE && summary && (
          <div className="mt-6 bg-slate-900 border border-white/10 rounded-2xl p-6">
            <h2 className="text-sm font-black text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Batch Summary Audit
            </h2>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {[
                { label: 'Total Documents', value: summary.length,                                     color: 'text-white' },
                { label: 'Completed',       value: summary.filter(r => r.status === 'done').length,    color: 'text-emerald-400' },
                { label: 'Errors',          value: summary.filter(r => r.status === 'error').length,   color: 'text-red-400' },
                { label: 'Files Created',   value: summary.reduce((a, r) => a + r.outputs.length, 0),  color: 'text-violet-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white/5 rounded-xl p-3 border border-white/10">
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">{label}</p>
                  <p className={`text-2xl font-black ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Per-patient breakdown */}
            <div className="space-y-3">
              {summary.map((row) => (
                <div key={row.key} className={`rounded-xl border p-4 ${
                  row.status === 'done' ? 'border-emerald-500/25 bg-emerald-500/5'
                  : row.status === 'error' ? 'border-red-500/25 bg-red-500/5'
                  : 'border-white/10 bg-white/3'
                }`}>
                  <div className="flex items-center gap-3 mb-2">
                    {row.status === 'done'
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      : row.status === 'error'
                      ? <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                      : <SkipForward className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    }
                    <span className="text-sm font-bold text-white">{row.name} <span className="text-slate-500 font-normal">— {row.label}</span></span>
                    <StatusBadge status={row.status} />
                  </div>

                  {row.outputs.length > 0 && (
                    <div className="pl-7 space-y-1">
                      {row.outputs.map(o => (
                        <a key={o.id} href={o.link} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-200 transition-colors">
                          <FilePlus className="w-3 h-3 flex-shrink-0" />
                          <span className="font-mono">{o.name}</span>
                          <span className="text-slate-600">·</span>
                          <span className="text-slate-500">{o.type}</span>
                          <Eye className="w-3 h-3 ml-1 opacity-50" />
                        </a>
                      ))}
                    </div>
                  )}
                  {row.error && (
                    <p className="pl-7 text-xs text-red-400 mt-1">{row.error}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Guidance if not connected */}
        {!driveConnected && phase === PHASE.IDLE && (
          <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 flex gap-3 items-start">
            <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300/80 leading-relaxed">
              <strong className="text-amber-300">Google Drive not connected.</strong> Go to{' '}
              <a href="/settings" className="underline hover:text-white">Settings</a> to enter your Google OAuth2 Client ID and connect your Drive.
              The app will scan your <code className="font-mono">PatientForms</code> folder for patient subfolders.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
