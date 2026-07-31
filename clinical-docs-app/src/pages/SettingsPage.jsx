import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Settings, Key, HardDrive, FileOutput, AlignLeft, Tag, CheckCircle,
  Eye, EyeOff, Wifi, WifiOff, AlertTriangle, Bot, ChevronDown, ExternalLink,
  Save, Lock, Calendar as CalendarIcon
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  initGoogleAuth, saveClientId, loadClientId, hasCalendarScope, reconnectGoogleAuth,
} from '../lib/googleDrive';
import { applyNamingConvention } from '../lib/settings';
import { AI_PROVIDERS } from '../lib/aiEngine';
import { DOCUMENT_TYPES } from '../lib/documentTypes';
import PresetManager from '../components/PresetManager';

const OUTPUT_FORMATS = ['HTML', 'PDF', 'Both'];
const DETAIL_LEVELS  = ['Standard', 'Highly Detailed', 'Bulleted Summary'];

const PROVIDER_COLORS = {
  openai:       'from-emerald-500 to-teal-500',
  gemini:       'from-blue-500 to-indigo-600',
  claude:       'from-orange-500 to-amber-500',
  ollama:       'from-purple-500 to-violet-600',
  ollama_cloud: 'from-sky-500 to-cyan-500',
};

const PROVIDER_BG = {
  openai:       'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
  gemini:       'bg-blue-500/10 border-blue-500/30 text-blue-300',
  claude:       'bg-orange-500/10 border-orange-500/30 text-orange-300',
  ollama:       'bg-purple-500/10 border-purple-500/30 text-purple-300',
  ollama_cloud: 'bg-sky-500/10 border-sky-500/30 text-sky-300',
};

function SecretInput({ value, onChange, onBlurSave, placeholder, label, hint }) {
  const [show, setShow] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // Track internal value so blur always gets the freshest value
  const [internal, setInternal] = useState(value);

  // Keep in sync when parent resets
  useEffect(() => { setInternal(value); }, [value]);

  function handleChange(e) {
    setInternal(e.target.value);
    onChange(e.target.value);
  }

  function handleBlur() {
    if (onBlurSave) {
      onBlurSave(internal);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Lock className="w-3 h-3" /> {label}
        </label>
        {justSaved && (
          <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Auto-saved
          </span>
        )}
      </div>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={internal}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 pr-11 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/50 font-mono transition-colors"
        />
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {hint && !internal && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
      {internal && !justSaved && (
        <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
          <CheckCircle className="w-3 h-3" /> Stored in browser
        </p>
      )}
    </div>
  );
}

function PlainInput({ value, onChange, placeholder, label }) {
  return (
    <div>
      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/50 font-mono"
      />
    </div>
  );
}

/** Shown in place of a key input for providers whose API key lives server-side
 *  as a Supabase Edge Function secret — there is nothing for the user to enter. */
function ServerManagedNotice({ providerLabel, secretName, functionName }) {
  return (
    <div className="rounded-xl bg-sky-500/10 border border-sky-500/25 px-4 py-3 flex gap-3 items-start">
      <Lock className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
      <p className="text-xs text-sky-300/90 leading-relaxed">
        <strong className="text-sky-300">{providerLabel}'s key is managed by the server</strong> — there's nothing to
        enter here. It must be configured once by the deployment administrator as the{' '}
        <code className="font-mono text-sky-200">{secretName}</code> secret on the{' '}
        <code className="font-mono text-sky-200">{functionName}</code> Supabase Edge Function; this browser can't
        verify that it's been set, only the app maintainer can confirm it.
      </p>
    </div>
  );
}

/** Per-document-type approximate filename matching rules editor. */
function SourceFileRulesEditor({ value, onChange }) {
  function updateType(key, rules) {
    onChange({ ...value, [key]: rules });
  }

  function addRule(key, rules) {
    updateType(key, [...rules, { id: `rule_${Date.now()}`, label: 'New rule', enabled: true, required: false, patterns: [] }]);
  }

  function updateRule(key, rules, index, patch) {
    const next = [...rules];
    next[index] = { ...next[index], ...patch };
    updateType(key, next);
  }

  function removeRule(key, rules, index) {
    updateType(key, rules.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-4">
      {DOCUMENT_TYPES.map(type => {
        const rules = value?.[type.key] || [];
        return (
          <div key={type.key} className="rounded-xl border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-black text-white">{type.label}</h3>
                <p className="text-[11px] text-slate-500">Approximate filename patterns, separated by commas.</p>
              </div>
              <button
                type="button"
                onClick={() => addRule(type.key, rules)}
                className="px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition-colors"
              >
                Add Rule
              </button>
            </div>
            {rules.length === 0 && (
              <p className="text-xs text-slate-600 italic">No rules — every discovered file will be preselected.</p>
            )}
            <div className="space-y-3">
              {rules.map((rule, index) => (
                <div key={rule.id || index} className="rounded-lg bg-slate-950/50 border border-white/5 p-3">
                  <input
                    type="text"
                    value={rule.label || ''}
                    onChange={e => updateRule(type.key, rules, index, { label: e.target.value })}
                    placeholder="Rule name"
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-teal-500/40"
                  />
                  <input
                    type="text"
                    value={(rule.patterns || []).join(', ')}
                    onChange={e => updateRule(type.key, rules, index, { patterns: e.target.value.split(',').map(v => v.trim()).filter(Boolean) })}
                    placeholder="zoom note, transcript, session summary"
                    className="mt-2 w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-teal-500/40"
                  />
                  <div className="mt-2 flex items-center gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-slate-300">
                      <input type="checkbox" checked={rule.enabled !== false} onChange={e => updateRule(type.key, rules, index, { enabled: e.target.checked })} className="accent-teal-500" />
                      Enabled
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-300">
                      <input type="checkbox" checked={Boolean(rule.required)} onChange={e => updateRule(type.key, rules, index, { required: e.target.checked })} className="accent-rose-500" />
                      Required
                    </label>
                    <button
                      type="button"
                      onClick={() => removeRule(type.key, rules, index)}
                      className="ml-auto text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function SettingsPage() {
  const { settings, updateSettings, driveConnected, connectDrive, disconnectDrive, user } = useApp();

  const envClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

  const [saved, setSaved]                 = useState(false);
  const [providerSaved, setProviderSaved] = useState(false);
  const [driveClientId, setDriveClientId] = useState(loadClientId);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [driveError, setDriveError]       = useState('');
  const [calendarConnecting, setCalendarConnecting] = useState(false);
  const [calendarError, setCalendarError] = useState('');
  const [selectedDocTypeForPreset, setSelectedDocTypeForPreset] = useState('session_note');

  const [form, setForm] = useState(() => {
    // Resolve aiModel: if empty, use the provider's default so it's always explicit
    const provider = settings.aiProvider || 'openai';
    const resolvedModel = settings.aiModel || AI_PROVIDERS[provider]?.defaultModel || '';
    return {
      aiProvider:        provider,
      aiModel:           resolvedModel,
      openaiApiKey:      settings.openaiApiKey,
      ollamaUrl:         settings.ollamaUrl,
      ollamaModel:       settings.ollamaModel,
      outputFormat:      settings.outputFormat,
      detailLevel:       settings.detailLevel,
      namingTreatmentPlan: settings.namingConvention.treatmentPlan,
      namingDarp:          settings.namingConvention.darp,
      sourceFiles:         settings.sourceFiles || {},
    };
  });

  function set(field, value) { setForm(p => ({ ...p, [field]: value })); setSaved(false); }

  // Build the full settings object from current form state
  function buildSettingsFromForm(f) {
    // Always store an explicit model, never an empty string
    const resolvedModel = f.aiModel || AI_PROVIDERS[f.aiProvider]?.defaultModel || '';
    return {
      aiProvider:        f.aiProvider,
      aiModel:           resolvedModel,
      openaiApiKey:      f.openaiApiKey,
      ollamaUrl:         f.ollamaUrl,
      ollamaModel:       f.ollamaModel,
      outputFormat:      f.outputFormat,
      detailLevel:       f.detailLevel,
      namingConvention: {
        treatmentPlan: f.namingTreatmentPlan,
        darp:          f.namingDarp,
      },
      sourceFiles: f.sourceFiles,
    };
  }

  // Auto-save a single key field immediately on blur — receives the latest value directly
  // Keep a ref to the latest form so autoSaveKey always sees fresh values
  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; }, [form]);

  const autoSaveKey = useCallback((field, value) => {
    const next = { ...formRef.current, [field]: value };
    setForm(next);
    updateSettings(buildSettingsFromForm(next));
  }, [updateSettings]);

  function handleSave() {
    updateSettings(buildSettingsFromForm(form));
    saveClientId(driveClientId);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handleConnectDrive() {
    if (!driveClientId.trim()) { setDriveError('Please enter your Google OAuth2 Client ID.'); return; }
    setDriveError('');
    setDriveConnecting(true);
    try {
      saveClientId(driveClientId);
      const token = await initGoogleAuth(driveClientId);
      connectDrive(token);
    } catch (e) {
      setDriveError(`Connection failed: ${e.message || e.error || 'Unknown error'}`);
    } finally {
      setDriveConnecting(false);
    }
  }

  async function handleConnectCalendar() {
    const clientId = loadClientId();
    if (!clientId) { setCalendarError('Connect Google Drive first — Calendar reuses the same OAuth Client ID.'); return; }
    setCalendarError('');
    setCalendarConnecting(true);
    try {
      const token = await reconnectGoogleAuth(clientId);
      connectDrive(token); // same token now covers both scopes; keeps context state in sync
    } catch (e) {
      setCalendarError(`Connection failed: ${e.message || e.error || 'Unknown error'}`);
    } finally {
      setCalendarConnecting(false);
    }
  }

  const today      = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const ext        = form.outputFormat === 'PDF' ? '.pdf' : '.html';
  const extBoth    = '.html / .pdf';
  const previewExt = form.outputFormat === 'Both' ? extBoth : ext;
  const previewTp   = applyNamingConvention(form.namingTreatmentPlan, 'Smith', today) + previewExt;
  const previewDarp = applyNamingConvention(form.namingDarp, 'Smith', today) + previewExt;

  const activeProvider = AI_PROVIDERS[form.aiProvider];
  const providerModels = activeProvider?.models || [];

  // When switching providers, preserve saved model for that provider if known;
  // only reset to default when genuinely switching to a new provider.
  function selectProvider(id) {
    const providerModelList = AI_PROVIDERS[id]?.models || [];
    const savedModel = settings.aiProvider === id ? settings.aiModel : '';
    const model = (savedModel && providerModelList.includes(savedModel))
      ? savedModel
      : (AI_PROVIDERS[id]?.defaultModel || '');
    const next = { ...form, aiProvider: id, aiModel: model };
    setForm(next);
    updateSettings(buildSettingsFromForm(next));
    setSaved(false);
    setProviderSaved(true);
    setTimeout(() => setProviderSaved(false), 2000);
  }

  // When changing model, auto-save immediately
  function selectModel(model) {
    const next = { ...form, aiModel: model };
    setForm(next);
    updateSettings(buildSettingsFromForm(next));
    setSaved(false);
    setProviderSaved(true);
    setTimeout(() => setProviderSaved(false), 2000);
  }

  function handleApplyPreset(presetSettings) {
    const next = {
      ...form,
      aiProvider: presetSettings.aiProvider || form.aiProvider,
      aiModel: presetSettings.aiModel || form.aiModel,
      detailLevel: presetSettings.detailLevel || form.detailLevel,
      outputFormat: presetSettings.outputFormat || form.outputFormat,
      sourceFiles: presetSettings.sourceFileRules || form.sourceFiles,
    };
    setForm(next);
    updateSettings(buildSettingsFromForm(next));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="min-h-full bg-slate-950 p-6">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <img src="/logo.png" alt="IP" className="w-12 h-12 object-contain" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-400 mb-0.5">Integrative Psychiatry</p>
            <h1 className="text-xl font-black text-white">Settings</h1>
            <p className="text-xs text-slate-500">
              AI provider, API keys, output format, and naming conventions
              {user?.email && <span className="ml-2 text-slate-600">· {user.email}</span>}
            </p>
          </div>
        </div>

        <div className="space-y-5">

          {/* ── AI PROVIDER SELECTOR ── */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Bot className="w-4 h-4 text-violet-400" />
              <h2 className="text-sm font-black text-white uppercase tracking-wider">AI Provider</h2>
              {providerSaved && (
                <span className="ml-auto text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Auto-saved
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mb-4">Select which AI model to use for clinical document generation.</p>

            {/* Provider cards — 3 columns on small, 5 on wide */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-5">
              {Object.values(AI_PROVIDERS).map(p => (
                <button
                  key={p.id}
                  onClick={() => selectProvider(p.id)}
                  className={`relative flex flex-col items-center gap-2 py-4 px-2 rounded-xl border-2 transition-all font-bold text-sm ${
                    form.aiProvider === p.id
                      ? `border-transparent bg-gradient-to-br ${PROVIDER_COLORS[p.id]} text-white shadow-lg`
                      : 'border-white/10 bg-white/3 text-slate-400 hover:text-white hover:bg-white/8'
                  }`}
                >
                  <span className="text-2xl">{p.logo}</span>
                  <span className="text-[10px] font-black text-center leading-tight">{p.label}</span>
                  {form.aiProvider === p.id && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white rounded-full flex items-center justify-center">
                      <CheckCircle className="w-3 h-3 text-emerald-600" />
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Active provider badge */}
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold mb-5 ${PROVIDER_BG[form.aiProvider] || 'bg-white/5 border-white/10 text-slate-300'}`}>
              <span>{activeProvider?.logo}</span>
              Active: {activeProvider?.label}
            </div>

            {/* Model selector */}
            <div className="mb-4">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                Model
              </label>
              <div className="relative">
                <select
                  value={form.aiModel || activeProvider?.defaultModel || ''}
                  onChange={e => selectModel(e.target.value)}
                  className="w-full appearance-none bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 pr-10 text-sm text-white focus:outline-none focus:border-violet-500/50"
                >
                  {providerModels.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              </div>
              <p className="text-[11px] text-slate-600 mt-1.5 flex items-center gap-1">
                <CheckCircle className="w-3 h-3 text-slate-700" />
                Model choice saves automatically
              </p>
            </div>

            {/* Per-provider credential fields */}
            <div className="space-y-4 pt-4 border-t border-white/10">

              {/* OpenAI */}
              {form.aiProvider === 'openai' && (<>
                <p className="text-xs text-slate-500">
                  Get your API key at{' '}
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer"
                    className="text-emerald-400 hover:underline inline-flex items-center gap-0.5">
                    platform.openai.com <ExternalLink className="w-3 h-3" />
                  </a>
                </p>
                <SecretInput
                  value={form.openaiApiKey}
                  onChange={v => set('openaiApiKey', v)}
                  onBlurSave={v => autoSaveKey('openaiApiKey', v)}
                  placeholder="sk-..."
                  label="OpenAI API Key"
                />
              </>)}

              {/* Gemini — key is a Supabase Edge Function secret, not entered here */}
              {form.aiProvider === 'gemini' && (
                <ServerManagedNotice providerLabel="Gemini" secretName="GEMINI_API_KEY" functionName="notes_gemini-proxy" />
              )}

              {/* Claude — key is a Supabase Edge Function secret, not entered here */}
              {form.aiProvider === 'claude' && (
                <ServerManagedNotice providerLabel="Claude" secretName="CLAUDE_API_KEY" functionName="notes_claude-proxy" />
              )}

              {/* Ollama Local */}
              {form.aiProvider === 'ollama' && (<>
                <p className="text-xs text-slate-500">
                  Ollama must be running locally or on a reachable server. No API key required.
                </p>
                <PlainInput value={form.ollamaUrl} onChange={v => set('ollamaUrl', v)}
                  placeholder="http://localhost:11434" label="Ollama Base URL" />
                <PlainInput value={form.ollamaModel} onChange={v => set('ollamaModel', v)}
                  placeholder="gemma3:latest" label="Model Name" />
                <p className="text-xs text-slate-500">
                  Run <code className="font-mono text-slate-400">ollama serve</code> to start the local server.
                  Use any model available in your local library.
                </p>
              </>)}

              {/* Ollama Cloud */}
              {form.aiProvider === 'ollama_cloud' && (<>
                <div className="rounded-xl bg-sky-500/10 border border-sky-500/20 px-4 py-3 mb-2">
                  <p className="text-xs text-sky-300 font-semibold mb-1">☁️ Ollama Cloud</p>
                  <p className="text-xs text-sky-300/70 leading-relaxed">
                    Ollama Cloud runs models on Ollama's infrastructure — no local GPU required.
                    Uses the same API format as local Ollama, routed through{' '}
                    <code className="font-mono text-sky-400">https://ollama.com/api/chat</code>.
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  You must have pulled the cloud model via{' '}
                  <code className="font-mono text-slate-400">ollama pull &lt;model&gt;:cloud</code>.
                </p>
                <ServerManagedNotice providerLabel="Ollama Cloud" secretName="OLLAMA_CLOUD_API_KEY" functionName="notes_ollama-proxy" />
                <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3">
                  <p className="text-xs font-bold text-slate-400 mb-2">Popular Cloud Models</p>
                  <div className="grid grid-cols-2 gap-1">
                    {AI_PROVIDERS.ollama_cloud.models.map(m => (
                      <button
                        key={m}
                        onClick={() => selectModel(m)}
                        className={`text-left px-2 py-1 rounded-lg text-xs font-mono transition-colors ${
                          (form.aiModel || AI_PROVIDERS.ollama_cloud.defaultModel) === m
                            ? 'bg-sky-500/20 text-sky-300'
                            : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </>)}
            </div>
          </div>

          {/* ── GOOGLE DRIVE & CALENDAR ── */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <HardDrive className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-black text-white uppercase tracking-wider">Google Drive &amp; Calendar</h2>
              {driveConnected && (
                <span className="ml-auto flex items-center gap-1 text-xs text-emerald-400 font-bold">
                  <Wifi className="w-3 h-3" /> Connected
                </span>
              )}
            </div>
            {!driveConnected ? (
              <>
                <p className="text-xs text-slate-400 mb-3">
                  {envClientId
                    ? <>The <strong className="text-white">Google OAuth2 Client ID</strong> is configured via the{' '}
                        <code className="font-mono text-slate-300">VITE_GOOGLE_CLIENT_ID</code> environment variable —
                        just click connect below.</>
                    : <>Enter your <strong className="text-white">Google OAuth2 Client ID</strong> from the Google Cloud Console
                        (Credentials → OAuth 2.0 Client ID, Application type: Web).</>}
                  {' '}The app requests Drive access (to read patient files and save generated documents) and read-only
                  Calendar access (for Calendar Notes) together.
                </p>
                {!envClientId && (
                  <PlainInput value={driveClientId} onChange={setDriveClientId}
                    placeholder="xxxx.apps.googleusercontent.com" label="Google OAuth2 Client ID" />
                )}
                {driveError && (
                  <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/25 rounded-xl px-3 py-2.5 mt-3">
                    <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-300">{driveError}</p>
                  </div>
                )}
                <button
                  onClick={handleConnectDrive}
                  disabled={driveConnecting}
                  className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-colors disabled:opacity-50"
                >
                  <HardDrive className="w-4 h-4" />
                  {driveConnecting ? 'Connecting…' : 'Connect Google Drive'}
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-emerald-400 flex items-center gap-2">
                    <Wifi className="w-4 h-4" /> Drive connected — PatientForms accessible
                  </p>
                  <button onClick={disconnectDrive} className="text-xs text-slate-500 hover:text-red-400 transition-colors flex items-center gap-1">
                    <WifiOff className="w-3 h-3" /> Disconnect
                  </button>
                </div>

                <div className="mt-4 pt-4 border-t border-white/10">
                  <div className="flex items-center justify-between gap-3">
                    <p className={`text-sm flex items-center gap-2 ${hasCalendarScope() ? 'text-emerald-400' : 'text-slate-400'}`}>
                      <CalendarIcon className="w-4 h-4" />
                      {hasCalendarScope() ? 'Calendar connected (read-only)' : 'Calendar not connected yet'}
                    </p>
                    {!hasCalendarScope() && (
                      <button
                        onClick={handleConnectCalendar}
                        disabled={calendarConnecting}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-bold transition-colors disabled:opacity-50 flex-shrink-0"
                      >
                        <CalendarIcon className="w-3.5 h-3.5" />
                        {calendarConnecting ? 'Connecting…' : 'Connect Calendar'}
                      </button>
                    )}
                  </div>
                  {calendarError && (
                    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/25 rounded-xl px-3 py-2.5 mt-3">
                      <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-red-300">{calendarError}</p>
                    </div>
                  )}
                  {!hasCalendarScope() && (
                    <p className="text-[11px] text-slate-600 mt-2">
                      Grants read-only access to your calendars for the Calendar Notes feature — Drive access is preserved.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── OUTPUT FORMAT ── */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <FileOutput className="w-4 h-4 text-teal-400" />
              <h2 className="text-sm font-black text-white uppercase tracking-wider">Output Format</h2>
            </div>
            <div className="flex gap-2">
              {OUTPUT_FORMATS.map(fmt => (
                <button
                  key={fmt}
                  onClick={() => set('outputFormat', fmt)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all border ${
                    form.outputFormat === fmt
                      ? 'bg-teal-500/20 border-teal-500/40 text-teal-300'
                      : 'bg-slate-800 border-white/10 text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          {/* ── DETAIL LEVEL ── */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlignLeft className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-black text-white uppercase tracking-wider">Detail Level</h2>
            </div>
            <div className="space-y-2">
              {DETAIL_LEVELS.map(lvl => (
                <button
                  key={lvl}
                  onClick={() => set('detailLevel', lvl)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all border text-left ${
                    form.detailLevel === lvl
                      ? 'bg-amber-500/15 border-amber-500/35 text-amber-200'
                      : 'bg-slate-800 border-white/10 text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${form.detailLevel === lvl ? 'border-amber-400 bg-amber-400' : 'border-slate-600'}`} />
                  {lvl}
                  {lvl === 'Highly Detailed' && <span className="ml-auto text-xs text-amber-500">Recommended</span>}
                </button>
              ))}
            </div>
          </div>

          {/* ── NAMING CONVENTION ── */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <Tag className="w-4 h-4 text-rose-400" />
              <h2 className="text-sm font-black text-white uppercase tracking-wider">Output Naming Convention</h2>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Variables: <code className="text-rose-300">[LastName]</code> <code className="text-rose-300">[Date]</code>
            </p>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Treatment Plan</label>
                <input type="text" value={form.namingTreatmentPlan} onChange={e => set('namingTreatmentPlan', e.target.value)}
                  className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-rose-500/50 font-mono" />
                <p className="text-xs text-slate-600 mt-1">Preview: <span className="text-slate-400 font-mono">{previewTp}</span></p>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1.5">DARP Progress Note</label>
                <input type="text" value={form.namingDarp} onChange={e => set('namingDarp', e.target.value)}
                  className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-rose-500/50 font-mono" />
                <p className="text-xs text-slate-600 mt-1">Preview: <span className="text-slate-400 font-mono">{previewDarp}</span></p>
              </div>
            </div>
          </div>

          {/* ── SOURCE FILE SELECTION ── */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <FileOutput className="w-4 h-4 text-teal-400" />
              <h2 className="text-sm font-black text-white uppercase tracking-wider">Source File Selection</h2>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Configure approximate filename rules per document type. Matching files are preselected on the Batch
              Processor's generator page, where every discovered file can still be checked or unchecked by hand.
              Optional rules only warn when nothing matches; only a rule marked <strong className="text-slate-300">Required</strong> blocks generation.
            </p>
            <SourceFileRulesEditor value={form.sourceFiles} onChange={sourceFiles => set('sourceFiles', sourceFiles)} />
          </div>

          {/* ── GENERATION PRESETS ── */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Tag className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-black text-white uppercase tracking-wider">Generation Presets</h2>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Save and reuse your favorite AI settings, detail levels, and source file rules as named presets.
            </p>
            <div className="mb-4">
              <label htmlFor="preset-doc-type" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Document Type</label>
              <div className="relative">
                <select
                  id="preset-doc-type"
                  value={selectedDocTypeForPreset}
                  onChange={e => setSelectedDocTypeForPreset(e.target.value)}
                  className="w-full appearance-none bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 pr-10 text-sm text-white focus:outline-none focus:border-violet-500/50"
                >
                  {Object.entries(DOCUMENT_TYPES).map(([key, type]) => (
                    <option key={key} value={key}>{type.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              </div>
            </div>
            <PresetManager
              docTypeKey={selectedDocTypeForPreset}
              settings={form}
              onApplyPreset={handleApplyPreset}
              userId={user?.id}
            />
          </div>
        </div>

        {/* Storage notice */}
        <div className="mt-5 rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-3 flex gap-3 items-start">
          <Lock className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-slate-500 leading-relaxed">
            <strong className="text-slate-400">Gemini, Claude, and Ollama Cloud keys are configured once on the server</strong> and
            never touch the browser. <strong className="text-slate-400">OpenAI's key is stored in your browser's localStorage</strong> —
            it stays on this device and auto-saves when you click out of the field.
            Use <strong className="text-slate-400">Save Settings</strong> to persist all other options.
          </p>
        </div>

        {/* Save */}
        <div className="mt-4 flex items-center gap-3">
          <button onClick={handleSave}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm transition-colors shadow-lg shadow-violet-500/20">
            <Save className="w-4 h-4" />
            Save Settings
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-emerald-400 text-sm font-semibold">
              <CheckCircle className="w-4 h-4" /> Saved to browser!
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
