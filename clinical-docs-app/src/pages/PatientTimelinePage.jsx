/**
 * Per-patient clinical timeline — every generated document and billing
 * report for one patient, merged into a single chronological view.
 *
 * Queries Supabase directly by patient_name rather than filtering the
 * documents/reports arrays cached in AppContext: those caches are capped
 * (50 documents / 200 reports across the whole practice, newest first), so
 * a patient with older history could silently be missing rows there.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Loader2, FileText, DollarSign, ExternalLink, Code, Eye,
  CheckCircle2, Clock, XCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { findPatientFormsFolder, listSubfolders, listPatientFiles } from '../lib/googleDrive';
import { matchPatientFolders, classifyMatch } from '../lib/patientMatching';
import { getSourceRules, resolveSourceFiles } from '../lib/sourceFileSelection';
import { collectSourceText, generateDocumentForPatient } from '../lib/documentPipeline';
import { buildSystemPrompt } from '../lib/aiEngine';
import { getProviderKeys, isProviderConfigured } from '../lib/settings';
import { docTypeKeyForCanonical } from '../lib/documentTypes';
import { withRetry } from '../lib/retry';
import ClientFacingActions from '../components/ClientFacingActions';
import DocumentVersionHistory from '../components/DocumentVersionHistory';

const DOC_TYPE_LABEL = {
  treatment_plan: 'Treatment Plan',
  darp: 'DARP Progress Note',
  pre_intake: 'Pre-Intake Brief',
  follow_up: 'Follow-Up Visit',
};

const REVIEW_STATUS_BADGE = {
  approved: { color: 'bg-emerald-500/20 text-emerald-300', icon: CheckCircle2, label: 'Approved' },
  generated: { color: 'bg-slate-700 text-slate-300', icon: Clock, label: 'Generated' },
  rejected: { color: 'bg-red-500/20 text-red-400', icon: XCircle, label: 'Rejected' },
};

function formatDate(iso) {
  if (!iso) return 'Unknown date';
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export default function PatientTimelinePage() {
  const { name } = useParams();
  const patientName = decodeURIComponent(name || '');
  const {
    user, settings, driveConnected, updateDocumentReview, regenerateDocument,
    getTemplateHtml, fetchLatestDocument,
  } = useApp();
  const [reviewUpdating, setReviewUpdating] = useState({});
  const [regeneratingDocId, setRegeneratingDocId] = useState(null);
  const [versionRefreshKey, setVersionRefreshKey] = useState(0);

  const [documents, setDocuments] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState({});
  const [previewMode, setPreviewMode] = useState({});

  useEffect(() => {
    if (!patientName) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    Promise.all([
      supabase.from('documents').select('*').eq('patient_name', patientName).order('created_at', { ascending: false }),
      supabase.from('reports').select('*').eq('patient_name', patientName).order('date_of_service', { ascending: false }),
    ]).then(([docsRes, reportsRes]) => {
      if (cancelled) return;
      if (docsRes.error || reportsRes.error) {
        setError(docsRes.error?.message || reportsRes.error?.message || 'Failed to load patient history.');
        return;
      }
      setDocuments(docsRes.data || []);
      setReports(reportsRes.data || []);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [patientName]);

  const entries = useMemo(() => {
    const docEntries = documents.map(d => ({
      kind: 'document',
      key: `doc-${d.id}`,
      // Prefer the actual session date when this document is calendar-linked
      // — otherwise fall back to when it was generated.
      date: d.calendar_occurrence_start || d.created_at,
      doc: d,
    }));
    const reportEntries = reports.map(r => ({
      kind: 'report',
      key: `report-${r.id}`,
      date: r.date_of_service || r.created_at,
      report: r,
    }));
    return [...docEntries, ...reportEntries].sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [documents, reports]);

  function toggleExpand(key) {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  }
  function togglePreviewMode(key) {
    setPreviewMode(prev => ({ ...prev, [key]: prev[key] === 'raw' ? 'rendered' : 'raw' }));
  }

  async function handleReviewChange(docId, reviewStatus) {
    setReviewUpdating(prev => ({ ...prev, [docId]: true }));
    try {
      const updated = await updateDocumentReview(docId, { reviewStatus, reviewNotes: null });
      if (!updated) {
        setError('Failed to update document review status.');
        return;
      }
      setDocuments(prev => prev.map(d => (d.id === docId ? updated : d)));
    } catch {
      setError('Failed to update document review status.');
    } finally {
      setReviewUpdating(prev => ({ ...prev, [docId]: false }));
    }
  }

  /**
   * Re-run generation for an already-saved document and persist the result
   * as a new version via AppContext's regenerateDocument — the only code
   * path that actually creates a versioned row, which is what
   * DocumentVersionHistory's diff view needs something real to compare
   * against. No bootstrap-note chaining here (unlike Batch Processor/
   * AutoPilot/Calendar Notes generating a fresh Treatment Plan alongside its
   * source note) — this regenerates one existing document from its own
   * configured source files only.
   */
  async function handleRegenerateVersion(doc) {
    if (regeneratingDocId) return;
    const docTypeKey = docTypeKeyForCanonical(doc.document_type);
    if (!docTypeKey) { setError(`Unknown document type "${doc.document_type}" — can't regenerate.`); return; }
    if (!driveConnected) { setError('Connect Google Drive in Settings before regenerating.'); return; }
    const provider = settings.aiProvider || 'gemini';
    const keys = getProviderKeys(settings);
    if (!isProviderConfigured(provider, keys)) { setError(`AI provider "${provider}" has no API key configured — go to Settings.`); return; }

    setRegeneratingDocId(doc.id);
    setError('');
    try {
      const root = await withRetry(() => findPatientFormsFolder(), { retries: 2 });
      const subfolders = await withRetry(() => listSubfolders(root.id), { retries: 2 });
      const candidates = matchPatientFolders(patientName, subfolders);
      const matchStatus = classifyMatch(candidates);
      if (matchStatus !== 'matched') {
        throw new Error(matchStatus === 'ambiguous'
          ? `"${patientName}" matches ${candidates.length} Drive folders — resolve this in Batch Processor first.`
          : `No Drive folder found for "${patientName}".`);
      }
      const files = await withRetry(() => listPatientFiles(candidates[0].id), { retries: 2 });
      const rules = getSourceRules(settings, docTypeKey);
      const { selectedFileIds } = resolveSourceFiles(files, rules);
      const selectedFiles = files.filter(f => selectedFileIds.includes(f.id));
      if (selectedFiles.length === 0) {
        throw new Error('No source files in Drive match this document type\'s Source File Rules — nothing to regenerate from.');
      }

      const { sourceText } = await collectSourceText({ name: patientName, files }, null, selectedFiles);
      const systemPrompt = buildSystemPrompt(settings.detailLevel);
      const { outputHtml } = await withRetry(
        () => generateDocumentForPatient({
          patient: { name: patientName }, docTypeKey, sourceText, systemPrompt,
          provider, keys, model: settings.aiModel || undefined,
          getTemplateHtml, fetchLatestDocument,
        }),
        { retries: 2 },
      );

      const updated = await regenerateDocument(doc.id, outputHtml, { provider, model: settings.aiModel || undefined });
      if (!updated) throw new Error('Regeneration produced new content, but saving it as a new version failed.');
      setDocuments(prev => [updated, ...prev]);
      setVersionRefreshKey(k => k + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setRegeneratingDocId(null);
    }
  }

  return (
    <div className="min-h-full bg-slate-950 p-6">
      <div className="max-w-4xl mx-auto">
        <Link
          to="/history"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-white transition-colors mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Generation History
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-600 to-emerald-600 flex items-center justify-center text-white font-black">
            {patientName.charAt(0).toUpperCase() || '?'}
          </div>
          <div>
            <h1 className="text-xl font-black text-white">{patientName || 'Unknown patient'}</h1>
            <p className="text-xs text-slate-500">
              {loading ? 'Loading history…' : `${documents.length} document${documents.length !== 1 ? 's' : ''} · ${reports.length} report${reports.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-2xl border border-red-500/25 bg-red-500/5 px-5 py-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div role="status" className="flex flex-col items-center justify-center py-24">
            <Loader2 className="w-6 h-6 text-teal-400 animate-spin" />
            <span className="sr-only">Loading patient timeline</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
              <FileText className="w-7 h-7 text-slate-600" />
            </div>
            <p className="text-sm font-bold text-slate-500">No documents or reports found for this patient.</p>
          </div>
        ) : (
          <div className="relative pl-6 space-y-4 before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-white/10">
            {entries.map(entry => {
              if (entry.kind === 'document') {
                const d = entry.doc;
                const badge = REVIEW_STATUS_BADGE[d.review_status] || REVIEW_STATUS_BADGE.generated;
                const BadgeIcon = badge.icon;
                return (
                  <div key={entry.key} className="relative">
                    <div className="absolute -left-6 top-1.5 w-3.5 h-3.5 rounded-full bg-teal-500 border-2 border-slate-950" />
                    <div className="rounded-2xl border border-white/10 bg-slate-900 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <FileText className="w-4 h-4 text-teal-400 flex-shrink-0" />
                            <span className="text-sm font-bold text-white">{DOC_TYPE_LABEL[d.document_type] || d.document_type}</span>
                            {d.version_number > 1 && (
                              <span className="text-[10px] text-slate-500 font-mono">v{d.version_number}</span>
                            )}
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.color}`}>
                              <BadgeIcon className="w-3 h-3" /> {badge.label}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1">{formatDate(entry.date)} · via {d.source || 'manual'}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {reviewUpdating[d.id] ? (
                            <span role="status">
                              <Loader2 aria-hidden="true" className="w-3.5 h-3.5 text-slate-500 animate-spin" />
                              <span className="sr-only">Updating review status</span>
                            </span>
                          ) : (
                            <>
                              {d.review_status !== 'approved' && (
                                <button
                                  onClick={() => handleReviewChange(d.id, 'approved')}
                                  title="Approve"
                                  aria-label="Approve document"
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
                                >
                                  <CheckCircle2 aria-hidden="true" className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {d.review_status !== 'rejected' && (
                                <button
                                  onClick={() => handleReviewChange(d.id, 'rejected')}
                                  title="Reject"
                                  aria-label="Reject document"
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                                >
                                  <XCircle aria-hidden="true" className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </>
                          )}
                          {d.drive_file_url && (
                            <a
                              href={d.drive_file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-500 hover:text-teal-300 hover:bg-teal-500/10 text-xs font-bold transition-all"
                            >
                              Open <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          {d.content_html && (
                            <button
                              onClick={() => toggleExpand(entry.key)}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 text-xs font-bold transition-all"
                            >
                              <Eye className="w-3.5 h-3.5" /> {expanded[entry.key] ? 'Hide' : 'Preview'}
                            </button>
                          )}
                        </div>
                      </div>

                      {expanded[entry.key] && d.content_html && (
                        <div className="mt-3 pt-3 border-t border-white/10">
                          <div className="flex justify-end mb-2">
                            <button
                              onClick={() => togglePreviewMode(entry.key)}
                              className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
                            >
                              <Code className="w-3.5 h-3.5" /> {previewMode[entry.key] === 'raw' ? 'Preview' : 'View HTML'}
                            </button>
                          </div>
                          {previewMode[entry.key] === 'raw' ? (
                            <pre className="w-full max-h-64 overflow-auto bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-300 font-mono whitespace-pre-wrap">{d.content_html}</pre>
                          ) : (
                            <iframe
                              title={`preview-${entry.key}`}
                              sandbox=""
                              srcDoc={d.content_html}
                              className="w-full h-64 rounded-lg border border-white/10 bg-white"
                            />
                          )}
                          <ClientFacingActions documentHtml={d.content_html} patientName={patientName} />
                          {user?.id && (
                            <DocumentVersionHistory
                              key={`${d.id}-${versionRefreshKey}`}
                              docId={d.id}
                              patientName={patientName}
                              userId={user.id}
                              documentType={d.document_type}
                              onRegenerateClick={() => handleRegenerateVersion(d)}
                            />
                          )}
                          {regeneratingDocId === d.id && (
                            <p className="mt-2 text-xs text-teal-400 flex items-center gap-1.5">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Regenerating…
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              const r = entry.report;
              return (
                <div key={entry.key} className="relative">
                  <div className="absolute -left-6 top-1.5 w-3.5 h-3.5 rounded-full bg-violet-500 border-2 border-slate-950" />
                  <div className="rounded-2xl border border-white/10 bg-white/3 p-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <DollarSign className="w-4 h-4 text-violet-400 flex-shrink-0" />
                      <span className="text-sm font-bold text-white">{r.type_of_service || 'Report'}</span>
                      {(r.cpt_codes || []).map(code => (
                        <span key={code} className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 text-[10px] font-mono font-bold">{code}</span>
                      ))}
                      {r.psychotherapy_minutes != null && (
                        <span className="text-[10px] text-slate-500">{r.psychotherapy_minutes} min</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{formatDate(entry.date)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
