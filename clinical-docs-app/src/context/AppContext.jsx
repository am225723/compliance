import { createContext, useContext, useState, useEffect } from 'react';
import { loadSettings, saveSettings } from '../lib/settings';
import { getAccessToken, setAccessToken } from '../lib/googleDrive';
import { supabase } from '../lib/supabase';

const AppContext = createContext(null);

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

  // ── Drive ─────────────────────────────────────────────
  useEffect(() => {
    const token = getAccessToken();
    if (token) { setDriveConnected(true); setDriveToken(token); }
  }, []);

  // ── Load documents when logged in ────────────────────
  useEffect(() => {
    if (session?.user) {
      fetchDocuments();
      fetchReports();
    } else {
      setDocuments([]);
      setReports([]);
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
      .insert({ ...docData, user_id: session.user.id })
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
    setAccessToken(token);
    setDriveToken(token);
    setDriveConnected(true);
    updateSettings({ driveConnected: true });
  }

  function disconnectDrive() {
    setAccessToken(null);
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
      documents, docsLoading, saveDocument, deleteDocument, fetchDocuments,
      // Reports
      reports, reportsLoading, saveReport, deleteReport, fetchReports,
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
