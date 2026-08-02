import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Zap, Power, Clock, Users, Play, Loader2, AlertTriangle,
  RadioTower, ListChecks, Info,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { findPatientFormsFolder, listSubfolders, listPatientFiles } from '../lib/googleDrive';
import { buildSystemPrompt } from '../lib/aiEngine';
import { getProviderKeys, isProviderConfigured } from '../lib/settings';
import { DOCUMENT_TYPES } from '../lib/documentTypes';
import { collectSourceText, generateDocumentForPatient, saveGeneratedDocument } from '../lib/documentPipeline';
import { withRetry } from '../lib/retry';

const INTERVAL_OPTIONS = [15, 30, 60, 120];

export default function AutoPilotPage() {
  const {
    settings, updateSettings, driveConnected,
    saveDocument, saveReport, getTemplateHtml, fetchLatestDocument,
  } = useApp();

  const autoPilot = settings.autoPilot;
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState(null);
  const [nextRunAt, setNextRunAt] = useState(null);
  const [patientListInput, setPatientListInput] = useState((autoPilot.patientList || []).join('\n'));
  const runningRef = useRef(false);

  function addLog(msg, type = 'info') {
    setLog(prev => [...prev.slice(-300), { msg, type, ts: new Date().toLocaleTimeString() }]);
  }

  function patchAutoPilot(patch) {
    updateSettings({ autoPilot: { ...settings.autoPilot, ...patch } });
  }

  // ── The autonomous cycle: scan patients, detect new/changed source files,
  //    and generate every selected document type for anyone with new content. ──
  const runCycle = useCallback(async (manual = false) => {
    if (runningRef.current) return;
    if (!driveConnected) { addLog('Google Drive not connected — skipping run.', 'error'); return; }
    if (!autoPilot.docTypes.length) { addLog('No document types selected — nothing to generate.', 'error'); return; }

    const provider = settings.aiProvider || 'gemini';
    const keys = getProviderKeys(settings);
    if (!isProviderConfigured(provider, keys)) {
      addLog(`AI provider "${provider}" has no API key configured — skipping run.`, 'error'); return;
    }

    runningRef.current = true;
    setRunning(true);
    addLog(manual ? '▶ Manual run started…' : '▶ Scheduled run started…');

    try {
      const root = await findPatientFormsFolder();
      const subfolders = await listSubfolders(root.id);

      const scoped = autoPilot.patientScope === 'list'
        ? subfolders.filter(f => (autoPilot.patientList || []).some(name =>
            f.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(f.name.toLowerCase())))
        : subfolders;

      addLog(`Scanning ${scoped.length} patient folder(s)…`);
      const lastChecked = { ...(autoPilot.lastCheckedByPatient || {}) };
      const systemPrompt = buildSystemPrompt(settings.detailLevel);
      const orderedDocTypes = DOCUMENT_TYPES.filter(t => autoPilot.docTypes.includes(t.key));
      const runStartedAt = new Date().toISOString();

      for (const folder of scoped) {
        const sinceIso = lastChecked[folder.name] || null;
        const changedFiles = await listPatientFiles(folder.id, sinceIso);

        if (changedFiles.length === 0 && sinceIso) {
          continue; // nothing new since we last generated for this patient
        }

        const allFiles = sinceIso ? await listPatientFiles(folder.id) : changedFiles;
        if (allFiles.length === 0) { lastChecked[folder.name] = runStartedAt; continue; }

        addLog(`\n━━━ ${folder.name}: ${sinceIso ? `${changedFiles.length} new file(s)` : 'first check'} ━━━`);
        const patient = { name: folder.name, folderId: folder.id, folderName: folder.name, files: allFiles };

        try {
          const { sourceText, sourceFileList } = await collectSourceText(patient, (msg, type) => addLog(`  ${msg}`, type));
          if (sourceFileList.length === 0) {
            addLog(`  No readable source files for ${folder.name}, skipping.`, 'warn');
            lastChecked[folder.name] = runStartedAt;
            continue;
          }

          for (const docType of orderedDocTypes) {
            addLog(`  🔮 Generating ${docType.label} for ${folder.name}...`);
            const { outputHtml } = await withRetry(
              () => generateDocumentForPatient({
                patient, docTypeKey: docType.key, sourceText, systemPrompt, provider, keys,
                model: settings.aiModel || undefined,
                getTemplateHtml, fetchLatestDocument,
                onLog: (msg, type) => addLog(`    ${msg}`, type),
              }),
              { retries: 2, onRetry: (e, n) => addLog(`    ⟳ Retry ${n}/2: ${e.message}`, 'warn') }
            );

            const { savedOutputs } = await withRetry(
              () => saveGeneratedDocument({
                patient, docTypeKey: docType.key, outputHtml, settings,
                provider, model: settings.aiModel || undefined,
                saveDocument, saveReport, source: 'autopilot',
              }),
              { retries: 2, onRetry: (e, n) => addLog(`    ⟳ Retry ${n}/2 saving: ${e.message}`, 'warn') }
            );

            addLog(`  ✅ ${docType.label} saved for ${folder.name} — ${savedOutputs.length} file(s)`);
          }

          lastChecked[folder.name] = runStartedAt;
        } catch (e) {
          addLog(`  ❌ ${folder.name} failed: ${e.message}`, 'error');
          // Don't advance lastChecked on failure — retry this patient's changes next cycle.
        }
      }

      patchAutoPilot({ lastCheckedByPatient: lastChecked });
      addLog('\n✅ Run complete.');
    } catch (e) {
      addLog(`Run failed: ${e.message}`, 'error');
    } finally {
      runningRef.current = false;
      setRunning(false);
      setLastRunAt(Date.now());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveConnected, settings, autoPilot, saveDocument, getTemplateHtml, fetchLatestDocument]);

  // Always call the latest runCycle from the interval below — otherwise a
  // scheduled tick could fire with a stale closure (old API key, old
  // docTypes selection) if settings changed after the timer was set up.
  const runCycleRef = useRef(runCycle);
  useEffect(() => { runCycleRef.current = runCycle; }, [runCycle]);

  // ── Scheduler ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!autoPilot.enabled) { setNextRunAt(null); return; }
    const intervalMs = autoPilot.intervalMinutes * 60 * 1000;
    setNextRunAt(Date.now() + intervalMs);
    const id = setInterval(() => {
      runCycleRef.current(false);
      setNextRunAt(Date.now() + intervalMs);
    }, intervalMs);
    return () => clearInterval(id);
  }, [autoPilot.enabled, autoPilot.intervalMinutes]);

  function toggleDocType(key) {
    const current = autoPilot.docTypes || [];
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
    patchAutoPilot({ docTypes: next });
  }

  function savePatientList() {
    const list = patientListInput.split('\n').map(s => s.trim()).filter(Boolean);
    patchAutoPilot({ patientList: list });
  }

  return (
    <div className="min-h-full bg-slate-950 p-6">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white">AutoPilot</h1>
            <p className="text-xs text-slate-500">Watches PatientForms and generates documents automatically — no manual review step.</p>
          </div>
        </div>

        {!driveConnected && (
          <div className="mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 flex gap-3 items-start">
            <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300/80 leading-relaxed">
              Connect Google Drive in <a href="/settings" className="underline hover:text-white">Settings</a> before enabling AutoPilot.
            </p>
          </div>
        )}

        {/* Enable / status */}
        <div className={`rounded-2xl border p-5 mb-5 flex items-center gap-4 ${
          autoPilot.enabled ? 'border-emerald-500/30 bg-emerald-500/8' : 'border-white/10 bg-slate-900'
        }`}>
          <button
            onClick={() => patchAutoPilot({ enabled: !autoPilot.enabled })}
            disabled={!driveConnected}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              autoPilot.enabled ? 'bg-emerald-600 text-white' : 'bg-white/10 text-slate-300 hover:bg-white/15'
            }`}
          >
            <Power className="w-4 h-4" />
            {autoPilot.enabled ? 'AutoPilot ON' : 'AutoPilot OFF'}
          </button>

          <div className="flex-1 min-w-0">
            {autoPilot.enabled ? (
              <div className="flex items-center gap-2 text-xs text-emerald-300">
                <RadioTower className={`w-3.5 h-3.5 ${running ? 'animate-pulse' : ''}`} />
                {running
                  ? 'Running now…'
                  : nextRunAt
                    ? `Next check ~${new Date(nextRunAt).toLocaleTimeString()}`
                    : 'Waiting for next check'}
                {lastRunAt && !running && (
                  <span className="text-slate-500">· last run {new Date(lastRunAt).toLocaleTimeString()}</span>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Enable to start watching automatically. Requires this tab to stay open.</p>
            )}
          </div>

          <button
            onClick={() => runCycle(true)}
            disabled={running || !driveConnected}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs font-bold transition-all disabled:opacity-40"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Run Now
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Config */}
          <div className="space-y-5">
            {/* Document types (multiple!) */}
            <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <ListChecks className="w-4 h-4 text-teal-400" />
                <h2 className="text-sm font-black text-white">Document Types to Auto-Generate</h2>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Select one or more. When new source files are detected for a patient, every selected type is generated in one run.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {DOCUMENT_TYPES.map(t => {
                  const checked = autoPilot.docTypes.includes(t.key);
                  return (
                    <label
                      key={t.key}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                        checked ? 'border-teal-500/40 bg-teal-500/10 text-teal-200' : 'border-white/10 bg-white/3 text-slate-400 hover:bg-white/6'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDocType(t.key)}
                        className="w-4 h-4 rounded accent-teal-500"
                      />
                      <span className="text-xs font-bold">{t.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Interval */}
            <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-violet-400" />
                <h2 className="text-sm font-black text-white">Check Interval</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {INTERVAL_OPTIONS.map(min => (
                  <button
                    key={min}
                    onClick={() => patchAutoPilot({ intervalMinutes: min })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      autoPilot.intervalMinutes === min
                        ? 'bg-violet-600 border-violet-500 text-white'
                        : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                    }`}
                  >
                    Every {min < 60 ? `${min}m` : `${min / 60}h`}
                  </button>
                ))}
              </div>
            </div>

            {/* Scope */}
            <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-blue-400" />
                <h2 className="text-sm font-black text-white">Patient Scope</h2>
              </div>
              <div className="flex gap-2 mb-3">
                {[
                  { id: 'all',  label: 'All patients in PatientForms' },
                  { id: 'list', label: 'Specific patients' },
                ].map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => patchAutoPilot({ patientScope: opt.id })}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border transition-all ${
                      autoPilot.patientScope === opt.id
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {autoPilot.patientScope === 'list' && (
                <div>
                  <textarea
                    value={patientListInput}
                    onChange={e => setPatientListInput(e.target.value)}
                    onBlur={savePatientList}
                    rows={4}
                    placeholder={'John Smith\nJane Doe'}
                    className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-blue-500/40 resize-none"
                  />
                  <p className="text-[10px] text-slate-600 mt-1">One name per line. Saved automatically on blur.</p>
                </div>
              )}
            </div>
          </div>

          {/* Activity log */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 flex flex-col h-full min-h-[420px]">
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-2 h-2 rounded-full ${running ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}`} />
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-wider">Activity Log</h2>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 font-mono text-[11px]">
              {log.length === 0 && (
                <p className="text-slate-600 italic">No runs yet. Enable AutoPilot or click "Run Now".</p>
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

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/3 px-5 py-4 flex gap-3 items-start">
          <AlertTriangle className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-slate-500 leading-relaxed">
            AutoPilot runs in this browser tab — it checks on a timer while the tab is open and pauses if you close it.
            Documents it generates are saved straight to Drive and Supabase with no review step, and are tagged{' '}
            <code className="font-mono text-slate-400">source = "autopilot"</code> so they're distinguishable from manually
            generated ones. Use the Batch Processor instead when you want to review AI output before it's saved.
          </p>
        </div>
      </div>
    </div>
  );
}
