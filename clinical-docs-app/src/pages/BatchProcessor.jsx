import { useState, useRef, useEffect } from 'react';
import {
  ClipboardList, Search, CheckCircle2, AlertTriangle,
  Play, Loader2, FileText, FilePlus, SkipForward, Eye,
  FolderOpen, List, RefreshCw, XCircle, Info, Heart, Calendar,
  HelpCircle, Code, Save, History, Ban
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  findPatientFormsFolder, listSubfolders, listPatientFiles,
} from '../lib/googleDrive';
import { buildSystemPrompt, AI_PROVIDERS } from '../lib/aiEngine';
import { getProviderKeys, isProviderConfigured } from '../lib/settings';
import { DOCUMENT_TYPES, getDocumentTypeMeta } from '../lib/documentTypes';
import { collectSourceText, generateDocumentForPatient, saveGeneratedDocument } from '../lib/documentPipeline';
import { withRetry } from '../lib/retry';
import { matchPatientFolders, classifyMatch } from '../lib/patientMatching';
import { getSourceRules, resolveSourceFiles, validateSelectedSourceFiles } from '../lib/sourceFileSelection';

const PHASE = {
  IDLE: 'idle', MATCHING: 'matching', PREVIEW: 'preview',
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

function normalizeResumedPatients(list) {
  return (list || []).map(p => {
    if (p.status === 'generating') return { ...p, status: 'matched' };
    if (p.status === 'saving') return { ...p, status: 'generated' };
    return p;
  });
}

function resumeStablePhase(storedPhase) {
  if (storedPhase === PHASE.MATCHING || storedPhase === PHASE.GENERATING) return PHASE.PREVIEW;
  if (storedPhase === PHASE.SAVING) return PHASE.REVIEW;
  return storedPhase;
}

export default function BatchProcessor() {
  const { settings, driveConnected, saveDocument, getTemplateHtml, fetchLatestDocument } = useApp();
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [batchInput, setBatchInput] = useState('');
  const [patients, setPatients] = useState([]);
  const [log, setLog] = useState([]);
  const [summary, setSummary] = useState(null);
  const [expandedFiles, setExpandedFiles] = useState({});
  const [previewMode, setPreviewMode] = useState({}); // { [name]: 'rendered' | 'raw' }
  const [resumeBanner, setResumeBanner] = useState(null);
  const abortRef = useRef(false);

  const [selectedTemplate, setSelectedTemplate] = useState('treatment_plan');
  const [progress, setProgress] = useState({ percent: 0, current: 0, total: 0, step: '' });

  function addLog(msg, type = 'info') {
    setLog(prev => [...prev, { msg, type, ts: new Date().toLocaleTimeString() }]);
  }

  function updatePatientByName(name, patch) {
    setPatients(prev => prev.map(p => p.name === name ? { ...p, ...patch } : p));
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

  useEffect(() => {
    if (phase === PHASE.IDLE) {
      localStorage.removeItem(BATCH_STORAGE_KEY);
      return;
    }
    try {
      localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify({
        phase, patients, batchInput, selectedTemplate, summary, ts: Date.now(),
      }));
    } catch { /* storage full/unavailable — resuming just won't work this time */ }
  }, [phase, patients, batchInput, selectedTemplate, summary]);

  function handleResumeBatch() {
    if (!resumeBanner) return;
    setBatchInput(resumeBanner.batchInput || '');
    setSelectedTemplate(resumeBanner.selectedTemplate || 'treatment_plan');
    setPatients(normalizeResumedPatients(resumeBanner.patients));
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
        const base = { name, candidates, outputs: [], generatedOutput: null, approved: true, error: null, selectedFileIds: [], sourceRuleResults: [] };

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

  // ── Phase 2: Generate (in memory only — nothing is saved yet) ───────────
  async function handleGenerate() {
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

    const provider = settings.aiProvider || 'openai';
    const keys = getProviderKeys(settings);
    if (!isProviderConfigured(provider, keys)) {
      addLog(`${AI_PROVIDERS[provider]?.label || provider} API key not configured. Go to Settings.`, 'error'); return;
    }

    setPhase(PHASE.GENERATING);
    abortRef.current = false;

    const total = confirmed.length;
    updateProgress(0, 0, total, 'Starting...');

    const systemPrompt = buildSystemPrompt(settings.detailLevel);

    for (let i = 0; i < confirmed.length; i++) {
      const patient = confirmed[i];
      if (abortRef.current) { addLog('\n⏹ Generation cancelled.', 'warn'); break; }

      const stepNum = i + 1;
      updateProgress(Math.round((i / total) * 100), stepNum, total, `Processing ${patient.name}...`);
      updatePatientByName(patient.name, { status: 'generating' });
      addLog(`\n━━━ ${stepNum}/${total}: ${patient.name} ━━━`);

      try {
        const rules = getSourceRules(settings, docTypeKey);
        const validation = validateSelectedSourceFiles(patient.files, patient.selectedFileIds, rules);
        if (validation.missingRequired.length > 0) {
          throw new Error(`Required source file missing: ${validation.missingRequired.map(x => x.rule.label).join(', ')}`);
        }
        validation.missingOptional.forEach(({ rule }) => addLog(`  ⚠ Optional source not found: ${rule.label}`, 'warn'));

        const selectedFiles = validation.selectedFiles;
        const { sourceText, sourceFileList } = await collectSourceText(patient, (msg, type) => addLog(`  ${msg}`, type), selectedFiles);

        if (sourceFileList.length === 0) {
          addLog(`  ✅ No source files selected for ${patient.name}, skipping.`);
          updatePatientByName(patient.name, { status: 'skipped', error: 'No source files' });
          continue;
        }

        addLog(`  ✓ Using ${sourceFileList.length} source file(s): ${sourceFileList.join(', ')}`);
        addLog(`  🔮 Generating ${meta.label}...`);

        const { outputHtml, templateLabel } = await withRetry(
          () => generateDocumentForPatient({
            patient, docTypeKey, sourceText, systemPrompt, provider, keys,
            model: settings.aiModel || undefined,
            getTemplateHtml, fetchLatestDocument,
            onLog: (msg, type) => addLog(`  ${msg}`, type),
          }),
          { retries: 2, onRetry: (e, n) => addLog(`  ⟳ Retry ${n}/2 after error: ${e.message}`, 'warn') }
        );

        addLog(`  ✓ ${templateLabel} generated (${outputHtml.length} chars)`);
        updatePatientByName(patient.name, {
          status: 'generated',
          generatedOutput: { html: outputHtml, templateLabel, sourceFileList },
          approved: true,
          error: null,
        });
      } catch (e) {
        addLog(`  ❌ Error for ${patient.name}: ${e.message}`, 'error');
        updatePatientByName(patient.name, { status: 'error', error: e.message, approved: false });
      }

      updateProgress(Math.round(((i + 1) / total) * 100), stepNum, total, 'Done');
    }

    setPhase(PHASE.REVIEW);
    addLog('\n✅ Generation complete — review documents before saving to Drive.');
  }

  function toggleApprove(name) {
    setPatients(prev => prev.map(p => p.name === name ? { ...p, approved: !p.approved } : p));
  }

  function updateGeneratedHtml(name, html) {
    setPatients(prev => prev.map(p =>
      p.name === name ? { ...p, generatedOutput: { ...p.generatedOutput, html } } : p
    ));
  }

  function togglePreviewMode(name) {
    setPreviewMode(prev => ({ ...prev, [name]: prev[name] === 'raw' ? 'rendered' : 'raw' }));
  }

  // ── Phase 3: Save approved documents to Drive + Supabase ────────────────
  async function handleSaveApproved() {
    const approved = patients.filter(p => p.status === 'generated' && p.approved);
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
      const patient = approved[i];
      if (abortRef.current) { addLog('\n⏹ Save cancelled.', 'warn'); break; }

      updatePatientByName(patient.name, { status: 'saving' });
      updateProgress(Math.round((i / total) * 100), i + 1, total, `Saving ${patient.name}...`);

      try {
        const { savedOutputs } = await withRetry(
          () => saveGeneratedDocument({
            patient,
            docTypeKey: selectedTemplate,
            outputHtml: patient.generatedOutput.html,
            settings,
            provider: settings.aiProvider || 'openai',
            model: settings.aiModel || undefined,
            saveDocument,
            source: 'manual',
          }),
          { retries: 2, onRetry: (e, n) => addLog(`  ⟳ Retry ${n}/2 saving ${patient.name}: ${e.message}`, 'warn') }
        );

        updatePatientByName(patient.name, { status: 'done', outputs: savedOutputs });
        auditRows.push({ name: patient.name, status: 'done', files: patient.generatedOutput.sourceFileList, outputs: savedOutputs });
        addLog(`  ✅ ${patient.name} saved — ${savedOutputs.length} file(s)`);
      } catch (e) {
        updatePatientByName(patient.name, { status: 'error', error: e.message });
        auditRows.push({ name: patient.name, status: 'error', error: e.message, files: [], outputs: [] });
        addLog(`  ❌ Save failed for ${patient.name}: ${e.message}`, 'error');
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
    setLog([]);
    setSummary(null);
    setBatchInput('');
    setExpandedFiles({});
    localStorage.removeItem(BATCH_STORAGE_KEY);
  }

  const hasAmbiguous = patients.some(p => p.status === 'ambiguous');
  const generatedForReview = patients.filter(p => p.status === 'generated' || (p.status === 'error' && phase !== PHASE.PREVIEW));

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
                const provider = settings.aiProvider || 'openai';
                const providerLabel = AI_PROVIDERS[provider]?.label || provider;
                const hasKey = isProviderConfigured(provider, getProviderKeys(settings));
                return `${providerLabel}${hasKey ? '' : ' (no key)'}`;
              })(),
              warn: !isProviderConfigured(settings.aiProvider || 'openai', getProviderKeys(settings)),
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
                Patient <span className="font-bold text-white">{progress.current}</span> of <span className="font-bold text-white">{progress.total}</span>
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
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center text-xs font-black text-violet-400">1</div>
                  <h2 className="text-sm font-black text-white">Enter Patient Names</h2>
                </div>
                <p className="text-xs text-slate-500 mb-3">One patient name per line. Names must match folder names inside PatientForms.</p>
                <textarea
                  value={batchInput}
                  onChange={e => setBatchInput(e.target.value)}
                  disabled={phase !== PHASE.IDLE}
                  rows={6}
                  placeholder={'John Smith\nJane Doe\nRobert Johnson'}
                  className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 font-mono focus:outline-none focus:border-violet-500/40 resize-none disabled:opacity-50"
                />
                <button
                  onClick={handleMatch}
                  disabled={!batchInput.trim() || !driveConnected || phase === PHASE.MATCHING}
                  className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-black transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-violet-500/20"
                >
                  {phase === PHASE.MATCHING
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning Drive…</>
                    : <><Search className="w-4 h-4" /> Match Patients to Drive Folders</>
                  }
                </button>
              </div>
            )}

            {/* Step 2: Preview & Verify Sources (+ resolve ambiguous matches) */}
            {(phase === PHASE.PREVIEW || phase === PHASE.GENERATING) && patients.length > 0 && (
              <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-teal-500/20 flex items-center justify-center text-xs font-black text-teal-400">2</div>
                  <div>
                    <h2 className="text-sm font-black text-white">Verify Source Files</h2>
                    <p className="text-[10px] text-slate-500">Click ± to see which documents will be used</p>
                  </div>
                  {phase === PHASE.PREVIEW && (
                    <span className="ml-auto text-xs text-teal-400 font-semibold">Confirm before generating</span>
                  )}
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
                      {(expandedFiles[p.name] || phase !== PHASE.PREVIEW) && p.files.length > 0 && (
                        <div className="mt-2 pl-6 space-y-1">
                          {phase === PHASE.PREVIEW && (
                            <button
                              type="button"
                              onClick={() => applyConfiguredFileRules(p.name)}
                              className="mb-1.5 px-2 py-1 rounded-md bg-teal-500/10 border border-teal-500/25 text-teal-300 text-[10px] font-bold hover:bg-teal-500/20 transition-colors"
                            >
                              Re-apply Settings Rules
                            </button>
                          )}
                          {p.files.map(f => (
                            <label key={f.id} className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={(p.selectedFileIds || []).includes(f.id)}
                                onChange={() => togglePatientSourceFile(p.name, f.id)}
                                disabled={phase !== PHASE.PREVIEW}
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

                {/* Confirm button */}
                {phase === PHASE.PREVIEW && (
                  <>
                    {hasAmbiguous && (
                      <p className="mt-3 text-xs text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Resolve all ambiguous matches above before generating.
                      </p>
                    )}
                    <button
                      onClick={handleGenerate}
                      disabled={!patients.some(p => p.status === 'matched') || hasAmbiguous}
                      className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-black transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
                    >
                      <Play className="w-4 h-4" />
                      Confirm & Generate All Documents
                      <span className="text-xs opacity-70">({patients.filter(p => p.status === 'matched').length} patients)</span>
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Step 3: Review generated documents before saving */}
            {phase === PHASE.REVIEW && (
              <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-black text-emerald-400">3</div>
                  <div>
                    <h2 className="text-sm font-black text-white">Review Before Saving</h2>
                    <p className="text-[10px] text-slate-500">Edit content if needed, then approve which documents get saved to Drive</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {generatedForReview.map(p => (
                    <div key={p.name} className={`rounded-xl border p-3 ${
                      p.status === 'error' ? 'border-red-500/30 bg-red-500/5' : 'border-white/10 bg-white/3'
                    }`}>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {p.status === 'generated' && (
                            <input
                              type="checkbox"
                              checked={p.approved}
                              onChange={() => toggleApprove(p.name)}
                              className="w-4 h-4 rounded accent-teal-500 flex-shrink-0"
                            />
                          )}
                          <span className="text-sm font-bold text-white truncate">{p.name}</span>
                          <StatusBadge status={p.status} />
                        </div>
                        {p.status === 'generated' && (
                          <button
                            onClick={() => togglePreviewMode(p.name)}
                            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors flex-shrink-0"
                          >
                            <Code className="w-3.5 h-3.5" />
                            {previewMode[p.name] === 'raw' ? 'Preview' : 'Edit HTML'}
                          </button>
                        )}
                      </div>

                      {p.status === 'error' && (
                        <p className="text-xs text-red-400">{p.error}</p>
                      )}

                      {p.status === 'generated' && (
                        previewMode[p.name] === 'raw' ? (
                          <textarea
                            value={p.generatedOutput.html}
                            onChange={e => updateGeneratedHtml(p.name, e.target.value)}
                            rows={10}
                            className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-300 font-mono focus:outline-none focus:border-teal-500/40 resize-y"
                          />
                        ) : (
                          <iframe
                            title={`preview-${p.name}`}
                            sandbox=""
                            srcDoc={p.generatedOutput.html}
                            className="w-full h-64 rounded-lg border border-white/10 bg-white"
                          />
                        )
                      )}
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleSaveApproved}
                  disabled={!patients.some(p => p.status === 'generated' && p.approved)}
                  className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-black transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
                >
                  <Save className="w-4 h-4" />
                  Save Approved Documents to Drive
                  <span className="text-xs opacity-70">
                    ({patients.filter(p => p.status === 'generated' && p.approved).length} of {patients.filter(p => p.status === 'generated').length})
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
                { label: 'Total Patients',  value: summary.length,                                     color: 'text-white' },
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
                <div key={row.name} className={`rounded-xl border p-4 ${
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
                    <span className="text-sm font-bold text-white">{row.name}</span>
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
