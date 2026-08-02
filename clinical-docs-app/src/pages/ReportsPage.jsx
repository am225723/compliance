import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, Plus, Trash2, Search, RefreshCw, Loader2,
  FileText, Calendar, Edit3, X, Check, ChevronDown, ChevronUp,
  Download, AlertCircle, Users, Clock
} from 'lucide-react';
import { useApp } from '../context/AppContext';

const SERVICE_TYPES = [
  'Psychiatric Evaluation',
  'Psychotherapy',
  'Medication Management',
  'Crisis Intervention',
  'Group Therapy',
  'Family Therapy',
  'Consultation',
  'Follow-Up Visit',
  'Initial Intake',
  'Treatment Planning',
];

const COMMON_CPT = [
  '90791', '90792', '90832', '90834', '90837',
  '90838', '90839', '90840', '90845', '90847',
  '90853', '99213', '99214', '99215', '99205',
];

const COMMON_ICD10 = [
  'F32.0', 'F32.1', 'F32.2', 'F33.0', 'F33.1',
  'F41.0', 'F41.1', 'F43.10', 'F43.12', 'F90.0',
  'F31.9', 'F20.9', 'F25.0', 'F60.3', 'F42.2',
];

function TagInput({ value = [], onChange, placeholder, suggestions = [] }) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filteredSuggestions = suggestions.filter(
    s => s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s)
  );

  function addTag(tag) {
    const trimmed = tag.trim().toUpperCase();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInput('');
    setShowSuggestions(false);
  }

  function removeTag(tag) {
    onChange(value.filter(v => v !== tag));
  }

  return (
    <div className="relative">
      <div className="min-h-[42px] flex flex-wrap gap-1 px-3 py-2 bg-slate-800 border border-white/10 rounded-xl focus-within:border-teal-500/60 focus-within:ring-1 focus-within:ring-teal-500/20 transition-all">
        {value.map(tag => (
          <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-500/20 text-teal-300 rounded-lg text-xs font-bold">
            {tag}
            <button type="button" onClick={() => removeTag(tag)} className="hover:text-red-400">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={e => { setInput(e.target.value); setShowSuggestions(true); }}
          onKeyDown={e => {
            if ((e.key === 'Enter' || e.key === ',') && input) {
              e.preventDefault();
              addTag(input);
            }
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder={value.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[80px] bg-transparent text-xs text-white placeholder-slate-600 outline-none"
        />
      </div>
      {showSuggestions && filteredSuggestions.length > 0 && input && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-white/15 rounded-xl shadow-xl z-20 max-h-40 overflow-y-auto">
          {filteredSuggestions.slice(0, 8).map(s => (
            <button
              key={s}
              type="button"
              onMouseDown={() => addTag(s)}
              className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-teal-500/15 hover:text-teal-300 font-mono"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportFormModal({ report, onClose, onSave }) {
  const { documents } = useApp();
  const isEdit = !!report;
  const [form, setForm] = useState({
    patient_name: report?.patient_name || '',
    icd10_codes: report?.icd10_codes || [],
    type_of_service: report?.type_of_service || '',
    cpt_codes: report?.cpt_codes || [],
    psychotherapy_minutes: report?.psychotherapy_minutes ?? '',
    date_of_service: report?.date_of_service || new Date().toISOString().split('T')[0],
    notes: report?.notes || '',
    document_id: report?.document_id || '',
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      ...form,
      psychotherapy_minutes: form.psychotherapy_minutes ? parseInt(form.psychotherapy_minutes) : null,
      document_id: form.document_id || null,
    });
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center px-4">
      <div className="bg-slate-900 border border-white/15 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            {isEdit ? <Edit3 className="w-4 h-4 text-teal-400" /> : <Plus className="w-4 h-4 text-teal-400" />}
            <h2 className="text-sm font-black text-white">{isEdit ? 'Edit Report Entry' : 'Add Report Entry'}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Patient Name */}
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Patient Name *</label>
            <input
              required
              value={form.patient_name}
              onChange={e => setForm(f => ({ ...f, patient_name: e.target.value }))}
              placeholder="e.g. John Smith"
              className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-teal-500/60 transition-all"
            />
          </div>

          {/* Link to Document */}
          {documents.length > 0 && (
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Link to Document (optional)</label>
              <select
                value={form.document_id}
                onChange={e => {
                  const doc = documents.find(d => d.id === e.target.value);
                  setForm(f => ({
                    ...f,
                    document_id: e.target.value,
                    patient_name: doc ? doc.patient_name : f.patient_name,
                  }));
                }}
                className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-teal-500/60 transition-all"
              >
                <option value="">— None —</option>
                {documents.slice(0, 30).map(d => (
                  <option key={d.id} value={d.id}>
                    {d.patient_name} · {d.document_type} · {new Date(d.created_at).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Date of Service */}
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Date of Service *</label>
            <input
              required
              type="date"
              value={form.date_of_service}
              onChange={e => setForm(f => ({ ...f, date_of_service: e.target.value }))}
              className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-teal-500/60 transition-all"
            />
          </div>

          {/* ICD-10 Codes */}
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wider">ICD-10 Codes</label>
            <TagInput
              value={form.icd10_codes}
              onChange={v => setForm(f => ({ ...f, icd10_codes: v }))}
              placeholder="Type code + Enter (e.g. F32.1)"
              suggestions={COMMON_ICD10}
            />
            <p className="text-[10px] text-slate-600 mt-1">Type and press Enter to add. Common: {COMMON_ICD10.slice(0, 4).join(', ')}</p>
          </div>

          {/* Type of Service */}
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Type of Service</label>
            <select
              value={form.type_of_service}
              onChange={e => setForm(f => ({ ...f, type_of_service: e.target.value }))}
              className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-teal-500/60 transition-all"
            >
              <option value="">— Select type —</option>
              {SERVICE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* CPT Codes */}
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wider">CPT Codes</label>
            <TagInput
              value={form.cpt_codes}
              onChange={v => setForm(f => ({ ...f, cpt_codes: v }))}
              placeholder="Type code + Enter (e.g. 90837)"
              suggestions={COMMON_CPT}
            />
            <p className="text-[10px] text-slate-600 mt-1">Common: {COMMON_CPT.slice(0, 5).join(', ')}</p>
          </div>

          {/* Psychotherapy Minutes */}
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Psychotherapy Minutes</label>
            <input
              type="number"
              min="0"
              max="240"
              value={form.psychotherapy_minutes}
              onChange={e => setForm(f => ({ ...f, psychotherapy_minutes: e.target.value }))}
              placeholder="e.g. 60"
              className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-teal-500/60 transition-all"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Notes (optional)</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Any additional billing notes..."
              rows={2}
              className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-teal-500/60 transition-all resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-white/5 text-slate-400 hover:text-white text-sm font-bold border border-white/10 transition-all">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-black transition-all">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" /> {isEdit ? 'Save Changes' : 'Save Entry'}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const { reports, reportsLoading, saveReport, updateReport, deleteReport, deleteReports, fetchReports } = useApp();
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingReport, setEditingReport] = useState(null);
  const [sortField, setSortField] = useState('date_of_service');
  const [sortDir, setSortDir] = useState('desc');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  const filtered = reports
    .filter(r => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        r.patient_name?.toLowerCase().includes(q) ||
        r.type_of_service?.toLowerCase().includes(q) ||
        r.icd10_codes?.some(c => c.toLowerCase().includes(q)) ||
        r.cpt_codes?.some(c => c.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => {
      let av = a[sortField] ?? '';
      let bv = b[sortField] ?? '';
      if (sortDir === 'asc') return av < bv ? -1 : av > bv ? 1 : 0;
      return av > bv ? -1 : av < bv ? 1 : 0;
    });

  function SortIcon({ field }) {
    if (sortField !== field) return <ChevronDown className="w-3 h-3 text-slate-600" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-teal-400" /> : <ChevronDown className="w-3 h-3 text-teal-400" />;
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(prev =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map(r => r.id))
    );
  }

  async function handleBulkDelete() {
    await deleteReports(Array.from(selectedIds));
    setSelectedIds(new Set());
  }

  function exportCSV() {
    const headers = ['Patient Name', 'ICD-10 Codes', 'Type of Service', 'CPT Codes', 'Psychotherapy Minutes', 'Date of Service', 'Notes'];
    const rows = filtered.map(r => [
      r.patient_name,
      (r.icd10_codes || []).join('; '),
      r.type_of_service || '',
      (r.cpt_codes || []).join('; '),
      r.psychotherapy_minutes ?? '',
      r.date_of_service || '',
      r.notes || '',
    ]);
    const csv = [headers, ...rows].map(row => row.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'reports.csv'; a.click();
  }

  return (
    <div className="min-h-full bg-slate-950 pb-16">
      {/* Header */}
      <div className="border-b border-white/10 bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h1 className="text-lg font-black text-white">Reports</h1>
                <p className="text-xs text-slate-500">Clinical billing & visit data</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchReports}
                disabled={reportsLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white text-xs font-bold transition-all"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${reportsLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={exportCSV}
                disabled={filtered.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white text-xs font-bold transition-all disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-black transition-all shadow-lg shadow-teal-900/30"
              >
                <Plus className="w-3.5 h-3.5" /> Add Entry
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by patient, ICD-10, CPT, or service type…"
              className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-teal-500/60 transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 mt-6">
        {/* Stats summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Entries',    value: reports.length, icon: FileText, color: 'text-blue-400', bg: 'bg-blue-500/10' },
            { label: 'Unique Patients',  value: new Set(reports.map(r => r.patient_name)).size, icon: Users, color: 'text-teal-400', bg: 'bg-teal-500/10' },
            { label: 'This Month',       value: reports.filter(r => r.date_of_service?.startsWith(new Date().toISOString().slice(0,7))).length, icon: Calendar, color: 'text-violet-400', bg: 'bg-violet-500/10' },
            { label: 'Avg Psych Mins',   value: (() => {
                const minutes = reports.map(r => r.psychotherapy_minutes).filter(m => m != null);
                return minutes.length ? `${Math.round(minutes.reduce((s, m) => s + m, 0) / minutes.length)} min` : '—';
              })(), icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="rounded-2xl border border-white/8 bg-white/3 p-4">
              <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-3`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <p className="text-lg font-black text-white truncate">{value}</p>
              <p className="text-[11px] text-slate-500 mt-0.5 font-semibold">{label}</p>
            </div>
          ))}
        </div>

        {reportsLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 text-teal-400 animate-spin" />
          </div>
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
              <BarChart3 className="w-7 h-7 text-slate-600" />
            </div>
            <p className="text-sm font-bold text-slate-500">No report entries yet</p>
            <p className="text-xs text-slate-700 mt-1 mb-5 max-w-xs">
              Add entries manually, or they'll be created automatically when you generate documents.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-black transition-all"
            >
              <Plus className="w-4 h-4" /> Add First Entry
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <p className="text-xs text-slate-600">
                Showing {filtered.length} of {reports.length} entries
              </p>
              {selectedIds.size > 0 && (
                <button
                  onClick={handleBulkDelete}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> Delete {selectedIds.size} selected
                </button>
              )}
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-2xl border border-white/8">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900 border-b border-white/8">
                    <th className="px-4 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={selectedIds.size > 0 && selectedIds.size === filtered.length}
                        onChange={toggleSelectAll}
                        className="w-3.5 h-3.5 rounded accent-teal-500"
                      />
                    </th>
                    {[
                      { key: 'patient_name',          label: 'Patient Name'           },
                      { key: 'icd10_codes',            label: 'ICD-10 Code'            },
                      { key: 'type_of_service',        label: 'Type of Service'        },
                      { key: 'cpt_codes',              label: 'CPT Codes'              },
                      { key: 'psychotherapy_minutes',  label: 'Psych Minutes'          },
                      { key: 'date_of_service',        label: 'Date of Service'        },
                      { key: null,                     label: ''                       },
                    ].map(({ key, label }) => (
                      <th
                        key={label}
                        onClick={() => key && toggleSort(key)}
                        className={`px-4 py-3 text-[11px] font-black uppercase tracking-wider text-slate-500 whitespace-nowrap ${key ? 'cursor-pointer hover:text-slate-300 select-none' : ''}`}
                      >
                        <span className="flex items-center gap-1">
                          {label}
                          {key && <SortIcon field={key} />}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((report, idx) => (
                    <tr
                      key={report.id}
                      className={`border-b border-white/5 hover:bg-white/3 transition-colors group ${idx % 2 === 0 ? 'bg-white/1' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(report.id)}
                          onChange={() => toggleSelect(report.id)}
                          className="w-3.5 h-3.5 rounded accent-teal-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-bold text-white whitespace-nowrap">{report.patient_name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(report.icd10_codes || []).map(code => (
                            <span key={code} className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 text-[11px] font-mono font-bold whitespace-nowrap">
                              {code}
                            </span>
                          ))}
                          {(!report.icd10_codes || report.icd10_codes.length === 0) && (
                            <span className="text-slate-700 text-xs">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-slate-300 whitespace-nowrap">{report.type_of_service || '—'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(report.cpt_codes || []).map(code => (
                            <span key={code} className="px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-300 text-[11px] font-mono font-bold whitespace-nowrap">
                              {code}
                            </span>
                          ))}
                          {(!report.cpt_codes || report.cpt_codes.length === 0) && (
                            <span className="text-slate-700 text-xs">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className={`text-sm font-bold whitespace-nowrap ${report.psychotherapy_minutes ? 'text-violet-300' : 'text-slate-700'}`}>
                          {report.psychotherapy_minutes ? `${report.psychotherapy_minutes} min` : '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-slate-300 whitespace-nowrap">
                          {report.date_of_service
                            ? new Date(report.date_of_service + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                            : '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <button
                            onClick={() => setEditingReport(report)}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-teal-400 hover:bg-teal-500/10 transition-all"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteReport(report.id)}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filtered.length === 0 && search && (
              <div className="text-center py-12">
                <p className="text-sm text-slate-500">No results for "{search}"</p>
              </div>
            )}
          </>
        )}
      </div>

      {showAddModal && (
        <ReportFormModal
          onClose={() => setShowAddModal(false)}
          onSave={saveReport}
        />
      )}
      {editingReport && (
        <ReportFormModal
          report={editingReport}
          onClose={() => setEditingReport(null)}
          onSave={patch => updateReport(editingReport.id, patch)}
        />
      )}
    </div>
  );
}
