import { useNavigate } from 'react-router-dom';
import {
  FileText, ClipboardList, Calendar, Heart, ChevronRight,
  Stethoscope, Shield, Info, Play, Settings, Wifi, WifiOff,
  CheckCircle2, XCircle, Zap
} from 'lucide-react';
import { templates } from '../data/templates';
import { useApp } from '../context/AppContext';
import { AI_PROVIDERS } from '../lib/aiEngine';
import { getProviderKeys } from '../lib/settings';

const iconMap = {
  pre_intake:     FileText,
  follow_up:      Calendar,
  session_note:   ClipboardList,
  treatment_plan: Heart,
};

// Per-provider colour tokens
const PROVIDER_THEME = {
  openai:       { ring: 'border-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-300' },
  gemini:       { ring: 'border-blue-500/40',    bg: 'bg-blue-500/10',    text: 'text-blue-300'    },
  claude:       { ring: 'border-orange-500/40',  bg: 'bg-orange-500/10',  text: 'text-orange-300'  },
  ollama:       { ring: 'border-purple-500/40',  bg: 'bg-purple-500/10',  text: 'text-purple-300'  },
  ollama_cloud: { ring: 'border-sky-500/40',     bg: 'bg-sky-500/10',     text: 'text-sky-300'     },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { driveConnected, settings } = useApp();

  const keys = getProviderKeys(settings);
  const activeProviderId = settings.aiProvider || 'openai';

  // Build status for every provider
  const providerStatuses = Object.values(AI_PROVIDERS).map(p => {
    let configured = false;
    let detail = '';
    if (p.id === 'openai') {
      configured = !!keys.openaiApiKey;
      detail = configured ? 'API key set' : 'No API key';
    } else if (p.id === 'gemini') {
      configured = !!keys.geminiApiKey;
      detail = configured ? 'API key set' : 'No API key';
    } else if (p.id === 'claude') {
      configured = !!keys.claudeApiKey;
      detail = configured ? 'API key set' : 'No API key';
    } else if (p.id === 'ollama') {
      configured = true; // no key needed
      detail = keys.ollamaUrl || 'localhost:11434';
    } else if (p.id === 'ollama_cloud') {
      configured = !!keys.ollamaCloudApiKey;
      detail = configured ? 'API key set' : 'No API key';
    }
    const isActive = p.id === activeProviderId;
    const model = isActive && settings.aiModel ? settings.aiModel : p.defaultModel;
    return { ...p, configured, detail, isActive, model };
  });

  const activeProvider  = providerStatuses.find(p => p.isActive);
  const configuredCount = providerStatuses.filter(p => p.configured).length;
  const hasActiveKey    = activeProvider?.configured ?? false;
  const isReady         = driveConnected && hasActiveKey;

  return (
    <div className="min-h-full bg-slate-950 pb-16">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-16 right-0 w-80 h-80 bg-blue-600/15 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-5xl mx-auto px-6 py-10">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <Stethoscope className="w-7 h-7 text-white" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-400">Integrative Psychiatry</p>
              <h1 className="text-3xl font-black text-white leading-tight">Clinical AI Documents</h1>
            </div>
          </div>
          <p className="text-slate-400 text-sm max-w-2xl leading-relaxed mb-5">
            AI-powered batch processor for psychiatric documentation. Reads patient files from Google Drive,
            generates Treatment Plans and DARP progress notes, and saves them back to each patient's folder.
          </p>

          {/* Quick action */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => navigate('/batch')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition-all shadow-lg ${
                isReady
                  ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-violet-500/30 hover:opacity-90'
                  : 'bg-white/10 text-slate-400 border border-white/10'
              }`}
            >
              <Play className="w-4 h-4" />
              Open Batch Processor
            </button>
            {!isReady && (
              <button
                onClick={() => navigate('/settings')}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/25 text-amber-300 text-sm font-bold hover:bg-amber-500/20 transition-all"
              >
                <Settings className="w-4 h-4" />
                Configure Settings First
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 mt-8">

        {/* ── Top status row: Drive + Output ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <div className={`rounded-2xl border p-4 ${driveConnected ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
            <div className="flex items-center gap-2 mb-2">
              {driveConnected ? <Wifi className="w-4 h-4 text-emerald-400" /> : <WifiOff className="w-4 h-4 text-red-400" />}
              <p className="text-xs font-black text-slate-400 uppercase tracking-wider">Google Drive</p>
            </div>
            <p className={`text-sm font-bold ${driveConnected ? 'text-emerald-300' : 'text-red-300'}`}>
              {driveConnected ? 'Connected' : 'Not Connected'}
            </p>
            <p className="text-xs text-slate-600 mt-0.5">{driveConnected ? 'PatientForms accessible' : 'Go to Settings to connect'}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/3 p-4">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-blue-400" />
              <p className="text-xs font-black text-slate-400 uppercase tracking-wider">Output</p>
            </div>
            <p className="text-sm font-bold text-slate-300">{settings.outputFormat}</p>
            <p className="text-xs text-slate-600 mt-0.5">Detail: {settings.detailLevel}</p>
          </div>
        </div>

        {/* ── AI Engine Panel ── */}
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-5 mb-8">
          {/* Panel header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-violet-400" />
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-wider">AI Engine</h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">
                <span className="text-emerald-400 font-bold">{configuredCount}</span>
                <span> of {providerStatuses.length} configured</span>
              </span>
              <button
                onClick={() => navigate('/settings')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white text-xs font-bold transition-colors"
              >
                <Settings className="w-3 h-3" /> Manage
              </button>
            </div>
          </div>

          {/* Provider rows */}
          <div className="space-y-2">
            {providerStatuses.map(p => {
              const theme = PROVIDER_THEME[p.id] || PROVIDER_THEME.openai;
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                    p.isActive
                      ? `${theme.ring} ${theme.bg}`
                      : 'border-white/8 bg-white/3'
                  }`}
                >
                  {/* Logo */}
                  <span className="text-lg w-7 text-center flex-shrink-0">{p.logo}</span>

                  {/* Name + model */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-black ${p.isActive ? theme.text : 'text-slate-300'}`}>
                        {p.label}
                      </span>
                      {p.isActive && (
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-black ${theme.bg} ${theme.text} border ${theme.ring}`}>
                          <Zap className="w-2.5 h-2.5" /> ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] mt-0.5 truncate">
                      {p.configured ? (
                        <span className="font-mono text-slate-400">{p.model}</span>
                      ) : (
                        <span className="text-slate-600 italic">not configured — add key in Settings</span>
                      )}
                      {p.id === 'ollama' && p.configured && (
                        <span className="text-slate-600 ml-1">· {p.detail}</span>
                      )}
                    </p>
                  </div>

                  {/* Status */}
                  <div className="flex-shrink-0">
                    {p.configured ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-slate-600">
                        <XCircle className="w-3.5 h-3.5" /> Not set
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Active-provider summary footer */}
          {activeProvider && (
            <div className={`mt-3 px-4 py-2.5 rounded-xl border ${PROVIDER_THEME[activeProvider.id]?.ring || 'border-white/10'} bg-white/3 flex items-center justify-between`}>
              <p className="text-xs text-slate-400">
                Currently using{' '}
                <span className={`font-black ${PROVIDER_THEME[activeProvider.id]?.text || 'text-white'}`}>
                  {activeProvider.logo} {activeProvider.label}
                </span>
                {' · '}
                <span className="font-mono text-slate-300">{activeProvider.model}</span>
              </p>
              {!hasActiveKey && (
                <button
                  onClick={() => navigate('/settings')}
                  className="text-[10px] text-amber-400 font-bold hover:text-amber-300 transition-colors"
                >
                  Add key →
                </button>
              )}
            </div>
          )}
        </div>

        {/* How It Works */}
        <h2 className="text-xs font-black uppercase tracking-[0.18em] text-slate-500 mb-4">How It Works</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { step: '1', title: 'Connect Drive',   desc: 'Authorize Google Drive access in Settings',    icon: Wifi,          color: 'text-blue-400'    },
            { step: '2', title: 'Enter Names',     desc: 'Paste batch patient names into the processor', icon: ClipboardList, color: 'text-violet-400'  },
            { step: '3', title: 'Confirm Files',   desc: 'Preview queued source files per patient',      icon: FileText,      color: 'text-teal-400'    },
            { step: '4', title: 'Generate & Save', desc: 'AI generates docs and saves to Drive',         icon: Play,          color: 'text-emerald-400' },
          ].map(({ step, title, desc, icon: Icon, color }) => (
            <div key={step} className="bg-white/3 border border-white/10 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-black text-slate-600">Step {step}</span>
              </div>
              <Icon className={`w-5 h-5 ${color} mb-2`} />
              <p className="text-xs font-black text-white mb-1">{title}</p>
              <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        {/* Template Library */}
        <h2 className="text-xs font-black uppercase tracking-[0.18em] text-slate-500 mb-4">Template Library</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {templates.map((tmpl) => {
            const Icon = iconMap[tmpl.id];
            return (
              <button
                key={tmpl.id}
                onClick={() => navigate(`/template/${tmpl.id}`)}
                className="group text-left bg-white/3 hover:bg-white/8 border border-white/10 hover:border-white/20 rounded-2xl p-5 transition-all"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${tmpl.color} flex items-center justify-center shadow-md`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white/10 text-slate-400">{tmpl.tag}</span>
                </div>
                <h3 className="text-sm font-black text-white mb-1 group-hover:text-violet-300 transition-colors">{tmpl.title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed mb-3">{tmpl.description}</p>
                <div className={`flex items-center gap-1 text-xs font-bold bg-gradient-to-r ${tmpl.color} bg-clip-text text-transparent`}>
                  View Template <ChevronRight className="w-3 h-3 text-slate-500" />
                </div>
              </button>
            );
          })}
        </div>

        {/* Info */}
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-6 py-4 flex gap-4 items-start">
          <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-400/80 leading-relaxed">
            <strong className="text-amber-300">Template Injection:</strong> The AI acts as a targeted content injector —
            it replaces only the <code className="font-mono text-amber-300">ai-prompt</code> spans inside templates.
            All HTML structure, CSS, and styling is preserved exactly as designed.
            Red-labeled fields indicate missing/undocumented data. Amber labels require provider review before finalization.
          </p>
        </div>
      </div>
    </div>
  );
}
