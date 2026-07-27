import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { loadSettings, saveSettings } from '../lib/settings';
import { getAccessToken, isTokenValid, ensureValidToken, clearToken } from '../lib/googleDrive';
import { supabase } from '../lib/supabase';

const AppContext = createContext(null);

// How often to proactively check/refresh the Drive token while the app is open.
const DRIVE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export function AppProvider({ children }) {
  const [settings, setSettingsState] = useState(loadSettings);
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveToken, setDriveToken] = useState(null);

  // Supabase auth state
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Documents cache
  const [documents, setDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);

  // Reports cache
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);

  // Templates cache (Supabase-backed, editable clinical document templates)
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // ── Auth ──────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Drive: rehydrate persisted session on load ─────────
  useEffect(() => {
    if (isTokenValid()) {
      setDriveConnected(true);
      setDriveToken(getAccessToken());
    }
  }, []);

  // ── Drive: keep the token fresh while the app is open ──
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!driveConnected) return;
      try {
        const token = await ensureValidToken();
        setDriveToken(token);
      } catch {
        // Silent refresh failed (no active Google session) — reflect reality in the UI
        // rather than showing a stale "Connected" badge.
        setDriveConnected(false);
        setDriveToken(null);
      }
    }, DRIVE_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [driveConnected]);

  // ── Load documents/reports/templates when logged in ────
  useEffect(() => {
    if (session?.user) {
      fetchDocuments();
      fetchReports();
      fetchTemplates();
    } else {
      setDocuments([]);
      setReports([]);
      setTemplates([]);
    }
  }, [session]);

  async function fetchDocuments() {
    setDocsLoading(true);
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error && data) setDocuments(data);
    setDocsLoading(false);
  }

  async function fetchReports() {
    setReportsLoading(true);
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .order('date_of_service', { ascending: false })
      .limit(200);
    if (!error && data) setReports(data);
    setReportsLoading(false);
  }

  async function saveDocument(docData) {
    if (!session?.user) return null;
    const { data, error } = await supabase
      .from('documents')
      .insert({ source: 'manual', ...docData, user_id: session.user.id })
      .select()
      .single();
    if (!error && data) {
      setDocuments(prev => [data, ...prev]);
      return data;
    }
    console.error('saveDocument error:', error);
    return null;
  }

  async function saveReport(reportData) {
    if (!session?.user) return null;
    const { data, error } = await supabase
      .from('reports')
      .insert({ ...reportData, user_id: session.user.id })
      .select()
      .single();
    if (!error && data) {
      setReports(prev => [data, ...prev]);
      return data;
    }
    console.error('saveReport error:', error);
    return null;
  }

  async function deleteDocument(id) {
    await supabase.from('documents').delete().eq('id', id);
    setDocuments(prev => prev.filter(d => d.id !== id));
  }

  async function deleteReport(id) {
    await supabase.from('reports').delete().eq('id', id);
    setReports(prev => prev.filter(r => r.id !== id));
  }

  async function deleteDocuments(ids) {
    if (!ids.length) return;
    await supabase.from('documents').delete().in('id', ids);
    setDocuments(prev => prev.filter(d => !ids.includes(d.id)));
  }

  async function deleteReports(ids) {
    if (!ids.length) return;
    await supabase.from('reports').delete().in('id', ids);
    setReports(prev => prev.filter(r => !ids.includes(r.id)));
  }

  /** Most recent saved document of a given canonical type for a patient — used to chain
   *  the Treatment Plan into the DARP note prompt automatically. */
  const fetchLatestDocument = useCallback(async (patientName, documentType) => {
    if (!patientName || !documentType) return null;
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('patient_name', patientName)
      .eq('document_type', documentType)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) { console.error('fetchLatestDocument error:', error); return null; }
    return data;
  }, []);

  /** All calendar-linked documents already generated for the given calendars —
   *  used by Calendar Notes to detect and skip duplicate generation. */
  const fetchExistingCalendarNotes = useCallback(async (calendarIds) => {
    if (!calendarIds?.length) return [];
    const { data, error } = await supabase
      .from('documents')
      .select('calendar_id, calendar_event_id, calendar_occurrence_start, document_type, drive_file_url, created_at')
      .in('calendar_id', calendarIds)
      .not('calendar_event_id', 'is', null);
    if (error) { console.error('fetchExistingCalendarNotes error:', error); return []; }
    return data || [];
  }, []);

  // ── Templates ───────────────────────────────────────────
  async function fetchTemplates() {
    setTemplatesLoading(true);
    const { data, error } = await supabase.from('templates').select('*').order('key');
    if (!error && data) setTemplates(data);
    setTemplatesLoading(false);
  }

  async function saveTemplate(key, html, label) {
    if (!session?.user) return null;
    const { data, error } = await supabase
      .from('templates')
      .upsert({ key, html, label, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      .select()
      .single();
    if (!error && data) {
      setTemplates(prev => {
        const next = prev.filter(t => t.key !== key);
        return [...next, data].sort((a, b) => a.key.localeCompare(b.key));
      });
      return data;
    }
    console.error('saveTemplate error:', error);
    return null;
  }

  async function deleteTemplate(key) {
    const { error } = await supabase.from('templates').delete().eq('key', key);
    if (!error) {
      setTemplates(prev => prev.filter(t => t.key !== key));
      return true;
    }
    console.error('deleteTemplate error:', error);
    return false;
  }

  function getTemplateHtml(key) {
    return templates.find(t => t.key === key)?.html || null;
  }

  // ── Settings ──────────────────────────────────────────
  function updateSettings(patch) {
    setSettingsState(prev => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }

  // ── Drive ─────────────────────────────────────────────
  function connectDrive(token) {
    // The token has already been persisted (with accurate expiry) by
    // initGoogleAuth() by the time this is called — just reflect it in state.
    setDriveToken(token);
    setDriveConnected(true);
    updateSettings({ driveConnected: true });
  }

  function disconnectDrive() {
    clearToken();
    setDriveToken(null);
    setDriveConnected(false);
    updateSettings({ driveConnected: false });
  }

  return (
    <AppContext.Provider value={{
      // Settings
      settings, updateSettings,
      // Drive
      driveConnected, driveToken, connectDrive, disconnectDrive,
      // Auth
      session, authLoading,
      user: session?.user ?? null,
      // Documents
      documents, docsLoading, saveDocument, deleteDocument, deleteDocuments, fetchDocuments, fetchLatestDocument,
      fetchExistingCalendarNotes,
      // Reports
      reports, reportsLoading, saveReport, deleteReport, deleteReports, fetchReports,
      // Templates
      templates, templatesLoading, fetchTemplates, saveTemplate, deleteTemplate, getTemplateHtml,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
