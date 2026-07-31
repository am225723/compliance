/**
 * Show version history for a document and allow regeneration
 */

import { useState, useEffect } from 'react';
import { RotateCw, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function DocumentVersionHistory({ docId, patientName, userId, onRegenerateClick }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState(null);

  useEffect(() => {
    loadVersions();
  }, [docId, patientName, userId]);

  async function loadVersions() {
    if (!userId || !patientName || !docId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', userId)
      .eq('patient_name', patientName)
      .order('version_number', { ascending: false });
    if (!error && data) {
      setVersions(data);
    }
    setLoading(false);
  }

  if (loading) {
    return <div className="text-xs text-slate-400">Loading versions…</div>;
  }

  if (versions.length <= 1) {
    return null;
  }

  return (
    <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 mt-5">
      <h3 className="font-bold text-white mb-3 flex items-center gap-2">
        <Eye className="w-4 h-4" />
        Version History ({versions.length})
      </h3>
      <div className="space-y-2">
        {versions.map((version, idx) => (
          <button
            key={version.id}
            onClick={() => setExpandedVersion(expandedVersion === version.id ? null : version.id)}
            className="w-full text-left p-3 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-bold text-white">
                  Version {version.version_number} {idx === 0 ? '(current)' : ''}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {new Date(version.created_at).toLocaleString()} • {version.ai_model || 'default model'} • {version.review_status}
                </p>
              </div>
              {expandedVersion === version.id ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
            </div>

            {expandedVersion === version.id && (
              <div className="mt-3 pt-3 border-t border-white/10 space-y-3">
                <div className="text-xs space-y-1 text-slate-400">
                  {version.generation_metadata && (
                    <>
                      <p className="font-bold text-slate-300">Generation Info:</p>
                      <p>Files: {version.generation_metadata.sourceFiles?.length || 0}</p>
                      {version.total_tokens && <p>Tokens: {version.total_tokens}</p>}
                    </>
                  )}
                </div>
                {version.review_notes && (
                  <div className="text-xs">
                    <p className="font-bold text-slate-300">Review Notes:</p>
                    <p className="text-slate-400 mt-1">{version.review_notes}</p>
                  </div>
                )}
                {version.previous_version_id && (
                  <p className="text-xs text-slate-500">Previous version: {version.previous_version_id.substring(0, 8)}…</p>
                )}
                {idx === 0 && (
                  <button
                    onClick={() => onRegenerateClick?.(patientName)}
                    className="w-full mt-2 px-3 py-2 rounded-lg bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors text-xs font-bold flex items-center justify-center gap-2"
                  >
                    <RotateCw className="w-3 h-3" />
                    Regenerate from This Version
                  </button>
                )}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
