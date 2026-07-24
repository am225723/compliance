import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Settings, FileText, LayoutDashboard,
  ClipboardList, ChevronRight, Wifi, WifiOff, Menu, X,
  BarChart3, LogOut, ChevronDown
} from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';

const navItems = [
  { to: '/',         icon: LayoutDashboard, label: 'Dashboard',       sub: 'Home & Recent Docs'     },
  { to: '/batch',    icon: ClipboardList,   label: 'Batch Processor',  sub: 'Generate Clinical Docs' },
  { to: '/reports',  icon: BarChart3,       label: 'Reports',          sub: 'Billing & Visit Data'   },
  { to: '/settings', icon: Settings,        label: 'Settings',         sub: 'AI Keys & Preferences'  },
];

export default function Layout({ children }) {
  const { driveConnected, user } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Hide sidebar on template viewer (full-screen)
  const isViewer = location.pathname.startsWith('/template/');
  if (isViewer) return <>{children}</>;

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/auth');
  }

  const userInitial = user?.email?.[0]?.toUpperCase() ?? 'U';
  const userEmail = user?.email ?? '';

  return (
    <div className="flex h-screen bg-slate-950 overflow-hidden">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 flex flex-col w-64 bg-slate-900 border-r border-white/10
        transform transition-transform duration-200
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0
      `}>
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <img
            src="/logo.png"
            alt="Integrative Psychiatry"
            className="w-10 h-10 object-contain flex-shrink-0"
          />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-teal-400 leading-none mb-0.5">
              Integrative Psychiatry
            </p>
            <p className="text-sm font-black text-white leading-tight truncate">Clinical AI</p>
          </div>
        </div>

        {/* Drive Status */}
        <div className={`mx-4 mt-4 mb-2 px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
          driveConnected
            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
            : 'bg-slate-800 border-white/10 text-slate-500'
        }`}>
          {driveConnected
            ? <><Wifi className="w-3.5 h-3.5" /> Google Drive Connected</>
            : <><WifiOff className="w-3.5 h-3.5" /> Drive Not Connected</>
          }
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-2 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label, sub }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-all group
                ${isActive
                  ? 'bg-teal-600/20 border border-teal-500/30 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                }
              `}
            >
              {({ isActive }) => (
                <>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${
                    isActive ? 'bg-teal-500/20' : 'bg-white/5 group-hover:bg-white/10'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold leading-tight">{label}</p>
                    <p className="text-[10px] text-slate-500 leading-tight truncate">{sub}</p>
                  </div>
                  {isActive && <ChevronRight className="w-3.5 h-3.5 ml-auto text-teal-400 flex-shrink-0" />}
                </>
              )}
            </NavLink>
          ))}

          {/* Template quick links */}
          <div className="mt-4 mb-2 px-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">Templates</p>
          </div>
          {[
            { to: '/template/pre_intake',     label: 'Pre-Intake Brief',   color: 'bg-violet-500' },
            { to: '/template/follow_up',      label: 'Follow-Up Visit',    color: 'bg-rose-500'   },
            { to: '/template/session_note',   label: 'DARP Progress Note', color: 'bg-teal-500'   },
            { to: '/template/treatment_plan', label: 'Treatment Plan',     color: 'bg-blue-500'   },
          ].map(({ to, label, color }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl mb-0.5 text-slate-400 hover:text-white hover:bg-white/5 transition-all group"
            >
              <div className={`w-2 h-2 rounded-full ${color} flex-shrink-0`} />
              <span className="text-xs font-semibold truncate">{label}</span>
              <FileText className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-60 transition-opacity" />
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className="px-4 py-4 border-t border-white/10">
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(v => !v)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/5 transition-all group"
            >
              <div className="w-7 h-7 rounded-full bg-teal-600 flex items-center justify-center text-xs font-black text-white flex-shrink-0">
                {userInitial}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-xs font-bold text-slate-300 truncate">{userEmail}</p>
                <p className="text-[10px] text-slate-600">Signed in</p>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400" />
            </button>

            {userMenuOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-slate-800 border border-white/10 rounded-xl shadow-xl overflow-hidden">
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-all font-semibold"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            )}
          </div>

          <p className="text-[10px] text-slate-700 leading-relaxed mt-3 px-1">
            Dr. Douglas Zelisko, M.D.<br />Board Certified Psychiatrist
          </p>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-slate-900 border-b border-white/10">
          <button onClick={() => setMobileOpen(true)} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10">
            <Menu className="w-5 h-5" />
          </button>
          <img src="/logo.png" alt="IP" className="w-7 h-7 object-contain" />
          <span className="text-sm font-black text-white">Clinical AI</span>
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
