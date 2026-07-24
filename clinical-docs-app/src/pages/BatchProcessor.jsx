import { useState, useRef } from 'react';
import {
  ClipboardList, Search, CheckCircle2, AlertTriangle, ChevronRight,
  Play, Loader2, Download, FileText, FilePlus, SkipForward, Eye,
  FolderOpen, List, RefreshCw, XCircle, UploadCloud, Info, Heart, Calendar
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  findPatientFormsFolder, listSubfolders, listPatientFiles,
  downloadFileText, uploadFile
} from '../lib/googleDrive';
import {
  buildSystemPrompt, buildTreatmentPlanPrompt, buildDARPPrompt,
  generateClinicalDocument, extractPdfText, AI_PROVIDERS
} from '../lib/aiEngine';
import { applyNamingConvention, getProviderKeys } from '../lib/settings';

const PHASE = { IDLE: 'idle', MATCHING: 'matching', PREVIEW: 'preview', GENERATING: 'generating', DONE: 'done' };

function StatusBadge({ status }) {
  const map = {
    pending:    { color: 'bg-slate-700 text-slate-300',     label: 'Pending' },
    matched:    { color: 'bg-blue-500/20 text-blue-300',    label: 'Matched' },
    not_found:  { color: 'bg-red-500/20 text-red-400',      label: 'Folder Not Found' },
    processing: { color: 'bg-amber-500/20 text-amber-300',  label: 'Processing…' },
    pass1:      { color: 'bg-violet-500/20 text-violet-300',label: 'Pass 1: Treatment Plan' },
    pass2:      { color: 'bg-teal-500/20 text-teal-300',    label: 'Pass 2: DARP Note' },
    saving:     { color: 'bg-blue-500/20 text-blue-300',    label: 'Saving to Drive…' },
    done:       { color: 'bg-emerald-500/20 text-emerald-300', label: 'Complete' },
    error:      { color: 'bg-red-500/20 text-red-400',      label: 'Error' },
    skipped:    { color: 'bg-slate-600/20 text-slate-400',  label: 'Skipped' },
  };
  const { color, label } = map[status] || map.pending;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>
      {status === 'processing' || status === 'pass1' || status === 'pass2' || status === 'saving'
        ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
        : null}
      {label}
    </span>
  );
}

const TEMPLATES = [
  { id: 'treatment_plan', label: 'Treatment Plan',        file: 'treatment_plan.html', icon: Heart,         prompt: buildTreatmentPlanPrompt },
  { id: 'session_note',   label: 'DARP Progress Note',    file: 'session_note.html',   icon: ClipboardList, prompt: buildDARPPrompt },
  { id: 'pre_intake',     label: 'Pre-Intake Brief',       file: 'PreIntake.html',      icon: FileText,      prompt: null },
  { id: 'follow_up',      label: 'Follow-Up Visit',       file: 'follow_up.html',      icon: Calendar,      prompt: null },
];

export default function BatchProcessor() {
  const { settings, driveConnected, saveDocument, saveReport } = useApp();
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [batchInput, setBatchInput] = useState('');
  const [patients, setPatients] = useState([]);  // { name, folderId, folderName, files[], status, error, outputs[] }
  const [patientFormsId, setPatientFormsId] = useState(null);
  const [log, setLog] = useState([]);
  const [summary, setSummary] = useState(null);
  const [expandedFiles, setExpandedFiles] = useState({});
  const abortRef = useRef(false);

  // Template selection (ONE at a time)
  const [selectedTemplate, setSelectedTemplate] = useState('treatment_plan');

  // Progress tracking
  const [progress, setProgress] = useState({ percent: 0, current: 0, total: 0, step: '' });

  function addLog(msg, type = 'info') {
    setLog(prev => [...prev, { msg, type, ts: new Date().toLocaleTimeString() }]);
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
      setPatientFormsId(root.id);
      addLog(`Found PatientForms (ID: ${root.id})`);

      const subfolders = await listSubfolders(root.id);
      addLog(`Found ${subfolders.length} patient subfolders`);

      const result = await Promise.all(names.map(async (name) => {
        const match = subfolders.find(f =>
          f.name.toLowerCase().includes(name.toLowerCase()) ||
          name.toLowerCase().includes(f.name.toLowerCase())
        );
        if (!match) {
          addLog(`⚠ "${name}" — Folder Not Found`, 'warn');
          return { name, status: 'not_found', folderId: null, folderName: null, files: [], outputs: [], error: 'Folder Not Found' };
        }
        const files = await listPatientFiles(match.id);
        addLog(`✓ "${name}" → "${match.name}" (${files.length} target files)`);
        return { name, status: 'matched', folderId: match.id, folderName: match.name, files, outputs: [], error: null };
      }));

      setPatients(result);
      setPhase(PHASE.PREVIEW);
    } catch (e) {
      addLog(`Error: ${e.message}`, 'error');
      setPhase(PHASE.IDLE);
    }
  }

  function toggleFileExpand(name) {
    setExpandedFiles(prev => ({ ...prev, [name]: !prev[name] }));
  }

  function updateProgress(percent, current, total, step) {
    setProgress({ percent, current, total, step });
  }

  // ─=== Phase 3: Sequential generation ===
  async function handleGenerate() {
    const confirmed = patients.filter(p => p.status === 'matched');
    if (confirmed.length === 0) {
      addLog('No matched patients to generate for.', 'error');
      return;
    }

    const template = TEMPLATES.find(t => t.id === selectedTemplate);
    if (!template) {
      addLog('No template selected.', 'error');
      return;
    }

    const provider = settings.aiProvider || 'openai';
    const keys = getProviderKeys(settings);

    // Validate provider credentials
    if (provider === 'openai' && !keys.openaiApiKey) {
      addLog('OpenAI API key not configured. Go to Settings.', 'error'); return;
    }
    if (provider === 'gemini' && !keys.geminiApiKey) {
      addLog('Gemini API key not configured. Go to Settings.', 'error'); return;
    }
    if (provider === 'claude' && !keys.claudeApiKey) {
      addLog('Claude API key not configured. Go to Settings.', 'error'); return;
    }
    if (provider === 'ollama_cloud' && !keys.ollamaCloudApiKey) {
      addLog('Ollama Cloud API key not configured. Go to Settings.', 'error'); return;
    }

    setPhase(PHASE.GENERATING);
    abortRef.current = false;
    const auditRows = [];

    // Progress: total patients
    const totalToProcess = confirmed.length;
    updateProgress(0, 0, totalToProcess, 'Starting...');

    // Load template
    addLog(`Loading template: ${template.label}...`);
    const templateHtml = await fetch(`/templates/${template.file}`).then(r => r.text());
    addLog(`✓ Template loaded`);

    const systemPrompt = buildSystemPrompt(settings.detailLevel);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    for (let i = 0; i < confirmed.length; i++) {
      const patient = confirmed[i];
      if (abortRef.current) break;

      const stepNum = i + 1;
      updateProgress(
        Math.round((i / totalToProcess) * 100),
        stepNum,
        totalToProcess,
        `Processing ${patient.name}...`
      );

      updatePatient(patients.findIndex(p => p.name === patient.name), { status: 'processing' });
      addLog(`\n━━━ ${stepNum}/${totalToProcess}: ${patient.name} ━━━`);

      try {
        // ── Collect source text ──
        let sourceText = `PATIENT: ${patient.name}\n\n`;
        const sourceFileList = [];

        for (const file of patient.files) {
          try {
            addLog(`  📄 Reading: ${file.name}`);
            const content = await downloadFileText(file.id, file.mimeType);
            let text;
            if (content instanceof ArrayBuffer) {
              text = await extractPdfText(content);
            } else {
              text = content;
            }
            sourceText += `\n--- ${file.name} ---\n${text}\n`;
            sourceFileList.push(file.name);
            addLog(`  ✓ Read ${file.name} (${text?.length || 0} chars)`);
          } catch (e) {
            addLog(`  ⚠ Could not read ${file.name}: ${e.message}`, 'warn');
          }
        }

        if (sourceFileList.length === 0) {
          addLog(`  ✅ No source files found for ${patient.name}, skipping.`);
          auditRows.push({ name: patient.name, status: 'skipped', files: [], outputs: [], reason: 'No source files' });
          continue;
        }

        addLog(`  ✓ Using ${sourceFileList.length} source file(s): ${sourceFileList.join(', ')}`);

        // ── Generate document ──
        updateProgress(
          Math.round(((i + 0.5) / totalToProcess) * 100),
          stepNum,
          totalToProcess,
          `Generating ${template.label} for ${patient.name}...`
        );

        addLog(`  🔮 Generating ${template.label}...`);

        let userPrompt;
        if (template.id === 'treatment_plan') {
          userPrompt = buildTreatmentPlanPrompt(sourceText, templateHtml);
        } else if (template.id === 'session_note') {
          // For DARP, we need the Treatment Plan - try to get it or use empty
          userPrompt = buildDARPPrompt(sourceText, '', templateHtml);
        } else {
          userPrompt = sourceText + `\n\nGenerate a clinical document based on the above patient information using the provided template structure.`;
        }

        let outputHtml = '';
        outputHtml = await generateClinicalDocument({
          provider,
          keys,
          model: settings.aiModel || undefined,
          systemPrompt,
          userPrompt,
          onChunk: (_, full) => {
            // Could show partial progress here if needed
          },
        });

        addLog(`  ✓ ${template.label} generated (${outputHtml.length} chars)`);

        // ── Save to Drive ──
        updateProgress(
          Math.round(((i + 0.75) / totalToProcess) * 100),
          stepNum,
          totalToProcess,
          `Saving to Drive...`
        );

        const lastName = patient.name.split(' ').pop();
        const fileName = `${lastName}_${today}_${template.id}`;

        const savedOutputs = [];
        const formats = settings.outputFormat === 'Both' ? ['HTML'] : [settings.outputFormat];
        for (const fmt of formats) {
          if (fmt === 'HTML' || fmt === 'Both') {
            const file = await uploadFile(patient.folderId, `${fileName}.html`, outputHtml, 'text/html');
            addLog(`  ✓ Saved: ${fileName}.html`);
            savedOutputs.push({ name: `${fileName}.html`, id: file.id, link: file.webViewLink, type: template.label });
          }
          if (settings.outputFormat === 'PDF' || settings.outputFormat === 'Both') {
            const file = await uploadFile(patient.folderId, `${fileName}.pdf.html`, outputHtml, 'text/html');
            savedOutputs.push({ name: `${fileName}.pdf.html`, id: file.id, link: file.webViewLink, type: `${template.label} (PDF-ready)` });
          }
        }

        updateProgress(
          Math.round(((i + 1) / totalToProcess) * 100),
          stepNum + 1,
          totalToProcess,
          'Done'
        );

        // ── Save to Supabase ──
        const driveLink = savedOutputs[0]?.link || null;
        await saveDocument({
          patient_name:   patient.name,
          document_type:  template.id,
          content_html:   outputHtml,
          ai_provider:    provider,
          ai_model:       settings.aiModel || undefined,
          output_format:  settings.outputFormat,
          drive_file_url: driveLink,
        });

        updatePatient(patients.findIndex(p => p.name === patient.name), { status: 'done', outputs: savedOutputs });
        auditRows.push({ name: patient.name, status: 'done', files: sourceFileList, outputs: savedOutputs });
        addLog(`  ✅ ${patient.name} complete — ${savedOutputs.length} file(s) saved`);

      } catch (e) {
        addLog(`  ❌ Error for ${patient.name}: ${e.message}`, 'error');
        updatePatient(patients.findIndex(p => p.name === patient.name), { status: 'error', error: e.message });
        auditRows.push({ name: patient.name, status: 'error', error: e.message, files: [], outputs: [] });
      }
    }

    updateProgress(100, totalToProcess, totalToProcess, 'Complete');
    setSummary(auditRows);
    setPhase(PHASE.DONE);
    addLog('\n✅ Batch processing complete.');
  }

  // ── Phase 3: Sequential generation ───────────────────────────────────────
  function updatePatient(index, patch) {
    setPatients(prev => prev.map((p, i) => i === index ? { ...p, ...patch } : p));
  }

  function handleReset() {
    setPhase(PHASE.IDLE);
    setPatients([]);
    setLog([]);
    setSummary(null);
    setBatchInput('');
    setExpandedFiles({});
  }

  return (
    <div className="min-h-full bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto">

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
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white text-xs font-bold transition-colors border border-white/10"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reset
            </button>
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
                const keys = getProviderKeys(settings);
                const hasKey = provider === 'openai' ? !!keys.openaiApiKey
                  : provider === 'gemini' ? !!keys.geminiApiKey
                  : provider === 'claude' ? !!keys.claudeApiKey
                  : provider === 'ollama_cloud' ? !!keys.ollamaCloudApiKey
                  : true; // Ollama local needs no key
                return `${providerLabel}${hasKey ? '' : ' (no key)'}`;
              })(),
              warn: (() => {
                const provider = settings.aiProvider || 'openai';
                const keys = getProviderKeys(settings);
                return provider === 'openai' ? !keys.openaiApiKey
                  : provider === 'gemini' ? !keys.geminiApiKey
                  : provider === 'claude' ? !keys.claudeApiKey
                  : provider === 'ollama_cloud' ? !keys.ollamaCloudApiKey
                  : false;
              })(),
            },
          ].map(({ label, value, warn }) => (
            <div key={label} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold ${warn ? 'bg-red-500/10 border-red-500/25 text-red-400' : 'bg-white/5 border-white/10 text-slate-300'}`}>
              <span className="text-slate-500">{label}:</span> {value}
              {warn && <AlertTriangle className="w-3 h-3" />}
            </div>
          ))}
        </div>

        {/* Template Selector */}
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-full bg-teal-500/20 flex items-center justify-center text-xs font-black text-teal-400">
              <FileText className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-sm font-black text-white">Select Document Type</h2>
          </div>
          <p className="text-xs text-slate-500 mb-3">Choose which type of clinical document to generate for this batch.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {TEMPLATES.map(t => {
              const Icon = t.icon;
              const isSelected = selectedTemplate === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedTemplate(t.id)}
                  disabled={phase === PHASE.GENERATING}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl border text-center transition-all ${
                    isSelected
                      ? `bg-gradient-to-br ${t.id === 'session_note' ? 'from-teal-600 to-emerald-600' : t.id === 'treatment_plan' ? 'from-blue-600 to-indigo-600' : t.id === 'pre_intake' ? 'from-violet-600 to-purple-600' : 'from-rose-600 to-pink-600'} text-white shadow-lg border-white/20`
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
        {phase === PHASE.GENERATING && (
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 text-teal-400 animate-spin" />
                <h2 className="text-sm font-black text-white">Generating Documents</h2>
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
                placeholder={"John Smith\nJane Doe\nRobert Johnson"}
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

            {/* Step 2: Preview & Verify Sources */}
            {(phase === PHASE.PREVIEW || phase === PHASE.GENERATING || phase === PHASE.DONE) && patients.length > 0 && (
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
                      p.status === 'not_found' ? 'border-red-500/30 bg-red-500/5'
                      : p.status === 'done' ? 'border-emerald-500/30 bg-emerald-500/5'
                      : p.status === 'error' ? 'border-red-500/30 bg-red-500/5'
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

                      {/* File list */}
                      {(expandedFiles[p.name] || phase !== PHASE.PREVIEW) && p.files.length > 0 && (
                        <div className="mt-2 pl-6 space-y-1">
                          {p.files.map(f => (
                            <div key={f.id} className="flex items-center gap-1.5 text-xs text-slate-400">
                              <FileText className="w-3 h-3 flex-shrink-0" />
                              {f.name}
                              <span className="text-slate-600 text-[10px]">({f.mimeType?.split('/').pop()})</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {p.status === 'not_found' && (
                        <p className="mt-1.5 pl-6 text-xs text-red-400 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> No matching folder found in PatientForms. This patient will be skipped.
                        </p>
                      )}
                      {p.status === 'error' && p.error && (
                        <p className="mt-1.5 pl-6 text-xs text-red-400">{p.error}</p>
                      )}
                      {p.status === 'done' && p.outputs.length > 0 && (
                        <div className="mt-2 pl-6 space-y-1">
                          {p.outputs.map(o => (
                            <a key={o.id} href={o.link} target="_blank" rel="noreferrer"
                              className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                              <CheckCircle2 className="w-3 h-3" /> {o.name}
                              <Eye className="w-3 h-3 ml-1 opacity-60" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Confirm button */}
                {phase === PHASE.PREVIEW && (
                  <button
                    onClick={handleGenerate}
                    disabled={!patients.some(p => p.status === 'matched')}
                    className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-black transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
                  >
                    <Play className="w-4 h-4" />
                    Confirm & Generate All Documents
                    <span className="text-xs opacity-70">({patients.filter(p => p.status === 'matched').length} patients)</span>
                  </button>
                )}
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
