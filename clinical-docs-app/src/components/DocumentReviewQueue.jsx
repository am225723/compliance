/**
 * Document review queue — approve, reject, or regenerate documents before they're finalized.
 * Operates on generated *outputs* (one patient can have more than one — e.g.
 * a DARP note per session file, or a bootstrap note plus its Treatment Plan)
 * rather than one row per patient, so each is keyed by its own unique key.
 */

import { useState } from 'react';
import { CheckCircle2, XCircle, RotateCw, Eye, Loader2, MessageSquare } from 'lucide-react';

export default function DocumentReviewQueue({
  items, onReviewStatusChange, phase,
}) {
  const [expandedNotes, setExpandedNotes] = useState({});
  const generatedItems = items.filter(o => o.status === 'generated' || (o.status === 'error' && phase !== 'preview'));

  if (generatedItems.length === 0) {
    return null;
  }

  return (
    <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 mt-5">
      <div className="flex items-center gap-2 mb-3">
        <Eye className="w-5 h-5 text-amber-400" />
        <h2 className="text-sm font-black text-white">Review Generated Documents</h2>
        <span className="ml-auto text-xs bg-amber-500/20 text-amber-300 px-2 py-1 rounded-full">
          {generatedItems.length} document{generatedItems.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-3">
        {generatedItems.map(item => (
          <div key={item.key} className="p-3 bg-white/5 border border-white/10 rounded-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-white truncate">{item.patientName}</p>
                  <span className="text-xs text-slate-500 truncate">— {item.label}</span>
                  {item.status === 'generated' && (
                    <span className="text-xs bg-teal-500/20 text-teal-300 px-2 py-0.5 rounded">Ready</span>
                  )}
                  {item.status === 'error' && (
                    <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">Failed</span>
                  )}
                </div>
                {item.error && (
                  <p className="text-xs text-red-400 mt-1">Error: {item.error}</p>
                )}
                {item.generatedOutput && (
                  <p className="text-xs text-slate-400 mt-1">
                    {item.generatedOutput.sourceFileList.length} source file(s): {item.generatedOutput.sourceFileList.join(', ')}
                  </p>
                )}
              </div>

              {item.status === 'generated' && (
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    disabled
                    title="Regeneration isn't supported within a batch yet — retry from the Generation History page instead."
                    className="p-2 rounded-lg bg-blue-500/10 text-blue-400/40 cursor-not-allowed"
                    aria-label={`Regenerate document for ${item.patientName} — ${item.label} (not yet supported — use Generation History)`}
                  >
                    <RotateCw className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => onReviewStatusChange?.(item.key, 'approved')}
                    className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    aria-label={`Approve ${item.patientName} — ${item.label}`}
                  >
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => setExpandedNotes(prev => ({ ...prev, [item.key]: !prev[item.key] }))}
                    className="p-2 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                    aria-label={`Add or edit review notes for ${item.patientName} — ${item.label}`}
                    aria-expanded={expandedNotes[item.key] ? 'true' : 'false'}
                  >
                    <MessageSquare className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => onReviewStatusChange?.(item.key, 'rejected')}
                    className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/50"
                    aria-label={`Reject ${item.patientName} — ${item.label}`}
                  >
                    <XCircle className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>

            {/* Notes section */}
            {expandedNotes[item.key] && (
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
