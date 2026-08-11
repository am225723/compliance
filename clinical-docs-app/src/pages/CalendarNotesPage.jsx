import { useState, useEffect, useRef, useMemo } from 'react';
import {
  CalendarDays, Search, Play, Loader2, CheckCircle2, AlertTriangle,
  RefreshCw, Ban, History, Save, Code, HelpCircle, Info,
  List, XCircle, Eye, FilePlus, CalendarClock,
  BookmarkPlus, Trash2, Plus, Settings2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  hasCalendarScope, findPatientFormsFolder, listSubfolders, listPatientFiles,
} from '../lib/googleDrive';
import { listCalendars, listEventsForCalendars } from '../lib/googleCalendar';
import { DATE_PRESETS, getPresetRange } from '../lib/dateRanges';
import { matchPatientFolders, classifyMatch } from '../lib/patientMatching';
import { parseAppointment, shouldSkipEvent } from '../lib/appointmentParsing';
import { DOCUMENT_TYPES, CANONICAL_DOCUMENT_TYPE, getDocumentTypeMeta } from '../lib/documentTypes';
import {
  collectSourceText, generateDocumentForPatient, saveGeneratedDocument, estimateGenerationPercent,
  resolveSessionSourcePatterns, computeOutputFileNameBase,
} from '../lib/documentPipeline';
import { withRetry } from '../lib/retry';
import { buildSystemPrompt, AI_PROVIDERS } from '../lib/aiEngine';
import { getProviderKeys, getEffectiveTimeZone, isProviderConfigured } from '../lib/settings';
import { buildExistingNoteIndex, findExistingNote } from '../lib/calendarDedup';
import { getSessionSourceFiles, isSessionSourceFile } from '../lib/sessionSourceFiles';
import ClientFacingActions from '../components/ClientFacingActions';
import WizardSteps from '../components/WizardSteps';

/**
 * Among a folder's Zoom-note / Notes-by-Gemini files, pick the one whose
 * extracted date is closest to this specific appointment's date — a
 * calendar occurrence already pins down *which* session this note is for,
 * so (unlike the Batch Processor, which doesn't know a target date and so
 * splits into one note per file) Calendar Notes just needs the single best
 * match instead of dumping every session file in the folder into context.
 * `patterns` should be the caller's resolveSessionSourcePatterns(settings)
 * result, so this honors the same user-configured patterns as planning does.
 */
function pickBestSessionFile(files, apptStartIso, patterns) {
  const sessionFiles = getSessionSourceFiles(files, patterns);
  if (sessionFiles.length === 0) return null;
  const apptTime = new Date(apptStartIso).getTime();
  let best = sessionFiles[0];
  let bestDiff = Infinity;
  for (const sf of sessionFiles) {
    if (!sf.extractedDate) continue;
    const diff = Math.abs(new Date(sf.extractedDate).getTime() - apptTime);
    if (diff < bestDiff) { bestDiff = diff; best = sf; }
  }
  return best;
}

const PHASE = {
  IDLE: 'idle', LOADING: 'loading', REVIEW_APPTS: 'review_appts',
  GENERATING: 'generating', REVIEW_DOCS: 'review_docs', SAVING: 'saving', DONE: 'done',
};

/**
 * Synthetic perDocType key for the "First Session Note" a Treatment Plan
 * bootstraps from the patient's oldest session file (see planPatientOutputs
 * in documentPipeline.js — same concept as Batch Processor's Pass-1 note).
 * Deliberately not one of DOCUMENT_TYPES' real keys: it isn't a type the
 * user selects, and unlike every other saved note here it's intentionally
 * NOT linked to a calendar occurrence — the source file that produced it
 * doesn't reliably correspond to whichever appointment triggered the
 * Treatment Plan, so guessing an occurrence to attach it to risks either
 * linking the wrong appointment or colliding with that appointment's own
 * separately-generated session note under the same calendar-dedup slot.
 */
const BOOTSTRAP_DOC_KEY = 'session_note_bootstrap';

function metaForDocKey(docKey) {
  if (docKey === BOOTSTRAP_DOC_KEY) return { key: BOOTSTRAP_DOC_KEY, label: 'First Session Note' };
  return getDocumentTypeMeta(docKey);
}

const WIZARD_STEPS = ['Setup', 'Review Appointments', 'Generate', 'Review Notes', 'Save'];

function wizardStepIndex(phase, saveWasCancelled) {
  switch (phase) {
    case PHASE.REVIEW_APPTS: return 1;
    case PHASE.GENERATING: return 2;
    case PHASE.REVIEW_DOCS: return 3;
    case PHASE.SAVING: return 4;
    // A cancelled save can still land in DONE with some documents unsaved —
    // leave the Save step showing active rather than complete so the
    // tracker doesn't claim more finished than actually did.
    case PHASE.DONE: return saveWasCancelled ? 4 : WIZARD_STEPS.length;
    default: return 0; // IDLE, LOADING
  }
}

const STORAGE_KEY = 'clinicaldocs_calendar_inflight';

const STATUS_FILTERS = [
  { id: 'all',          label: 'All' },
  { id: 'ready',        label: 'Ready' },
  { id: 'needs_review', label: 'Needs Review' },
  { id: 'ambiguous',    label: 'Ambiguous Folder' },
  { id: 'not_found',    label: 'Folder Not Found' },
  { id: 'duplicate',    label: 'Already Generated' },
];

function confidenceBadge(confidence) {
  const map = {
    high:   'bg-emerald-500/20 text-emerald-300',
    medium: 'bg-blue-500/20 text-blue-300',
    low:    'bg-amber-500/20 text-amber-300',
    none:   'bg-slate-600/20 text-slate-400',
  };
  return map[confidence] || map.none;
}

function FolderStatusBadge({ status }) {
  const map = {
    pending:    { color: 'bg-slate-700 text-slate-300',      label: 'Pending' },
    matched:    { color: 'bg-blue-500/20 text-blue-300',     label: 'Matched' },
    ambiguous:  { color: 'bg-amber-500/20 text-amber-300',   label: 'Needs Resolution' },
    not_found:  { color: 'bg-red-500/20 text-red-400',       label: 'Folder Not Found' },
  };
  const { color, label } = map[status] || map.pending;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>{label}</span>;
}

function DocTypeStatusBadge({ status }) {
  const map = {
    idle:       { color: 'bg-slate-700 text-slate-300',       label: 'Idle' },
    duplicate:  { color: 'bg-slate-600/20 text-slate-400',    label: 'Already Generated' },
    generating: { color: 'bg-violet-500/20 text-violet-300',  label: 'Generating…' },
    generated:  { color: 'bg-teal-500/20 text-teal-300',      label: 'Ready for Review' },
    saving:     { color: 'bg-blue-500/20 text-blue-300',      label: 'Saving…' },
    done:       { color: 'bg-emerald-500/20 text-emerald-300', label: 'Complete' },
    error:      { color: 'bg-red-500/20 text-red-400',        label: 'Error' },
    skipped:    { color: 'bg-slate-600/20 text-slate-400',    label: 'Skipped' },
  };
  const { color, label } = map[status] || map.idle;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>
      {(status === 'generating' || status === 'saving') ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
      {label}
    </span>
  );
}

function effectiveApptStatus(appt) {
  if (appt.needsNameReview) return 'needs_review';
  if (appt.folderStatus === 'ambiguous') return 'ambiguous';
  if (appt.folderStatus === 'not_found') return 'not_found';
  if (appt.folderStatus === 'matched') {
    const types = Object.values(appt.perDocType || {});
    if (types.length && types.every((t) => t.status === 'duplicate')) return 'duplicate';
    return 'ready';
  }
  return 'pending';
}

function normalizeResumedAppointments(list) {
  return (list || []).map((a) => ({
    ...a,
    perDocType: Object.fromEntries(Object.entries(a.perDocType || {}).map(([k, v]) => {
      if (v.status === 'generating') return [k, { ...v, status: v.existingNote ? 'duplicate' : 'idle' }];
      if (v.status === 'saving') return [k, { ...v, status: 'generated' }];
      return [k, v];
    })),
  }));
}

function resumeStablePhase(storedPhase) {
  if (storedPhase === PHASE.LOADING || storedPhase === PHASE.GENERATING) return PHASE.REVIEW_APPTS;
  if (storedPhase === PHASE.SAVING) return PHASE.REVIEW_DOCS;
  return storedPhase;
}

export default function CalendarNotesPage() {
  const {
    settings, updateSettings, driveConnected,
    saveDocument, saveReport, getTemplateHtml, fetchLatestDocument, fetchExistingCalendarNotes, findDocumentByDriveUrl,
  } = useApp();

  const calendarSettings = settings.calendar;

  const [phase, setPhase] = useState(PHASE.IDLE);
  const [calendars, setCalendars] = useState([]);
  const [calendarsLoading, setCalendarsLoading] = useState(false);
  const [calendarsError, setCalendarsError] = useState('');
  const [selectedCalendarIds, setSelectedCalendarIds] = useState(calendarSettings.calendarIds || []);
  const [preset, setPreset] = useState(calendarSettings.defaultPreset || 'last7');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [selectedDocTypes, setSelectedDocTypes] = useState(calendarSettings.docTypes || ['session_note']);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [appointments, setAppointments] = useState([]);
  const [log, setLog] = useState([]);
  const [summary, setSummary] = useState(null);
  const [progress, setProgress] = useState({ percent: 0, current: 0, total: 0, step: '' });
  const [previewMode, setPreviewMode] = useState({});
  const [resumeBanner, setResumeBanner] = useState(null);
  const [saveWasCancelled, setSaveWasCancelled] = useState(false);
  const [showMatchSettings, setShowMatchSettings] = useState(false);
  const [newSkipPattern, setNewSkipPattern] = useState('');

  const abortRef = useRef(false);
  const knownPatientsRef = useRef([]);
  const persistTimeoutRef = useRef(null);
  const calendarScopeGranted = driveConnected && hasCalendarScope();

  function addLog(msg, type = 'info') {
    setLog((prev) => [...prev, { msg, type, ts: new Date().toLocaleTimeString() }]);
  }
  function updateProgress(percent, current, total, step) {
    setProgress({ percent, current, total, step });
  }
  function updateAppointment(id, patch) {
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }
  function setDocTypeStatus(apptId, docKey, patch) {
    setAppointments((prev) => prev.map((a) => (a.id === apptId
      ? { ...a, perDocType: { ...a.perDocType, [docKey]: { ...a.perDocType[docKey], ...patch } } }
      : a)));
  }

  // ── Load the calendar list once Calendar access is available ───────────
  useEffect(() => {
    if (!calendarScopeGranted) return;
    setCalendarsLoading(true);
    setCalendarsError('');
    listCalendars()
      .then((list) => {
        setCalendars(list);
        setSelectedCalendarIds((prev) => {
          if (prev.length) return prev;
          if (calendarSettings.calendarIds?.length) return calendarSettings.calendarIds;
          const primary = list.find((c) => c.primary);
          return primary ? [primary.id] : list.slice(0, 1).map((c) => c.id);
        });
      })
      .catch((e) => setCalendarsError(e.message))
      .finally(() => setCalendarsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarScopeGranted]);

  // ── Resumable runs ───────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw);
      if (snap?.phase && snap.phase !== PHASE.IDLE && snap.appointments?.length) {
        setResumeBanner(snap);
      }
    } catch { /* ignore corrupted snapshot */ }
  }, []);

  // Debounced so the frequent genPercent updates during streaming (many
  // per document) don't each trigger a synchronous JSON.stringify + Web
  // Storage write of the whole appointments array.
  useEffect(() => {
    if (phase === PHASE.IDLE || phase === PHASE.LOADING) {
      if (phase === PHASE.IDLE) sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    clearTimeout(persistTimeoutRef.current);
    persistTimeoutRef.current = setTimeout(() => {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
          phase, appointments, selectedCalendarIds, preset, customStart, customEnd,
          selectedDocTypes, summary, ts: Date.now(),
        }));
      } catch { /* storage full/unavailable — resuming just won't work this time */ }
    }, 400);
    return () => clearTimeout(persistTimeoutRef.current);
  }, [phase, appointments, selectedCalendarIds, preset, customStart, customEnd, selectedDocTypes, summary]);

  function handleResume() {
    if (!resumeBanner) return;
    setAppointments(normalizeResumedAppointments(resumeBanner.appointments));
    setSelectedCalendarIds(resumeBanner.selectedCalendarIds || []);
    setPreset(resumeBanner.preset || 'last7');
    setCustomStart(resumeBanner.customStart || '');
    setCustomEnd(resumeBanner.customEnd || '');
    setSelectedDocTypes(resumeBanner.selectedDocTypes || ['session_note']);
    setSummary(resumeBanner.summary || null);
    setPhase(resumeStablePhase(resumeBanner.phase));
    setResumeBanner(null);
    addLog('Resumed previous Calendar Notes session.');
  }
  function handleDiscardResume() {
    sessionStorage.removeItem(STORAGE_KEY);
    setResumeBanner(null);
  }

  function toggleCalendar(id) {
    setSelectedCalendarIds((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      updateSettings({ calendar: { ...settings.calendar, calendarIds: next } });
      return next;
    });
  }
  function selectPreset(id) {
    setPreset(id);
    updateSettings({ calendar: { ...settings.calendar, defaultPreset: id } });
  }
  function toggleDocType(key) {
    setSelectedDocTypes((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      updateSettings({ calendar: { ...settings.calendar, docTypes: next } });
      return next;
    });
  }

  // ── Fetch appointments, parse names, match Drive folders, detect dupes ──
  async function handleFetchAppointments() {
    if (!driveConnected) { addLog('Google Drive not connected. Go to Settings first.', 'error'); return; }
    if (!calendarScopeGranted) { addLog('Calendar not connected. Go to Settings to connect Calendar.', 'error'); return; }
    if (selectedCalendarIds.length === 0) { addLog('Select at least one calendar.', 'error'); return; }

    setPhase(PHASE.LOADING);
    setLog([]);
    setAppointments([]);
    setSummary(null);

    const timeZone = getEffectiveTimeZone(settings);
    let range;
    try {
      range = getPresetRange(preset, { timeZone, customStart, customEnd });
    } catch (e) {
      addLog(e.message, 'error');
      setPhase(PHASE.IDLE);
      return;
    }

    try {
      addLog(`Fetching appointments (${DATE_PRESETS.find((p) => p.id === preset)?.label})…`);
      const [{ events: allEvents, errors }, root] = await withRetry(
        () => Promise.all([
          listEventsForCalendars(selectedCalendarIds, { ...range, timeZone }),
          findPatientFormsFolder(),
        ]),
        { retries: 2, onRetry: (e, n) => addLog(`⟳ Retry ${n}/2 loading appointments: ${e.message}`, 'warn') },
      );
      errors.forEach((e) => addLog(`⚠ Calendar ${e.calendarId}: ${e.message}`, 'warn'));
      addLog(`Found ${allEvents.length} appointment(s) across ${selectedCalendarIds.length} calendar(s).`);

      const skipPatterns = calendarSettings.skipPatterns || [];
      const events = skipPatterns.length ? allEvents.filter((ev) => !shouldSkipEvent(ev, skipPatterns)) : allEvents;
      const skippedCount = allEvents.length - events.length;
      if (skippedCount > 0) addLog(`Skipped ${skippedCount} non-patient event(s) per saved skip patterns.`);

      const subfolders = await withRetry(
        () => listSubfolders(root.id),
        { retries: 2, onRetry: (e, n) => addLog(`⟳ Retry ${n}/2 loading patient folders: ${e.message}`, 'warn') },
      );
      knownPatientsRef.current = subfolders;
      addLog(`Found ${subfolders.length} patient folder(s) in Drive.`);

      const existingRaw = await fetchExistingCalendarNotes(selectedCalendarIds, range);
      const existingIndex = buildExistingNoteIndex(existingRaw);

      const provider = settings.aiProvider || 'gemini';
      const keys = getProviderKeys(settings);
      const useAiFallback = !!calendarSettings.useAiFallback;
      const calendarNameById = Object.fromEntries(calendars.map((c) => [c.id, c.summary]));

      const items = [];
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        updateProgress(Math.round((i / Math.max(events.length, 1)) * 100), i + 1, events.length, `Parsing "${ev.title}"…`);

        const parsed = await parseAppointment(ev, {
          knownPatients: subfolders, aliases: calendarSettings.aliases, useAiFallback,
          provider, keys, model: settings.aiModel || undefined,
        });

        const parsedName = parsed.name || '';
        // 'known-patient-ambiguous' means the parser found multiple known-patient
        // name mentions in the text but couldn't pick one — surface those directly
        // as folder candidates instead of leaving the reviewer with nothing to pick.
        let candidates = parsedName ? matchPatientFolders(parsedName, subfolders) : [];
        if (!parsedName && parsed.candidates?.length) {
          candidates = subfolders.filter((f) => parsed.candidates.includes(f.name));
        }
        const folderStatus = candidates.length ? classifyMatch(candidates) : (parsedName ? 'not_found' : 'pending');
        let files = [];
        if (folderStatus === 'matched') {
          try { files = await listPatientFiles(candidates[0].id); } catch (e) {
            addLog(`Could not list files for ${parsedName}: ${e.message}`, 'warn');
          }
        }

        const perDocType = {};
        for (const dt of DOCUMENT_TYPES) {
          const canonicalType = CANONICAL_DOCUMENT_TYPE[dt.key] || dt.key;
          const existing = findExistingNote(existingIndex, {
            calendarId: ev.calendarId, eventId: ev.eventId, occurrenceStart: ev.start, documentType: canonicalType,
          });
          perDocType[dt.key] = {
            existingNote: existing,
            status: existing ? 'duplicate' : 'idle',
            generatedOutput: null, approved: true, error: null, outputs: [],
          };
        }

        items.push({
          id: `${ev.eventId}__${ev.start}`,
          eventId: ev.eventId,
          calendarId: ev.calendarId,
          calendarName: calendarNameById[ev.calendarId] || ev.calendarId,
          title: ev.title,
          description: ev.description,
          location: ev.location,
          start: ev.start,
          end: ev.end,
          allDay: ev.allDay,
          durationMinutes: ev.durationMinutes,
          attendees: ev.attendees,
          selected: folderStatus === 'matched' && (parsed.confidence === 'high' || parsed.confidence === 'medium'),
          parsedName,
          parseConfidence: parsed.confidence,
          parseMethod: parsed.method,
          needsNameReview: parsed.needsReview,
          folderCandidates: candidates,
          folderStatus,
          folderId: folderStatus === 'matched' ? candidates[0].id : null,
          folderName: folderStatus === 'matched' ? candidates[0].name : null,
          files,
          perDocType,
        });
      }

      setAppointments(items);
      setPhase(PHASE.REVIEW_APPTS);
      addLog(`\n✅ Loaded ${items.length} appointment(s). Review matches before generating.`);
    } catch (e) {
      addLog(`Error: ${e.message}`, 'error');
      setPhase(PHASE.IDLE);
    }
  }

  async function rematchAppointment(id, name) {
    const candidates = matchPatientFolders(name, knownPatientsRef.current);
    const folderStatus = classifyMatch(candidates);
    let files = [];
    if (folderStatus === 'matched') {
      try { files = await listPatientFiles(candidates[0].id); } catch (e) {
        addLog(`Could not list files for ${name}: ${e.message}`, 'warn');
      }
    }
    updateAppointment(id, {
      folderCandidates: candidates, folderStatus,
      folderId: folderStatus === 'matched' ? candidates[0].id : null,
      folderName: folderStatus === 'matched' ? candidates[0].name : null,
      files,
    });
  }

  function handleNameEdit(id, name) {
    updateAppointment(id, { parsedName: name, needsNameReview: false, parseConfidence: 'high', parseMethod: 'manual' });
  }

  // ── Aliases & skip patterns — let a one-time correction (or a known
  //    non-patient event) stick, instead of the reviewer redoing the same
  //    fix by hand every time the same calendar title recurs. ──
  function saveAliasForAppointment(id) {
    const appt = appointments.find((a) => a.id === id);
    const raw = appt?.title?.trim();
    if (!raw || !appt.parsedName) return;
    updateSettings({ calendar: { ...settings.calendar, aliases: { ...settings.calendar.aliases, [raw]: appt.parsedName } } });
    updateAppointment(id, { parseMethod: 'alias', parseConfidence: 'high', needsNameReview: false });
    addLog(`Remembered "${raw}" → ${appt.parsedName} for future appointments.`);
  }

  function removeAlias(raw) {
    const next = { ...settings.calendar.aliases };
    delete next[raw];
    updateSettings({ calendar: { ...settings.calendar, aliases: next } });
  }

  function skipEventPattern(id) {
    const appt = appointments.find((a) => a.id === id);
    const raw = appt?.title?.trim();
    if (!raw) return;
    const current = settings.calendar.skipPatterns || [];
    if (!current.includes(raw)) {
      updateSettings({ calendar: { ...settings.calendar, skipPatterns: [...current, raw] } });
    }
    setAppointments((prev) => prev.filter((a) => a.id !== id));
    addLog(`"${raw}" will be skipped on future loads.`);
  }

  function addSkipPatternFromInput() {
    const raw = newSkipPattern.trim();
    if (!raw) return;
    const current = settings.calendar.skipPatterns || [];
    if (!current.includes(raw)) {
      updateSettings({ calendar: { ...settings.calendar, skipPatterns: [...current, raw] } });
    }
    setNewSkipPattern('');
  }

  function removeSkipPattern(raw) {
    updateSettings({ calendar: { ...settings.calendar, skipPatterns: (settings.calendar.skipPatterns || []).filter((p) => p !== raw) } });
  }

  async function resolveAmbiguousFolder(id, folderId) {
    const appt = appointments.find((a) => a.id === id);
    const candidate = appt?.folderCandidates.find((c) => c.id === folderId);
    if (!candidate) return;
    try {
      const files = await listPatientFiles(candidate.id);
      updateAppointment(id, {
        folderStatus: 'matched', folderId: candidate.id, folderName: candidate.name, files,
        // The known-patient-ambiguous parse path leaves parsedName blank (no single
        // confident name) — picking a candidate here resolves the name too, so the
        // reviewer doesn't also have to retype it before generating.
        ...(appt.parsedName ? {} : { parsedName: candidate.name, needsNameReview: false }),
      });
    } catch (e) {
      updateAppointment(id, { folderStatus: 'not_found' });
      addLog(`Could not resolve folder: ${e.message}`, 'error');
    }
  }

  function toggleSelected(id) {
    updateAppointment(id, { selected: !appointments.find((a) => a.id === id)?.selected });
  }

  const filteredAppointments = useMemo(() => {
    let list = appointments;
    if (statusFilter !== 'all') list = list.filter((a) => effectiveApptStatus(a) === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => a.title.toLowerCase().includes(q)
        || a.parsedName.toLowerCase().includes(q)
        || a.description.toLowerCase().includes(q));
    }
    return list;
  }, [appointments, statusFilter, search]);

  function toggleSelectAllVisible() {
    const ids = filteredAppointments.map((a) => a.id);
    const allSelected = ids.length > 0 && ids.every((id) => appointments.find((a) => a.id === id)?.selected);
    setAppointments((prev) => prev.map((a) => (ids.includes(a.id) ? { ...a, selected: !allSelected } : a)));
  }

  // ── Generate (in memory only) ────────────────────────────────────────
  async function handleGenerate() {
    if (selectedDocTypes.length === 0) { addLog('Select at least one document type.', 'error'); return; }

    const provider = settings.aiProvider || 'gemini';
    const keys = getProviderKeys(settings);
    if (!isProviderConfigured(provider, keys)) {
      addLog(`${AI_PROVIDERS[provider]?.label || provider} API key not configured. Go to Settings.`, 'error'); return;
    }

    const workItems = [];
    for (const appt of appointments) {
      if (!appt.selected) continue;
      if (appt.needsNameReview) { addLog(`Skipping "${appt.title}" — patient name needs review.`, 'warn'); continue; }
      if (appt.folderStatus !== 'matched') { addLog(`Skipping "${appt.title}" — folder not resolved.`, 'warn'); continue; }
      for (const docKey of selectedDocTypes) {
        if (appt.perDocType[docKey]?.status === 'duplicate') continue;
        workItems.push({ apptId: appt.id, docKey });
      }
    }

    if (workItems.length === 0) {
      addLog('Nothing to generate — resolve appointments, or all selected document types were already generated.', 'error');
      return;
    }

    setPhase(PHASE.GENERATING);
    abortRef.current = false;
    const total = workItems.length;
    updateProgress(0, 0, total, 'Starting...');
    const systemPrompt = buildSystemPrompt(settings.detailLevel);

    // A date range commonly holds several appointments for the same
    // patient — each one selected for treatment_plan would otherwise
    // independently bootstrap its own near-identical First Session Note
    // from the same oldest source file. Track which (patient, source file)
    // pairs already got one this run and skip the rest, attaching the
    // already-generated note's key as their dependency instead.
    const bootstrapKeyBySourceFile = new Map(); // `${patientName}::${fileId}` -> apptId that holds the generated note

    for (let i = 0; i < workItems.length; i++) {
      if (abortRef.current) { addLog('\n⏹ Generation cancelled.', 'warn'); break; }
      const { apptId, docKey } = workItems[i];
      const appt = appointments.find((a) => a.id === apptId);
      const meta = getDocumentTypeMeta(docKey);
      updateProgress(Math.round((i / total) * 100), i + 1, total, `${appt.parsedName} — ${meta.label}`);
      setDocTypeStatus(apptId, docKey, { status: 'generating', genPercent: 0 });
      addLog(`\n━━━ ${i + 1}/${total}: ${appt.parsedName} — ${meta.label} ━━━`);

      try {
        const patient = { name: appt.parsedName, folderId: appt.folderId, folderName: appt.folderName, files: appt.files };
        const sessionSourcePatterns = resolveSessionSourcePatterns(settings);

        // session_note: prefer the one Zoom/Gemini file whose date is closest
        // to this appointment, instead of dumping every session file in the
        // folder into context (the appointment already tells us which
        // session this note is for).
        let selectedFiles = null; // null = use every file, same as before
        if (docKey === 'session_note') {
          const best = pickBestSessionFile(appt.files, appt.start, sessionSourcePatterns);
          if (best) {
            const extras = appt.files.filter((f) => f.id !== best.id && !isSessionSourceFile(f.name, sessionSourcePatterns));
            selectedFiles = [best, ...extras];
          }
        }

        // treatment_plan: bootstrap a Pass-1 DARP note from the oldest
        // session file, same as the Batch Processor. Unlike Batch Processor,
        // it's not tied to a calendar occurrence (see BOOTSTRAP_DOC_KEY) —
        // but it IS now saved as a real session note, same template, once
        // approved, so the first visit still ends up with an actual note on
        // record instead of the context being thrown away after use.
        let bootstrapNoteHtml = null;
        if (docKey === 'treatment_plan') {
          const sessionFiles = getSessionSourceFiles(appt.files, sessionSourcePatterns);
          if (sessionFiles.length > 0) {
            const oldest = sessionFiles[0];
            const sourceKey = `${patient.name}::${oldest.id}`;
            const reused = bootstrapKeyBySourceFile.get(sourceKey);
            if (reused) {
              // Another appointment for this same patient already bootstrapped
              // a note from this same oldest file earlier in this run — reuse
              // its content as context instead of generating (and later
              // potentially saving) a near-duplicate.
              bootstrapNoteHtml = reused.html;
              addLog(`  ↺ Reusing First Session Note generated earlier this run for ${patient.name}.`);
            } else {
              addLog(`  🔮 Generating First Session Note from ${oldest.name}...`);
              try {
                const { sourceText: bootstrapSourceText, sourceFileList: bootstrapFileList } =
                  await collectSourceText(patient, (msg, type) => addLog(`    ${msg}`, type), [oldest]);
                if (bootstrapFileList.length > 0) {
                  const { outputHtml: bootstrapHtml } = await withRetry(
                    () => generateDocumentForPatient({
                      patient, docTypeKey: 'session_note', sourceText: bootstrapSourceText, systemPrompt, provider, keys,
                      model: settings.aiModel || undefined, getTemplateHtml, fetchLatestDocument,
                      onLog: (msg, type) => addLog(`    ${msg}`, type),
                    }),
                    { retries: 2, onRetry: (e, n) => addLog(`    ⟳ Retry ${n}/2: ${e.message}`, 'warn') },
                  );
                  bootstrapNoteHtml = bootstrapHtml;
                  bootstrapKeyBySourceFile.set(sourceKey, { apptId, html: bootstrapHtml });
                  setDocTypeStatus(apptId, BOOTSTRAP_DOC_KEY, {
                    status: 'generated',
                    generatedOutput: { html: bootstrapHtml, sourceFileList: bootstrapFileList },
                    dateForFilename: oldest.extractedDate || null,
                    approved: true, error: null,
                  });
                  addLog(`  ✓ First Session Note generated — review it below before saving.`);
                }
              } catch (e) {
                addLog(`  ⚠ Could not generate First Session Note context: ${e.message} — continuing without it.`, 'warn');
              }
            }
          }
        }

        const { sourceText, sourceFileList } = await collectSourceText(patient, (msg, type) => addLog(`  ${msg}`, type), selectedFiles);

        if (sourceFileList.length === 0) {
          addLog(`  ✅ No source files for ${appt.parsedName}, skipping.`);
          setDocTypeStatus(apptId, docKey, { status: 'skipped', error: 'No source files' });
          continue;
        }

        let lastGenPercent = -1;
        const { outputHtml, templateLabel } = await withRetry(
          () => generateDocumentForPatient({
            patient, docTypeKey: docKey, sourceText, systemPrompt, provider, keys,
            model: settings.aiModel || undefined, getTemplateHtml, fetchLatestDocument, bootstrapNoteHtml,
            onLog: (msg, type) => addLog(`  ${msg}`, type),
            onChunk: (_delta, fullText) => {
              const pct = estimateGenerationPercent(settings.detailLevel, fullText.length);
              if (pct !== lastGenPercent) {
                lastGenPercent = pct;
                setDocTypeStatus(apptId, docKey, { genPercent: pct });
              }
            },
          }),
          { retries: 2, onRetry: (e, n) => { lastGenPercent = -1; setDocTypeStatus(apptId, docKey, { genPercent: 0 }); addLog(`  ⟳ Retry ${n}/2: ${e.message}`, 'warn'); } },
        );

        addLog(`  ✓ ${templateLabel} generated`);
        setDocTypeStatus(apptId, docKey, {
          status: 'generated', generatedOutput: { html: outputHtml, sourceFileList }, approved: true, error: null,
        });
      } catch (e) {
        addLog(`  ❌ Error: ${e.message}`, 'error');
        setDocTypeStatus(apptId, docKey, { status: 'error', error: e.message, approved: false });
      }
    }

    setPhase(PHASE.REVIEW_DOCS);
    addLog('\n✅ Generation complete — review before saving.');
  }

  const reviewItemsList = useMemo(() => {
    const rows = [];
    for (const appt of appointments) {
      for (const [docKey, dt] of Object.entries(appt.perDocType || {})) {
        if (dt.status === 'generated' || dt.status === 'error') {
          rows.push({ apptId: appt.id, docKey, appt, dt, meta: metaForDocKey(docKey) });
        }
      }
    }
    return rows;
  }, [appointments]);

  function toggleApprove(apptId, docKey) {
    const appt = appointments.find((a) => a.id === apptId);
    setDocTypeStatus(apptId, docKey, { approved: !appt.perDocType[docKey].approved });
  }
  function updateGeneratedHtml(apptId, docKey, html) {
    const appt = appointments.find((a) => a.id === apptId);
    setDocTypeStatus(apptId, docKey, { generatedOutput: { ...appt.perDocType[docKey].generatedOutput, html } });
  }
  function togglePreview(rowKey) {
    setPreviewMode((prev) => ({ ...prev, [rowKey]: prev[rowKey] === 'raw' ? 'rendered' : 'raw' }));
  }

  // ── Save approved documents ──────────────────────────────────────────
  async function handleSaveApproved() {
    const workItems = [];
    for (const appt of appointments) {
      for (const [docKey, dt] of Object.entries(appt.perDocType || {})) {
        if (dt.status === 'generated' && dt.approved) workItems.push({ apptId: appt.id, docKey });
      }
    }
    if (workItems.length === 0) { addLog('No approved documents to save.', 'error'); return; }

    setPhase(PHASE.SAVING);
    abortRef.current = false;
    setSaveWasCancelled(false);
    const auditRows = [];
    const total = workItems.length;
    updateProgress(0, 0, total, 'Saving...');

    for (let i = 0; i < workItems.length; i++) {
      if (abortRef.current) { addLog('\n⏹ Save cancelled.', 'warn'); setSaveWasCancelled(true); break; }
      const { apptId, docKey } = workItems[i];
      const appt = appointments.find((a) => a.id === apptId);
      const dt = appt.perDocType[docKey];
      const isBootstrap = docKey === BOOTSTRAP_DOC_KEY;
      const meta = metaForDocKey(docKey);
      setDocTypeStatus(apptId, docKey, { status: 'saving' });
      updateProgress(Math.round((i / total) * 100), i + 1, total, `Saving ${appt.parsedName}...`);

      try {
        const patient = { name: appt.parsedName, folderId: appt.folderId, folderName: appt.folderName };
        const { savedOutputs } = await withRetry(
          // Every other note here is linked to the calendar occurrence that
          // produced it — the bootstrap note deliberately isn't (see
          // BOOTSTRAP_DOC_KEY), so it saves as an ordinary, unlinked session
          // note under its real canonical type.
          () => saveGeneratedDocument({
            patient, docTypeKey: isBootstrap ? 'session_note' : docKey, outputHtml: dt.generatedOutput.html, settings,
            provider: settings.aiProvider || 'gemini', model: settings.aiModel || undefined,
            saveDocument, saveReport, source: 'manual',
            calendarLink: isBootstrap ? null : {
              calendarId: appt.calendarId, eventId: appt.eventId, occurrenceStart: appt.start,
              durationMinutes: appt.durationMinutes,
            },
            // saveGeneratedDocument only names the file from fileNameBase (or
            // today) — dateOfServiceOverride alone doesn't reach the
            // filename, just the auto-created billing entry — so the
            // bootstrap needs its own source-dated fileNameBase too, or its
            // file name would say today while its content is about an older
            // session.
            fileNameBase: isBootstrap && dt.dateForFilename
              ? computeOutputFileNameBase(settings.namingConvention, 'session_note', appt.parsedName, dt.dateForFilename)
              : null,
            dateOfServiceOverride: isBootstrap ? (dt.dateForFilename || null) : null,
            findDocumentByDriveUrl,
          }),
          { retries: 2, onRetry: (e, n) => addLog(`  ⟳ Retry ${n}/2: ${e.message}`, 'warn') },
        );
        setDocTypeStatus(apptId, docKey, { status: 'done', outputs: savedOutputs });
        auditRows.push({ name: appt.parsedName, docType: meta.label, status: 'done', outputs: savedOutputs });
        addLog(`  ✅ Saved ${meta.label} for ${appt.parsedName}`);
      } catch (e) {
        setDocTypeStatus(apptId, docKey, { status: 'error', error: e.message });
        auditRows.push({ name: appt.parsedName, docType: meta.label, status: 'error', error: e.message, outputs: [] });
        addLog(`  ❌ Save failed: ${e.message}`, 'error');
      }
    }

    updateProgress(100, total, total, 'Complete');
    setSummary(auditRows);
    setPhase(PHASE.DONE);
    addLog('\n✅ Batch save complete.');
  }

  function handleCancel() { abortRef.current = true; }
  function handleReset() {
    setPhase(PHASE.IDLE);
    setAppointments([]);
    setLog([]);
    setSummary(null);
    setSaveWasCancelled(false);
    sessionStorage.removeItem(STORAGE_KEY);
  }

  const busy = phase === PHASE.LOADING || phase === PHASE.GENERATING || phase === PHASE.SAVING;

  return (
    <div className="min-h-full bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto">

        {phase === PHASE.IDLE && resumeBanner && (
          <div className="mb-5 rounded-2xl border border-teal-500/25 bg-teal-500/8 px-5 py-4 flex items-center gap-3">
            <History className="w-4 h-4 text-teal-400 flex-shrink-0" />
            <p className="text-xs text-teal-200 flex-1">
              <strong className="text-teal-300">An interrupted Calendar Notes run was found</strong>{' '}
              ({resumeBanner.appointments?.length || 0} appointment(s), last active {new Date(resumeBanner.ts).toLocaleString()}). Resume?
            </p>
            <button onClick={handleResume} className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-black transition-all">Resume</button>
            <button onClick={handleDiscardResume} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-xs font-bold transition-all">Discard</button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-600 to-cyan-600 flex items-center justify-center">
              <CalendarDays className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black text-white">Calendar Notes</h1>
              <p className="text-xs text-slate-500">Generate clinical documents from calendar appointments</p>
            </div>
          </div>
          {phase !== PHASE.IDLE && (
            <div className="flex items-center gap-2">
              {(phase === PHASE.GENERATING || phase === PHASE.SAVING) && (
                <button onClick={handleCancel} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 text-red-400 hover:text-red-300 text-xs font-bold transition-colors border border-red-500/20">
                  <Ban className="w-3.5 h-3.5" /> Cancel
                </button>
              )}
              <button onClick={handleReset} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white text-xs font-bold transition-colors border border-white/10">
                <RefreshCw className="w-3.5 h-3.5" /> Reset
              </button>
            </div>
          )}
        </div>

        <WizardSteps steps={WIZARD_STEPS} currentIndex={wizardStepIndex(phase, saveWasCancelled)} accent="sky" />

        {!driveConnected && (
          <div className="mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 flex gap-3 items-start">
            <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300/80 leading-relaxed">
              <strong className="text-amber-300">Google Drive not connected.</strong> Connect in{' '}
              <a href="/settings" className="underline hover:text-white">Settings</a> — Calendar Notes still matches appointments to patient folders in Drive.
            </p>
          </div>
        )}
        {driveConnected && !calendarScopeGranted && (
          <div className="mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 flex gap-3 items-start">
            <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300/80 leading-relaxed">
              <strong className="text-amber-300">Calendar not connected.</strong> Go to{' '}
              <a href="/settings" className="underline hover:text-white">Settings</a> to grant read-only Calendar access (Drive access is preserved).
            </p>
          </div>
        )}

        {/* ── Config: calendars, date presets, doc types ── */}
        {(phase === PHASE.IDLE || phase === PHASE.LOADING) && calendarScopeGranted && (
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 mb-5 space-y-5">
            {/* Calendar selector */}
            <div>
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2">Calendars</h2>
              {calendarsLoading ? (
                <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading calendars…</p>
              ) : calendarsError ? (
                <p className="text-xs text-red-400">{calendarsError}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {calendars.map((c) => {
                    const checked = selectedCalendarIds.includes(c.id);
                    return (
                      <label key={c.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-all text-xs font-bold ${
                        checked ? 'border-sky-500/40 bg-sky-500/10 text-sky-200' : 'border-white/10 bg-white/3 text-slate-400 hover:bg-white/6'
                      }`}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleCalendar(c.id)} className="w-3.5 h-3.5 rounded accent-sky-500" />
                        {c.summary}{c.primary && <span className="text-[10px] opacity-60">(primary)</span>}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Date presets — every preset has identical visual weight, including Last 90 Days */}
            <div>
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2">Date Range</h2>
              <div className="flex flex-wrap gap-2">
                {DATE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectPreset(p.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      preset === p.id ? 'bg-sky-600 border-sky-500 text-white' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {preset === 'custom' && (
                <div className="flex items-center gap-3 mt-3">
                  <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                    className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500/40" />
                  <span className="text-xs text-slate-500">to</span>
                  <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                    className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500/40" />
                </div>
              )}
            </div>

            {/* Document types (multiple) */}
            <div>
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2">Document Types to Generate</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {DOCUMENT_TYPES.map((t) => {
                  const checked = selectedDocTypes.includes(t.key);
                  return (
                    <label key={t.key} className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-all text-xs font-bold ${
                      checked ? 'border-teal-500/40 bg-teal-500/10 text-teal-200' : 'border-white/10 bg-white/3 text-slate-400 hover:bg-white/6'
                    }`}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggleDocType(t.key)} className="w-3.5 h-3.5 rounded accent-teal-500" />
                      {t.label}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Remembered name matches & skipped events — a corrected name or a
                skipped non-patient event can be saved from the appointment table
                below (bookmark / ban icons); this panel is where they're
                reviewed or removed later. */}
            <div>
              <button
                onClick={() => setShowMatchSettings((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white transition-colors"
              >
                <Settings2 className="w-3.5 h-3.5" />
                Manage Remembered Names & Skipped Events
                {((Object.keys(calendarSettings.aliases || {}).length) + (calendarSettings.skipPatterns || []).length) > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-white/10 text-[10px]">
                    {Object.keys(calendarSettings.aliases || {}).length + (calendarSettings.skipPatterns || []).length}
                  </span>
                )}
              </button>

              {showMatchSettings && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl border border-white/10 bg-white/3">
                  <div>
                    <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2">Remembered Name Matches</h3>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {Object.entries(calendarSettings.aliases || {}).length === 0 && (
                        <p className="text-[11px] text-slate-600">None yet — click the bookmark icon next to a corrected name below to remember it.</p>
                      )}
                      {Object.entries(calendarSettings.aliases || {}).map(([raw, canonical]) => (
                        <div key={raw} className="flex items-center gap-2 text-xs bg-slate-800 rounded-lg px-2.5 py-1.5">
                          <span className="text-slate-400 truncate flex-1 min-w-0">"{raw}" → <span className="text-white font-bold">{canonical}</span></span>
                          <button onClick={() => removeAlias(raw)} className="flex-shrink-0 text-slate-600 hover:text-red-400" aria-label={`Remove alias for ${raw}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2">Skipped Events</h3>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        value={newSkipPattern}
                        onChange={(e) => setNewSkipPattern(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkipPatternFromInput(); } }}
                        placeholder="e.g. Chef Unity"
                        className="flex-1 min-w-0 bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-sky-500/40"
                      />
                      <button onClick={addSkipPatternFromInput} className="flex-shrink-0 p-1.5 rounded-lg bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 transition-colors" aria-label="Add skip pattern">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                      {(calendarSettings.skipPatterns || []).length === 0 && (
                        <p className="text-[11px] text-slate-600">None yet — events whose title or description contains any of these are excluded before parsing.</p>
                      )}
                      {(calendarSettings.skipPatterns || []).map((raw) => (
                        <div key={raw} className="flex items-center gap-2 text-xs bg-slate-800 rounded-lg px-2.5 py-1.5">
                          <span className="text-slate-300 truncate flex-1 min-w-0">"{raw}"</span>
                          <button onClick={() => removeSkipPattern(raw)} className="flex-shrink-0 text-slate-600 hover:text-red-400" aria-label={`Remove skip pattern ${raw}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={handleFetchAppointments}
              disabled={busy || selectedCalendarIds.length === 0}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 text-white text-sm font-black transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-sky-500/20"
            >
              {phase === PHASE.LOADING ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading appointments…</> : <><Search className="w-4 h-4" /> Load Appointments</>}
            </button>
          </div>
        )}

        {/* Progress bar */}
        {(phase === PHASE.LOADING || phase === PHASE.GENERATING || phase === PHASE.SAVING) && (
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 mb-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
                <h2 className="text-sm font-black text-white">
                  {phase === PHASE.LOADING ? 'Loading & Parsing' : phase === PHASE.SAVING ? 'Saving Documents' : 'Generating Documents'}
                </h2>
              </div>
              <span className="text-2xl font-black text-sky-300">{progress.percent}%</span>
            </div>
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-gradient-to-r from-sky-600 to-cyan-500 transition-all duration-300 ease-out" style={{ width: `${progress.percent}%` }} />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">{progress.current} of {progress.total}</span>
              <span className="text-slate-400 truncate max-w-md">{progress.step}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-3 space-y-4">

            {/* Appointment table */}
            {(phase === PHASE.REVIEW_APPTS || phase === PHASE.GENERATING) && (
              <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <h2 className="text-sm font-black text-white">Appointments ({filteredAppointments.length})</h2>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
                      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
                        className="pl-8 pr-3 py-1.5 bg-slate-800 border border-white/10 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-sky-500/40 w-40" />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  {STATUS_FILTERS.map((f) => (
                    <button key={f.id} onClick={() => setStatusFilter(f.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                        statusFilter === f.id ? 'bg-sky-500/20 border-sky-500/40 text-sky-300' : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {phase === PHASE.REVIEW_APPTS && (
                  <label className="flex items-center gap-1.5 text-xs text-slate-500 mb-2 cursor-pointer">
                    <input type="checkbox" onChange={toggleSelectAllVisible}
                      checked={filteredAppointments.length > 0 && filteredAppointments.every((a) => a.selected)}
                      className="w-3.5 h-3.5 rounded accent-sky-500" />
                    Select all visible
                  </label>
                )}

                <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
                  {filteredAppointments.map((appt) => (
                    <div key={appt.id} className={`rounded-xl border p-3 ${
                      appt.folderStatus === 'not_found' ? 'border-red-500/30 bg-red-500/5'
                      : appt.folderStatus === 'ambiguous' || appt.needsNameReview ? 'border-amber-500/30 bg-amber-500/5'
                      : 'border-white/10 bg-white/3'
                    }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <input type="checkbox" checked={appt.selected} onChange={() => toggleSelected(appt.id)}
                            className="w-4 h-4 rounded accent-sky-500 mt-0.5 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-white truncate">{appt.title}</p>
                            <p className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                              <CalendarClock className="w-3 h-3" />
                              {new Date(appt.start).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: appt.allDay ? undefined : 'short' })}
                              <span className="text-slate-600">·</span> {appt.calendarName}
                              {appt.durationMinutes != null && <><span className="text-slate-600">·</span> {appt.durationMinutes} min</>}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => skipEventPattern(appt.id)}
                          title={`Never show "${appt.title}" again — skips it on future loads too`}
                          className="flex-shrink-0 p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Patient name (editable) + confidence */}
                      <div className="flex items-center gap-2 mb-2 pl-6">
                        <input
                          value={appt.parsedName}
                          onChange={(e) => handleNameEdit(appt.id, e.target.value)}
                          onBlur={(e) => rematchAppointment(appt.id, e.target.value)}
                          placeholder="Patient name…"
                          className="flex-1 min-w-0 bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-sky-500/40"
                        />
                        {appt.parsedName && appt.parseMethod !== 'alias' && (
                          <button
                            onClick={() => saveAliasForAppointment(appt.id)}
                            title={`Remember "${appt.title}" → ${appt.parsedName} for future appointments`}
                            className="flex-shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-sky-300 hover:bg-sky-500/10 transition-colors"
                          >
                            <BookmarkPlus className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${confidenceBadge(appt.parseConfidence)}`}>
                          {appt.parseMethod === 'manual' ? 'manual' : appt.parseMethod === 'alias' ? 'remembered' : `${appt.parseConfidence} confidence`}
                        </span>
                        <FolderStatusBadge status={appt.folderStatus} />
                      </div>

                      {/* Ambiguous folder resolution */}
                      {appt.folderStatus === 'ambiguous' && (
                        <div className="pl-6 mb-2">
                          <p className="text-xs text-amber-400 flex items-center gap-1 mb-1.5">
                            <HelpCircle className="w-3 h-3" /> Matched {appt.folderCandidates.length} folders — pick one:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {appt.folderCandidates.map((c) => (
                              <button key={c.id} onClick={() => resolveAmbiguousFolder(appt.id, c.id)}
                                className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold transition-colors">
                                {c.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {appt.folderStatus === 'not_found' && appt.parsedName && (
                        <p className="pl-6 text-xs text-red-400 flex items-center gap-1 mb-2">
                          <AlertTriangle className="w-3 h-3" /> No matching Drive folder for "{appt.parsedName}".
                        </p>
                      )}

                      {/* Per-doc-type status */}
                      <div className="pl-6 flex flex-wrap gap-3">
                        {selectedDocTypes.map((dk) => {
                          const dtStatus = appt.perDocType[dk] || {};
                          return (
                            <div key={dk} className="flex flex-col gap-1 min-w-[6rem]">
                              <div className="flex items-center gap-1">
                                <span className="text-[11px] text-slate-600">{getDocumentTypeMeta(dk)?.label}:</span>
                                <DocTypeStatusBadge status={dtStatus.status || 'idle'} />
                              </div>
                              {dtStatus.status === 'generating' && (
                                <div
                                  role="progressbar"
                                  aria-label={`Generating ${getDocumentTypeMeta(dk)?.label} for ${appt.parsedName}`}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-valuenow={dtStatus.genPercent || 0}
                                  className="w-full h-1 bg-slate-800 rounded-full overflow-hidden"
                                >
                                  <div
                                    className="h-full bg-gradient-to-r from-sky-600 to-cyan-500 transition-all duration-300 ease-out"
                                    style={{ width: `${dtStatus.genPercent || 0}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {appt.files.length > 0 && (
                        <p className="pl-6 mt-1.5 text-[11px] text-slate-600 flex items-center gap-1">
                          <List className="w-3 h-3" /> {appt.files.length} source file(s) found
                        </p>
                      )}
                    </div>
                  ))}
                  {filteredAppointments.length === 0 && (
                    <p className="text-xs text-slate-600 text-center py-8">No appointments match the current filter.</p>
                  )}
                </div>

                {phase === PHASE.REVIEW_APPTS && (
                  <button
                    onClick={handleGenerate}
                    disabled={!appointments.some((a) => a.selected) || selectedDocTypes.length === 0}
                    className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-black transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
                  >
                    <Play className="w-4 h-4" /> Generate Selected
                    <span className="text-xs opacity-70">({appointments.filter((a) => a.selected).length} appointment(s))</span>
                  </button>
                )}
              </div>
            )}

            {/* Review queue */}
            {phase === PHASE.REVIEW_DOCS && (
              <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
                <h2 className="text-sm font-black text-white mb-3">Review Before Saving</h2>
                <div className="space-y-3">
                  {reviewItemsList.map(({ apptId, docKey, appt, dt, meta }) => {
                    const rowKey = `${apptId}__${docKey}`;
                    return (
                      <div key={rowKey} className={`rounded-xl border p-3 ${dt.status === 'error' ? 'border-red-500/30 bg-red-500/5' : 'border-white/10 bg-white/3'}`}>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {dt.status === 'generated' && (
                              <input type="checkbox" checked={dt.approved} onChange={() => toggleApprove(apptId, docKey)} className="w-4 h-4 rounded accent-teal-500 flex-shrink-0" />
                            )}
                            <span className="text-sm font-bold text-white truncate">{appt.parsedName} — {meta.label}</span>
                            <DocTypeStatusBadge status={dt.status} />
                          </div>
                          {dt.status === 'generated' && (
                            <button onClick={() => togglePreview(rowKey)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors flex-shrink-0">
                              <Code className="w-3.5 h-3.5" /> {previewMode[rowKey] === 'raw' ? 'Preview' : 'Edit HTML'}
                            </button>
                          )}
                        </div>
                        {dt.status === 'error' && <p className="text-xs text-red-400">{dt.error}</p>}
                        {dt.status === 'generated' && (
                          previewMode[rowKey] === 'raw' ? (
                            <textarea value={dt.generatedOutput.html} onChange={(e) => updateGeneratedHtml(apptId, docKey, e.target.value)} rows={10}
                              className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-300 font-mono focus:outline-none focus:border-teal-500/40 resize-y" />
                          ) : (
                            <iframe title={`preview-${rowKey}`} sandbox="" srcDoc={dt.generatedOutput.html} className="w-full h-64 rounded-lg border border-white/10 bg-white" />
                          )
                        )}
                        {dt.status === 'generated' && (
                          <ClientFacingActions documentHtml={dt.generatedOutput.html} patientName={appt.parsedName} />
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={handleSaveApproved}
                  disabled={!reviewItemsList.some((r) => r.dt.status === 'generated' && r.dt.approved)}
                  className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-black transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
                >
                  <Save className="w-4 h-4" /> Save Approved Documents to Drive
                </button>
              </div>
            )}
          </div>

          {/* Activity log */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 h-full flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <h2 className="text-xs font-black text-slate-400 uppercase tracking-wider">Activity Log</h2>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 max-h-80 lg:max-h-[600px] font-mono text-[11px]">
                {log.length === 0 && <p className="text-slate-600 italic">Log output will appear here…</p>}
                {log.map((entry, i) => (
                  <p key={i} className={entry.type === 'error' ? 'text-red-400' : entry.type === 'warn' ? 'text-amber-400' : 'text-slate-400'}>
                    <span className="text-slate-700 mr-1">{entry.ts}</span>{entry.msg}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Summary */}
        {phase === PHASE.DONE && summary && (
          <div className="mt-6 bg-slate-900 border border-white/10 rounded-2xl p-6">
            <h2 className="text-sm font-black text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Batch Summary
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
              {[
                { label: 'Total',     value: summary.length, color: 'text-white' },
                { label: 'Completed', value: summary.filter((r) => r.status === 'done').length, color: 'text-emerald-400' },
                { label: 'Errors',    value: summary.filter((r) => r.status === 'error').length, color: 'text-red-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white/5 rounded-xl p-3 border border-white/10">
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">{label}</p>
                  <p className={`text-2xl font-black ${color}`}>{value}</p>
                </div>
              ))}
            </div>
            <div className="space-y-3">
              {summary.map((row, i) => (
                <div key={i} className={`rounded-xl border p-4 ${row.status === 'done' ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-red-500/25 bg-red-500/5'}`}>
                  <div className="flex items-center gap-3 mb-1">
                    {row.status === 'done' ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" /> : <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
                    <span className="text-sm font-bold text-white">{row.name} — {row.docType}</span>
                  </div>
                  {row.outputs?.length > 0 && (
                    <div className="pl-7 space-y-1">
                      {row.outputs.map((o) => (
                        <a key={o.id} href={o.link} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-200 transition-colors">
                          <FilePlus className="w-3 h-3 flex-shrink-0" /><span className="font-mono">{o.name}</span><Eye className="w-3 h-3 ml-1 opacity-50" />
                        </a>
                      ))}
                    </div>
                  )}
                  {row.error && <p className="pl-7 text-xs text-red-400 mt-1">{row.error}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
