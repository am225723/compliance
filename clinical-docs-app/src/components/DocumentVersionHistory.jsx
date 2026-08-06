/**
 * Show version history for a document and allow regeneration
 */

import { useState, useEffect } from 'react';
import { RotateCw, ChevronDown, ChevronUp, Eye, GitCompare, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import VersionDiffView from './VersionDiffView';

/**
 * `document_type` alone isn't a document's identity — a patient can have
 * several independent DARP notes (one per session), not just one lineage of
 * versions. Narrow the document_type-scoped rows down to just the ones
 * actually connected to `seedId` by walking `previous_version_id` links in
 * both directions (a row can be an ancestor via its own previous_version_id,
 * or a descendant if some other row's previous_version_id points at it).
 */
function computeLineage(seedId, candidates) {
  const byId = new Map(candidates.map(v => [v.id, v]));
  const visited = new Set();
  const queue = [seedId];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id) || !byId.has(id)) continue;
    visited.add(id);
    const row = byId.get(id);
    if (row.previous_version_id) queue.push(row.previous_version_id);
    for (const v of candidates) {
      if (v.previous_version_id === id) queue.push(v.id);
    }
  }
  return candidates.filter(v => visited.has(v.id));
}

export default function DocumentVersionHistory({ docId, patientName, userId, documentType, onRegenerateClick }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState([]);

  useEffect(() => {
    loadVersions();
  }, [docId, patientName, userId, documentType]);

  async function loadVersions() {
    if (!userId || !patientName || !docId) return;
    setLoading(true);
    // document_type narrows the candidate set (so a Treatment Plan and a
    // DARP note never mix), but isn't itself a document's identity — a
    // patient can have several independent same-type documents (one DARP
    // note per session). computeLineage() below narrows further to just the
    // versions actually chained to docId via previous_version_id.
    let query = supabase
      .from('documents')
      .select('*')
      .eq('user_id', userId)
      .eq('patient_name', patientName);
    if (documentType) query = query.eq('document_type', documentType);
    const { data, error } = await query.order('version_number', { ascending: false });
    if (!error && data) {
      setVersions(computeLineage(docId, data));
    }
    setLoading(false);
  }

  if (loading) {
    return <div className="text-xs text-slate-400">Loading versions…</div>;
  }

  if (versions.length <= 1) {
    return null;
  }

  function toggleCompare(id) {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(v => v !== id);
      if (prev.length >= 2) return [prev[1], id]; // keep the two most recently clicked
      return [...prev, id];
    });
  }

  const compareSelected = compareIds.length === 2
    ? [...versions.filter(v => compareIds.includes(v.id))].sort((a, b) => a.version_number - b.version_number)
    : null;

  return (
    <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 mt-5">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h3 className="font-bold text-white flex items-center gap-2">
          <Eye className="w-4 h-4" />
          Version History ({versions.length})
        </h3>
        <button
          onClick={() => { setCompareMode(v => !v); setCompareIds([]); }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors flex-shrink-0 ${
            compareMode ? 'bg-blue-500/20 text-blue-300' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
          }`}
        >
          {compareMode ? <X className="w-3.5 h-3.5" /> : <GitCompare className="w-3.5 h-3.5" />}
          {compareMode ? 'Cancel Compare' : 'Compare Versions'}
        </button>
      </div>
      {compareMode && (
        <p className="text-xs text-slate-500 mb-3">
          Select two versions to see what changed between them ({compareIds.length}/2 selected).
        </p>
      )}
      <div className="space-y-2">
        {versions.map((version, idx) => (
          <div
            key={version.id}
            className="p-3 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 transition-colors"
          >
            <div className="flex items-center gap-3">
              {compareMode && (
                <input
                  type="checkbox"
                  checked={compareIds.includes(version.id)}
                  onChange={() => toggleCompare(version.id)}
                  aria-label={`Select version ${version.version_number} for comparison`}
                  className="w-3.5 h-3.5 rounded accent-blue-500 flex-shrink-0"
                />
              )}
              <button
                onClick={() => setExpandedVersion(expandedVersion === version.id ? null : version.id)}
                className="flex-1 flex items-center justify-between text-left focus:outline-none focus:ring-2 focus:ring-blue-500/50 rounded"
                aria-expanded={expandedVersion === version.id ? 'true' : 'false'}
              >
                <div className="flex-1">
                  <p className="text-sm font-bold text-white">
                    Version {version.version_number} {idx === 0 ? '(current)' : ''}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {new Date(version.created_at).toLocaleString()} • {version.ai_model || 'default model'} • {version.review_status}
                  </p>
                </div>
                {expandedVersion === version.id ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
              </button>
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
                {idx === 0 && onRegenerateClick && (
                  <button
                    onClick={() => onRegenerateClick(version)}
                    className="w-full mt-2 px-3 py-2 rounded-lg bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors text-xs font-bold flex items-center justify-center gap-2"
                  >
                    <RotateCw className="w-3 h-3" />
                    Regenerate from This Version
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {compareSelected && <VersionDiffView older={compareSelected[0]} newer={compareSelected[1]} />}
    </div>
  );
}
