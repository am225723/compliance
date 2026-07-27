import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import Layout from './components/Layout';
import AuthPage from './pages/AuthPage';
import HomeDashboard from './pages/HomeDashboard';
import TemplateViewer from './pages/TemplateViewer';
import BatchProcessor from './pages/BatchProcessor';
import SettingsPage from './pages/SettingsPage';
import ReportsPage from './pages/ReportsPage';
import AutoPilotPage from './pages/AutoPilotPage';
import TemplatesPage from './pages/TemplatesPage';
import CalendarNotesPage from './pages/CalendarNotesPage';
import { Loader2 } from 'lucide-react';

function AuthGuard({ children }) {
  const { session, authLoading } = useApp();

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <img src="/logo.png" alt="Integrative Psychiatry" className="w-16 h-16 animate-pulse" />
          <Loader2 className="w-6 h-6 text-teal-400 animate-spin" />
          <p className="text-xs text-slate-500">Loading…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return children;
}

function AppRoutes() {
  const { session, authLoading } = useApp();

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <img src="/logo.png" alt="Integrative Psychiatry" className="w-16 h-16 animate-pulse" />
          <Loader2 className="w-6 h-6 text-teal-400 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public: auth */}
      <Route
        path="/auth"
        element={session ? <Navigate to="/" replace /> : <AuthPage />}
      />

      {/* Protected: all other routes */}
      <Route
        path="/*"
        element={
          <AuthGuard>
            <Layout>
              <Routes>
                <Route path="/"                element={<HomeDashboard />} />
                <Route path="/batch"           element={<BatchProcessor />} />
                <Route path="/autopilot"       element={<AutoPilotPage />} />
                <Route path="/calendar-notes"  element={<CalendarNotesPage />} />
                <Route path="/reports"         element={<ReportsPage />} />
                <Route path="/templates"       element={<TemplatesPage />} />
                <Route path="/settings"        element={<SettingsPage />} />
                <Route path="/template/:id"    element={<TemplateViewer />} />
                <Route path="*"                element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </AuthGuard>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AppProvider>
  );
}
