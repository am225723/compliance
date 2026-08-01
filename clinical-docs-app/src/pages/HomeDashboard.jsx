import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, ClipboardList, Calendar, Heart, ChevronRight,
  Play, Settings, BarChart3, Plus, RefreshCw, Loader2,
  FileCheck2, Trash2, Sparkles, Brain,
  ExternalLink, Search, X, Zap, CalendarDays, History, HardDrive,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { AI_PROVIDERS } from '../lib/aiEngine';
import { getProviderKeys, isProviderConfigured } from '../lib/settings';

const DOC_TYPE_LABELS = {
  treatment_plan: { label: 'Treatment Plan', color: 'from-blue-500 to-indigo-600',   icon: Heart,         tag: 'Tx Plan'   },
  darp:           { label: 'DARP Note',       color: 'from-teal-500 to-emerald-600', icon: ClipboardList, tag: 'DARP'      },
  pre_intake:     { label: 'Pre-Intake',      color: 'from-violet-500 to-purple-600',icon: FileText,      tag: 'Intake'    },
  follow_up:      { label: 'Follow-Up',       color: 'from-rose-500 to-pink-600',    icon: Calendar,      tag: 'Follow-Up' },
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function DocCard({ doc, onDelete, selected, onToggleSelect }) {
  const meta = DOC_TYPE_LABELS[doc.document_type] || DOC_TYPE_LABELS.darp;
  const Icon = meta.icon;
  const date = doc.created_at
    ? new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <div className={`group relative bg-white/[0.03] hover:bg-white/[0.06] border rounded-2xl p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/20 ${
      selected ? 'border-teal-500/50 bg-teal-500/5 ring-1 ring-teal-500/30' : 'border-white/8 hover:border-white/15'
    }`}>
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(doc.id)}
        aria-label={`${selected ? 'Deselect' : 'Select'} ${doc.patient_name || 'document'}`}
        className="absolute top-3 left-3 z-10 w-3.5 h-3.5 rounded accent-teal-500 cursor-pointer"
      />

      <div className="flex items-start justify-between gap-2 mb-3 pl-5">
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${meta.color} flex items-center justify-center shadow-lg flex-shrink-0`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/8 text-slate-400 flex-shrink-0">
            {meta.tag}
          </span>
          {doc.source === 'autopilot' && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 flex items-center gap-0.5">
              <Zap className="w-2.5 h-2.5" /> auto
            </span>
          )}
        </div>
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
  const { settings, driveConnected, documents, docsLoading, deleteDocument, deleteDocuments, fetchDocuments, user } = useApp();
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const keys = getProviderKeys(settings);
  const activeProviderId = settings.aiProvider || 'gemini';
  const activeProvider = AI_PROVIDERS[activeProviderId];

  const isConfigured = isProviderConfigured(activeProviderId, keys);

  const currentModel = settings.aiModel || activeProvider?.defaultModel || '';
  const isReady = isConfigured;

  // Stats
  const totalDocs = documents.length;
  const uniquePatients = new Set(documents.map(d => d.patient_name)).size;
  const firstName = user?.email ? user.email.split('@')[0].split(/[._]/)[0] : '';
  const greetingName = firstName ? `, ${firstName.charAt(0).toUpperCase()}${firstName.slice(1)}` : '';

  const visibleDocs = useMemo(() => {
    if (!search.trim()) return documents.slice(0, 8);
    const q = search.toLowerCase();
    return documents.filter(d =>
      d.patient_name?.toLowerCase().includes(q) ||
      d.document_type?.toLowerCase().includes(q) ||
      d.ai_provider?.toLowerCase().includes(q)
    );
  }, [documents, search]);

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(prev =>
      prev.size === visibleDocs.length ? new Set() : new Set(visibleDocs.map(d => d.id))
    );
  }

  async function handleBulkDelete() {
    await deleteDocuments(Array.from(selectedIds));
    setSelectedIds(new Set());
  }

  return (
    <div className="min-h-full bg-slate-950 pb-16">
      {/* Hero Header */}
      <div className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-24 -left-20 w-96 h-96 bg-teal-600/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-24 right-0 w-80 h-80 bg-emerald-600/15 rounded-full blur-3xl" />
          <div className="absolute top-8 right-1/3 w-64 h-64 bg-violet-600/10 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-6xl mx-auto px-6 py-10">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 bg-teal-500/30 blur-xl rounded-2xl" />
                <img src="/logo.png" alt="IP" className="relative w-14 h-14 object-contain drop-shadow-lg" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-400">Integrative Psychiatry</p>
                <h1 className="text-2xl sm:text-3xl font-black text-white leading-tight tracking-tight">
                  {getGreeting()}{greetingName}
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  {totalDocs > 0
                    ? `${totalDocs} document${totalDocs === 1 ? '' : 's'} generated so far`
                    : 'Ready to generate your first clinical document'}
                </p>
              </div>
            </div>

            {/* Quick action */}
            <button
              onClick={() => navigate('/batch')}
              className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-black transition-all ${
                isReady
                  ? 'bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white shadow-lg shadow-teal-900/40 hover:shadow-teal-800/50 hover:-translate-y-0.5'
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

        {/* Setup status banner */}
        {(!isConfigured || !driveConnected) && (
          <div className="mb-8 p-5 rounded-2xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/25">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="font-black text-white mb-0.5">Setup Required</h3>
                  <p className="text-sm text-amber-200">
                    {!isConfigured && !driveConnected
                      ? 'Connect Google Drive and add an AI provider to get started'
                      : !isConfigured
                      ? 'Add an AI provider to start generating documents'
                      : 'Connect Google Drive to save documents'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => navigate('/settings')}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-black text-sm transition-all whitespace-nowrap"
              >
                <Settings className="w-4 h-4" />
                Go to Settings
              </button>
            </div>
          </div>
        )}

        {/* Primary workflow cards */}
        <div className="mb-8">
          <h2 className="text-xs font-black uppercase tracking-[0.18em] text-slate-400 mb-3">Quick Start</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Generate from Files */}
            <button
              onClick={() => navigate('/batch')}
              disabled={!isReady}
              className={`group text-left p-5 rounded-2xl border transition-all duration-200 ${
                isReady
                  ? 'bg-gradient-to-br from-teal-600/20 to-emerald-600/20 border-teal-500/30 hover:border-teal-500/50 hover:from-teal-600/30 hover:to-emerald-600/30 hover:-translate-y-1 hover:shadow-xl hover:shadow-teal-900/20'
                  : 'bg-slate-800/50 border-white/10 opacity-60 cursor-not-allowed'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-teal-500/20 flex items-center justify-center">
                  <ClipboardList className="w-5 h-5 text-teal-400" />
                </div>
                {isReady && <ChevronRight className="w-5 h-5 text-teal-400 flex-shrink-0 transition-transform group-hover:translate-x-0.5" />}
              </div>
              <h3 className="font-black text-white mb-1">Batch Processor</h3>
              <p className="text-sm text-slate-400">Generate documents from patient files in bulk</p>
            </button>

            {/* Generate from Appointments */}
            <button
              onClick={() => navigate('/calendar-notes')}
              disabled={!isReady}
              className={`text-left p-5 rounded-2xl border transition-all duration-200 ${
                isReady
                  ? 'bg-gradient-to-br from-sky-600/20 to-cyan-600/20 border-sky-500/30 hover:border-sky-500/50 hover:from-sky-600/30 hover:to-cyan-600/30 hover:-translate-y-1 hover:shadow-xl hover:shadow-sky-900/20'
                  : 'bg-slate-800/50 border-white/10 opacity-60 cursor-not-allowed'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/20 flex items-center justify-center">
                  <CalendarDays className="w-5 h-5 text-sky-400" />
                </div>
                {isReady && <ChevronRight className="w-5 h-5 text-sky-400 flex-shrink-0" />}
              </div>
              <h3 className="font-black text-white mb-1">Calendar Notes</h3>
              <p className="text-sm text-slate-400">Auto-generate from your calendar appointments</p>
            </button>

            {/* View History */}
            <button
              onClick={() => navigate('/history')}
              className="text-left p-5 rounded-2xl border bg-gradient-to-br from-violet-600/20 to-purple-600/20 border-violet-500/30 hover:border-violet-500/50 hover:from-violet-600/30 hover:to-purple-600/30 hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-900/20 transition-all duration-200"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
                  <History className="w-5 h-5 text-violet-400" />
                </div>
                <ChevronRight className="w-5 h-5 text-violet-400 flex-shrink-0" />
              </div>
              <h3 className="font-black text-white mb-1">Generation History</h3>
              <p className="text-sm text-slate-400">View batch runs, logs, and retry failed items</p>
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Documents', value: totalDocs,      icon: FileCheck2, color: 'text-teal-400',   bg: 'bg-teal-500/10',   ring: 'group-hover:ring-teal-500/20' },
            { label: 'Patients',        value: uniquePatients, icon: Brain,      color: 'text-blue-400',   bg: 'bg-blue-500/10',   ring: 'group-hover:ring-blue-500/20' },
            { label: 'AI Provider',     value: activeProvider?.label || 'None', icon: Sparkles, color: 'text-violet-400', bg: 'bg-violet-500/10', ring: 'group-hover:ring-violet-500/20' },
            { label: 'Drive',           value: driveConnected ? 'Connected' : 'Offline', icon: HardDrive, color: driveConnected ? 'text-emerald-400' : 'text-slate-500', bg: driveConnected ? 'bg-emerald-500/10' : 'bg-white/5', ring: driveConnected ? 'group-hover:ring-emerald-500/20' : 'group-hover:ring-white/10' },
          ].map(({ label, value, icon: Icon, color, bg, ring }) => (
            <div key={label} className={`group rounded-2xl border border-white/8 bg-white/[0.03] p-4 transition-all duration-200 hover:bg-white/[0.05] hover:-translate-y-0.5 ring-1 ring-transparent ${ring}`}>
              <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-3 transition-transform group-hover:scale-105`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <p className="text-lg font-black text-white truncate">{value}</p>
              <p className="text-[11px] text-slate-500 mt-0.5 font-semibold">{label}</p>
            </div>
          ))}
        </div>

        {/* AI Engine & More Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
          {/* Active AI Engine */}
          <div className={`lg:col-span-2 flex items-center gap-4 px-5 py-4 rounded-2xl border transition-all ${
            isConfigured
              ? 'border-teal-500/30 bg-gradient-to-r from-teal-600/10 to-emerald-600/10'
              : 'border-white/10 bg-white/3'
          }`}>
            <span className="text-3xl">{activeProvider?.logo || '🤖'}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-black text-white">{activeProvider?.label || 'No provider'}</p>
                {isConfigured && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 text-[10px] font-black border border-teal-500/30">
                    ✓ Ready
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 font-mono mt-0.5">{currentModel}</p>
            </div>
            <button
              onClick={() => navigate('/settings')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-slate-400 hover:text-white transition-colors"
            >
              <Settings className="w-3 h-3" /> Change
            </button>
          </div>

          {/* Quick Access to Other Features */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => navigate('/autopilot')}
              className="text-left p-3 rounded-xl bg-white/3 hover:bg-white/6 border border-white/8 hover:border-white/15 transition-all group"
            >
              <Zap className="w-4 h-4 text-amber-400 mb-1" />
              <p className="text-xs font-black text-white">AutoPilot</p>
            </button>
            <button
              onClick={() => navigate('/reports')}
              className="text-left p-3 rounded-xl bg-white/3 hover:bg-white/6 border border-white/8 hover:border-white/15 transition-all group"
            >
              <BarChart3 className="w-4 h-4 text-blue-400 mb-1" />
              <p className="text-xs font-black text-white">Reports</p>
            </button>
            <button
              onClick={() => navigate('/templates')}
              className="text-left p-3 rounded-xl bg-white/3 hover:bg-white/6 border border-white/8 hover:border-white/15 transition-all group"
            >
              <FileText className="w-4 h-4 text-violet-400 mb-1" />
              <p className="text-xs font-black text-white">Templates</p>
            </button>
            <button
              onClick={() => navigate('/settings')}
              className="text-left p-3 rounded-xl bg-white/3 hover:bg-white/6 border border-white/8 hover:border-white/15 transition-all group"
            >
              <Settings className="w-4 h-4 text-slate-400 mb-1" />
              <p className="text-xs font-black text-white">Settings</p>
            </button>
          </div>
        </div>

        {/* Recent Documents */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-teal-400" />
            <h2 className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
              {search ? 'Search Results' : 'Recent Documents'}
              {totalDocs > 0 && <span className="ml-2 text-teal-400 font-black">{totalDocs}</span>}
            </h2>
          </div>
          <div className="flex items-center gap-2 flex-1 sm:flex-none justify-end">
            <div className="relative flex-1 sm:flex-none sm:w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search documents…"
                className="w-full pl-8 pr-7 py-1.5 bg-slate-900 border border-white/10 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-teal-500/50"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={fetchDocuments}
              disabled={docsLoading}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 font-bold transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${docsLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Bulk actions toolbar */}
        {visibleDocs.length > 0 && (
          <div className="flex items-center gap-3 mb-3 text-xs">
            <label className="flex items-center gap-1.5 text-slate-500 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.size > 0 && selectedIds.size === visibleDocs.length}
                onChange={toggleSelectAll}
                className="w-3.5 h-3.5 rounded accent-teal-500"
              />
              Select all
            </label>
            {selectedIds.size > 0 && (
              <button
                onClick={handleBulkDelete}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold transition-colors"
              >
                <Trash2 className="w-3 h-3" /> Delete {selectedIds.size} selected
              </button>
            )}
          </div>
        )}

        {docsLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-teal-400 animate-spin" />
          </div>
        ) : visibleDocs.length === 0 ? (
          search ? (
            <div className="text-center py-16">
              <p className="text-sm text-slate-500">No documents match "{search}"</p>
            </div>
          ) : (
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
          )
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
            {visibleDocs.map(doc => (
              <DocCard
                key={doc.id}
                doc={doc}
                onDelete={deleteDocument}
                selected={selectedIds.has(doc.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        )}

        {!search && totalDocs > 8 && (
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
