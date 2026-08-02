/**
 * Generation History — view past batch runs, errors, and retry failed items
 */

import { useState, useEffect } from 'react';
import { History, AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronUp, Search, RotateCw, Loader2, RefreshCw, ListChecks, Users } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';

export default function GenerationHistoryPage() {
  const { user } = useApp();
  const [logs, setLogs] = useState([]);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [expandedLog, setExpandedLog] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [retryingErrors, setRetryingErrors] = useState({});

  useEffect(() => {
    if (user?.id) {
      loadGenerationLogs();
    }
  }, [user?.id]);

  async function loadGenerationLogs() {
    if (!user?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('generation_logs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error && data) {
      setLogs(data);
      // Load errors for each log
      for (const log of data) {
        loadErrorsForLog(log.id);
      }
    }
    setLoading(false);
  }

  async function loadErrorsForLog(logId) {
    const { data, error } = await supabase
      .from('generation_errors')
      .select('*')
      .eq('generation_log_id', logId);
    if (!error && data) {
      setErrors(prev => ({ ...prev, [logId]: data }));
    }
  }

  function toggleExpandLog(logId) {
    setExpandedLog(expandedLog === logId ? null : logId);
  }

  async function handleRetryError(errorId) {
    setRetryingErrors(prev => ({ ...prev, [errorId]: true }));
    try {
      // TODO: Implement retry workflow - for now show message
      // This would involve:
      // 1. Finding the original batch configuration
      // 2. Re-running generation for just this patient
      // 3. Creating a new document or new version
      console.log('Retry functionality coming soon');
    } finally {
      setRetryingErrors(prev => ({ ...prev, [errorId]: false }));
    }
  }

  const filteredLogs = logs.filter(log =>
    log.batch_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.document_type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.status?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPatients = logs.reduce((sum, l) => sum + (l.total_patients || 0), 0);
  const totalSuccess = logs.reduce((sum, l) => sum + (l.successful_count || 0), 0);
  const totalErrors = logs.reduce((sum, l) => sum + (l.failed_count || 0), 0);

  return (
    <div className="min-h-full bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
              <History className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black text-white">Generation History</h1>
              <p className="text-xs text-slate-500">View past batch runs, errors, and retry failures</p>
            </div>
          </div>
          <button
            onClick={loadGenerationLogs}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white text-xs font-bold transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Stats summary */}
        {logs.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Total Batches',  value: logs.length,     icon: ListChecks,   color: 'text-violet-400', bg: 'bg-violet-500/10' },
              { label: 'Patients',       value: totalPatients,   icon: Users,        color: 'text-blue-400',   bg: 'bg-blue-500/10'   },
              { label: 'Completed',      value: totalSuccess,    icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
              { label: 'Errors',         value: totalErrors,     icon: XCircle,      color: totalErrors ? 'text-red-400' : 'text-slate-500', bg: totalErrors ? 'bg-red-500/10' : 'bg-white/5' },
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
        )}

        {/* Search */}
        <div className="mb-5">
          <label htmlFor="search-batch" className="block text-xs font-bold text-slate-400 mb-1.5">Search History</label>
          <div className="relative">
            <Search className="absolute left-3 top-3 w-4 h-4 text-slate-500" aria-hidden="true" />
            <input
              id="search-batch"
              type="text"
              placeholder="Search by batch name, document type, or status…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/40 focus:ring-2 focus:ring-violet-500/20"
              aria-label="Search generation history"
            />
          </div>
        </div>

        {/* Logs list */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
              <History className="w-7 h-7 text-slate-600" />
            </div>
            <p className="text-sm font-bold text-slate-500">
              {logs.length === 0 ? 'No batch history yet' : 'No results found'}
            </p>
            <p className="text-xs text-slate-700 mt-1">
              {logs.length === 0 ? 'Generated batches will appear here' : `No results for "${searchTerm}"`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredLogs.map(log => {
              const logErrors = errors[log.id] || [];
              const statusColor = log.status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/25' :
                                 log.status === 'partial' ? 'bg-amber-500/10 border-amber-500/25' :
                                 'bg-red-500/10 border-red-500/25';
              const statusIcon = log.status === 'completed' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> :
                                log.status === 'partial' ? <AlertTriangle className="w-4 h-4 text-amber-400" /> :
                                <XCircle className="w-4 h-4 text-red-400" />;

              return (
                <div key={log.id} className={`rounded-2xl border p-4 transition-colors ${statusColor}`}>
                  {/* Header */}
                  <button
                    onClick={() => toggleExpandLog(log.id)}
                    className="w-full text-left flex items-center justify-between gap-3 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white/30 rounded px-1 py-0.5"
                    aria-expanded={expandedLog === log.id ? 'true' : 'false'}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {statusIcon}
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-white truncate">{log.batch_name || `Batch ${log.batch_id}`}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {log.document_type} • {new Date(log.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    {expandedLog === log.id ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                  </button>

                  {/* Stats inline */}
                  <div className="flex gap-3 mt-3 ml-7 text-xs">
                    <span className="text-slate-300">{log.total_patients} patients</span>
                    <span className="text-emerald-400">✓ {log.successful_count}</span>
                    {log.failed_count > 0 && <span className="text-red-400">✕ {log.failed_count}</span>}
                    {log.skipped_count > 0 && <span className="text-slate-500">⊘ {log.skipped_count}</span>}
                  </div>

                  {/* Expanded details */}
                  {expandedLog === log.id && (
                    <div className="mt-4 pl-7 space-y-3 border-t border-white/10 pt-3">
                      {/* Settings snapshot */}
                      {log.settings_snapshot && (
                        <div className="text-xs space-y-1 text-slate-400">
                          <p className="font-bold text-slate-300">Configuration:</p>
                          <p>Provider: {log.settings_snapshot.aiProvider} {log.settings_snapshot.aiModel ? `(${log.settings_snapshot.aiModel})` : ''}</p>
                          <p>Detail Level: {log.settings_snapshot.detailLevel}</p>
                        </div>
                      )}

                      {/* Errors table */}
                      {logErrors.length > 0 && (
                        <div>
                          <p className="font-bold text-red-300 text-xs mb-2">Failed Patients ({logErrors.length}):</p>
                          <div className="space-y-2">
                            {logErrors.map(err => (
                              <div key={err.id} className="bg-black/30 rounded-lg p-2 text-xs">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1">
                                    <p className="font-bold text-white">{err.patient_name}</p>
                                    <p className="text-red-300">{err.error_message}</p>
                                    <p className="text-slate-500 mt-1">Type: {err.error_type} • {new Date(err.attempted_at).toLocaleString()}</p>
                                  </div>
                                  {err.retry_eligible && (
                                    <button
                                      onClick={() => handleRetryError(err.id)}
                                      disabled={retryingErrors[err.id]}
                                      className="px-2 py-1 rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 disabled:opacity-50 transition-colors flex-shrink-0"
                                      title="Retry this patient"
                                      aria-label={`Retry generation for ${err.patient_name}`}
                                    >
                                      {retryingErrors[err.id] ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <RotateCw className="w-3 h-3" />
                                      )}
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Completion time */}
                      {log.completed_at && (
                        <div className="text-xs text-slate-500">
                          Duration: {Math.round((new Date(log.completed_at) - new Date(log.created_at)) / 1000 / 60)} minutes
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
