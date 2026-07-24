import { useNavigate } from 'react-router-dom';
import {
  FileText, ClipboardList, Calendar, Heart, ChevronRight,
  Play, Settings, BarChart3, Plus, RefreshCw, Loader2,
  FileCheck2, Clock, Trash2, Eye, Sparkles, Brain,
  ExternalLink, AlertCircle
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { AI_PROVIDERS } from '../lib/aiEngine';
import { getProviderKeys } from '../lib/settings';

const DOC_TYPE_LABELS = {
  treatment_plan: { label: 'Treatment Plan', color: 'from-blue-500 to-indigo-600',  icon: Heart,         tag: 'Tx Plan'    },
  darp:           { label: 'DARP Note',       color: 'from-teal-500 to-emerald-600', icon: ClipboardList, tag: 'DARP'       },
  pre_intake:     { label: 'Pre-Intake',      color: 'from-violet-500 to-purple-600',icon: FileText,      tag: 'Intake'     },
  follow_up:      { label: 'Follow-Up',       color: 'from-rose-500 to-pink-600',    icon: Calendar,      tag: 'Follow-Up'  },
};

function DocCard({ doc, onDelete }) {
  const meta = DOC_TYPE_LABELS[doc.document_type] || DOC_TYPE_LABELS.darp;
  const Icon = meta.icon;
  const date = doc.created_at
    ? new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <div className="group bg-white/3 hover:bg-white/6 border border-white/8 hover:border-white/15 rounded-2xl p-4 transition-all">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${meta.color} flex items-center justify-center shadow-md flex-shrink-0`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/8 text-slate-400 flex-shrink-0">
          {meta.tag}
        </span>
      </div>

      <p className="text-sm font-black text-white mb-0.5 truncate">{doc.patient_name}</p>
      <p className="text-xs text-slate-500 mb-3">{date}</p>

      {doc.ai_provider && (
        <p className="text-[10px] text-slate-600 mb-3 truncate">
          via {AI_PROVIDERS[doc.ai_provider]?.label || doc.ai_provider}
          {doc.ai_model && ` · ${doc.ai_model}`}
        </p>
      )}

      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {doc.drive_file_url && (
          <a
            href={doc.drive_file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-500/15 text-teal-400 text-[10px] font-bold hover:bg-teal-500/25 transition-colors"
          >
            <ExternalLink className="w-3 h-3" /> Drive
          </a>
        )}
        <button
          onClick={() => onDelete(doc.id)}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/10 text-red-400 text-[10px] font-bold hover:bg-red-500/20 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export default function HomeDashboard() {
  const navigate = useNavigate();
  const { settings, driveConnected, documents, docsLoading, deleteDocument, fetchDocuments, user } = useApp();

  const keys = getProviderKeys(settings);
  const activeProviderId = settings.aiProvider || 'openai';
  const activeProvider = AI_PROVIDERS[activeProviderId];

  // Check if active provider is configured
  let isConfigured = false;
  if (activeProviderId === 'openai')       isConfigured = !!keys.openaiApiKey;
  else if (activeProviderId === 'gemini')  isConfigured = !!keys.geminiApiKey;
  else if (activeProviderId === 'claude')  isConfigured = !!keys.claudeApiKey;
  else if (activeProviderId === 'ollama')  isConfigured = true;
  else if (activeProviderId === 'ollama_cloud') isConfigured = !!keys.ollamaCloudApiKey;

  const currentModel = settings.aiModel || activeProvider?.defaultModel || '';
  const isReady = isConfigured;

  // Stats
  const totalDocs = documents.length;
  const recentDocs = documents.slice(0, 8);
  const uniquePatients = new Set(documents.map(d => d.patient_name)).size;

  return (
    <div className="min-h-full bg-slate-950 pb-16">
      {/* Hero Header */}
      <div className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-16 -left-16 w-80 h-80 bg-teal-700/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-16 right-8 w-64 h-64 bg-emerald-700/15 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-6xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img src="/logo.png" alt="IP" className="w-14 h-14 object-contain drop-shadow-lg" />
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-400">Integrative Psychiatry</p>
                <h1 className="text-2xl font-black text-white leading-tight">Clinical AI</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  {user?.email && `Welcome back · ${user.email}`}
                </p>
              </div>
            </div>

            {/* Quick action */}
            <button
              onClick={() => navigate('/batch')}
              className={`hidden sm:flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition-all shadow-lg ${
                isReady
                  ? 'bg-teal-600 hover:bg-teal-500 text-white shadow-teal-900/40'
                  : 'bg-white/8 text-slate-400 border border-white/10 cursor-default'
              }`}
            >
              <Play className="w-4 h-4" />
              Generate Documents
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 mt-8">

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Documents',  value: totalDocs,       icon: FileCheck2, color: 'text-teal-400',   bg: 'bg-teal-500/10'   },
            { label: 'Patients',         value: uniquePatients,  icon: Brain,      color: 'text-blue-400',   bg: 'bg-blue-500/10'   },
            { label: 'AI Provider',      value: activeProvider?.label || 'None', icon: Sparkles, color: 'text-violet-400', bg: 'bg-violet-500/10' },
            { label: 'Drive',            value: driveConnected ? 'Connected' : 'Offline', icon: Clock, color: driveConnected ? 'text-emerald-400' : 'text-slate-500', bg: driveConnected ? 'bg-emerald-500/10' : 'bg-white/5' },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="rounded-2xl border border-white/8 bg-white/3 p-4">
              <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center mb-3`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <p className="text-lg font-black text-white truncate">{value}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Setup nudges */}
        {(!isConfigured || !driveConnected) && (
          <div className="mb-6 space-y-2">
            {!isConfigured && (
              <div
                onClick={() => navigate('/settings')}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/25 cursor-pointer hover:bg-amber-500/15 transition-all"
              >
                <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <p className="text-xs text-amber-300 font-semibold flex-1">
                  No AI provider configured yet — add your API key in Settings to start generating documents.
                </p>
                <Settings className="w-4 h-4 text-amber-400 flex-shrink-0" />
              </div>
            )}
            {!driveConnected && (
              <div
                onClick={() => navigate('/settings')}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/25 cursor-pointer hover:bg-blue-500/15 transition-all"
              >
                <AlertCircle className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <p className="text-xs text-blue-300 font-semibold flex-1">
                  Google Drive not connected — connect in Settings to save documents to patient folders.
                </p>
                <Settings className="w-4 h-4 text-blue-400 flex-shrink-0" />
              </div>
            )}
          </div>
        )}

        {/* Active AI Engine quick status */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-400" />
            <h2 className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Active AI Engine</h2>
          </div>
          <button
            onClick={() => navigate('/settings')}
            className="text-xs text-teal-400 hover:text-teal-300 font-bold flex items-center gap-1"
          >
            <Settings className="w-3 h-3" /> Manage
          </button>
        </div>

        <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border mb-8 ${
          isConfigured
            ? 'border-teal-500/30 bg-teal-500/8'
            : 'border-white/10 bg-white/3'
        }`}>
          <span className="text-2xl">{activeProvider?.logo || '🤖'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-black text-white">{activeProvider?.label || 'No provider selected'}</p>
              {isConfigured && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 text-[10px] font-black border border-teal-500/30">
                  ✓ Ready
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{currentModel}</p>
          </div>
          <button
            onClick={() => navigate('/batch')}
            disabled={!isReady}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
              isReady
                ? 'bg-teal-600 hover:bg-teal-500 text-white'
                : 'bg-white/5 text-slate-600 cursor-not-allowed'
            }`}
          >
            <Play className="w-3 h-3" /> Generate
          </button>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: 'Batch Generate',  icon: ClipboardList, to: '/batch',    color: 'from-teal-600 to-emerald-600',  desc: 'Process patient files'   },
            { label: 'View Reports',    icon: BarChart3,     to: '/reports',  color: 'from-blue-600 to-indigo-600',   desc: 'Billing & visit data'    },
            { label: 'Templates',       icon: FileText,      to: '/template/session_note', color: 'from-violet-600 to-purple-600', desc: 'View DARP template' },
            { label: 'Settings',        icon: Settings,      to: '/settings', color: 'from-slate-600 to-slate-700',   desc: 'Configure AI & Drive'    },
          ].map(({ label, icon: Icon, to, color, desc }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="group text-left bg-white/3 hover:bg-white/6 border border-white/8 hover:border-white/15 rounded-2xl p-4 transition-all"
            >
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow-md mb-3`}>
                <Icon className="w-4 h-4 text-white" />
              </div>
              <p className="text-sm font-black text-white group-hover:text-teal-300 transition-colors">{label}</p>
              <p className="text-[11px] text-slate-600 mt-0.5">{desc}</p>
            </button>
          ))}
        </div>

        {/* Recent Documents */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-teal-400" />
            <h2 className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
              Recent Documents
              {totalDocs > 0 && <span className="ml-2 text-teal-400 font-black">{totalDocs}</span>}
            </h2>
          </div>
          <button
            onClick={fetchDocuments}
            disabled={docsLoading}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 font-bold transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${docsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {docsLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-teal-400 animate-spin" />
          </div>
        ) : recentDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
              <FileText className="w-7 h-7 text-slate-600" />
            </div>
            <p className="text-sm font-bold text-slate-500">No documents yet</p>
            <p className="text-xs text-slate-700 mt-1 mb-5">Generated documents will appear here</p>
            <button
              onClick={() => navigate('/batch')}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-black transition-all"
            >
              <Plus className="w-4 h-4" /> Generate First Document
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
            {recentDocs.map(doc => (
              <DocCard key={doc.id} doc={doc} onDelete={deleteDocument} />
            ))}
          </div>
        )}

        {totalDocs > 8 && (
          <div className="flex justify-center mb-8">
            <button
              onClick={() => navigate('/reports')}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white text-sm font-bold transition-all"
            >
              View All Documents in Reports <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
