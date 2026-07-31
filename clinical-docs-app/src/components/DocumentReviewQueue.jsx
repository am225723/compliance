/**
 * Document review queue — approve, reject, or regenerate documents before they're finalized
 */

import { useState } from 'react';
import { CheckCircle2, XCircle, RotateCw, Eye, Loader2, MessageSquare } from 'lucide-react';

export default function DocumentReviewQueue({
  patients, onReviewStatusChange, onRegenerateClick, phase,
}) {
  const [expandedNotes, setExpandedNotes] = useState({});
  const generatedPatients = patients.filter(p => p.status === 'generated' || (p.status === 'error' && phase !== 'preview'));

  if (generatedPatients.length === 0) {
    return null;
  }

  return (
    <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 mt-5">
      <div className="flex items-center gap-2 mb-3">
        <Eye className="w-5 h-5 text-amber-400" />
        <h2 className="text-sm font-black text-white">Review Generated Documents</h2>
        <span className="ml-auto text-xs bg-amber-500/20 text-amber-300 px-2 py-1 rounded-full">
          {generatedPatients.length} document{generatedPatients.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-3">
        {generatedPatients.map(patient => (
          <div key={patient.name} className="p-3 bg-white/5 border border-white/10 rounded-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-white truncate">{patient.name}</p>
                  {patient.status === 'generated' && (
                    <span className="text-xs bg-teal-500/20 text-teal-300 px-2 py-0.5 rounded">Ready</span>
                  )}
                  {patient.status === 'error' && (
                    <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">Failed</span>
                  )}
                </div>
                {patient.error && (
                  <p className="text-xs text-red-400 mt-1">Error: {patient.error}</p>
                )}
                {patient.generatedOutput && (
                  <p className="text-xs text-slate-400 mt-1">
                    {patient.generatedOutput.sourceFileList.length} source file(s): {patient.generatedOutput.sourceFileList.join(', ')}
                  </p>
                )}
              </div>

              {patient.status === 'generated' && (
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => onRegenerateClick?.(patient.name)}
                    className="p-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    aria-label={`Regenerate document for ${patient.name}`}
                  >
                    <RotateCw className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => onReviewStatusChange?.(patient.name, 'approved')}
                    className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    aria-label={`Approve ${patient.name}`}
                  >
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => setExpandedNotes(prev => ({ ...prev, [patient.name]: !prev[patient.name] }))}
                    className="p-2 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                    aria-label={`Add or edit review notes for ${patient.name}`}
                    aria-expanded={expandedNotes[patient.name] ? 'true' : 'false'}
                  >
                    <MessageSquare className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => onReviewStatusChange?.(patient.name, 'rejected')}
                    className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/50"
                    aria-label={`Reject ${patient.name}`}
                  >
                    <XCircle className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>

            {/* Notes section */}
            {expandedNotes[patient.name] && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <textarea
                  placeholder="Add review notes…"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40 resize-none"
                  rows={2}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
