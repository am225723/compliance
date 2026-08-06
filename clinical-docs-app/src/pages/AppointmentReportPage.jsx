/**
 * Appointment Documentation Report — every calendar appointment in a date
 * range, cross-referenced against generated documents to show whether a
 * session note (every visit) and a Treatment Plan (first visit only) were
 * created. Read-only and exportable; doesn't touch Google Drive at all —
 * only Calendar (for the appointment list) and Supabase (for document
 * status), unlike the generation surfaces.
 */
import { useEffect, useState, useMemo } from 'react';
import {
  ClipboardCheck, Search, Loader2, CalendarClock, AlertTriangle,
  Download, RefreshCw, CheckCircle2, XCircle, Users, FileText, Info,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { hasCalendarScope } from '../lib/googleDrive';
import { listCalendars, listEventsForCalendars } from '../lib/googleCalendar';
import { DATE_PRESETS, getPresetRange } from '../lib/dateRanges';
import { parseAppointmentDeterministic } from '../lib/appointmentParsing';
import { buildExistingNoteIndex } from '../lib/calendarDedup';
import { computeFirstVisitKeys, hasDarpNote } from '../lib/appointmentReport';
import { getEffectiveTimeZone } from '../lib/settings';
import { supabase } from '../lib/supabase';

function confidenceBadge(confidence, needsReview) {
  if (needsReview) return { color: 'bg-amber-500/20 text-amber-300', label: `${confidence} — verify` };
  return { color: 'bg-emerald-500/20 text-emerald-300', label: confidence };
}

function DocStatus({ status }) {
  if (status === 'n/a') return <span className="text-slate-700 text-xs">—</span>;
  if (status === true || status === 'created') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300">
        <CheckCircle2 className="w-3 h-3" /> Created
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400">
      <XCircle className="w-3 h-3" /> Missing
    </span>
  );
}

export default function AppointmentReportPage() {
  const { settings, driveConnected, fetchExistingCalendarNotes } = useApp();
  const calendarSettings = settings.calendar;
  const calendarScopeGranted = driveConnected && hasCalendarScope();

  const [calendars, setCalendars] = useState([]);
  const [calendarsLoading, setCalendarsLoading] = useState(false);
  const [calendarsError, setCalendarsError] = useState('');
  const [selectedCalendarIds, setSelectedCalendarIds] = useState([]);
  const [preset, setPreset] = useState(calendarSettings.defaultPreset || 'last30');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [hasRun, setHasRun] = useState(false);
  const [search, setSearch] = useState('');

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

  function toggleCalendar(id) {
    setSelectedCalendarIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  async function handleGenerate() {
    if (selectedCalendarIds.length === 0) { setError('Select at least one calendar.'); return; }
    setLoading(true);
    setError('');
    setRows([]);

    const timeZone = getEffectiveTimeZone(settings);
    let range;
    try {
      range = getPresetRange(preset, { timeZone, customStart, customEnd });
    } catch (e) {
      setError(e.message);
      setLoading(false);
      return;
    }

    try {
      const [{ events, errors }, existingRaw] = await Promise.all([
        listEventsForCalendars(selectedCalendarIds, { ...range, timeZone }),
        fetchExistingCalendarNotes(selectedCalendarIds, range),
      ]);
      if (errors.length) {
        setError(errors.map((e) => `Calendar ${e.calendarId}: ${e.message}`).join(' · '));
      }

      const calendarNameById = Object.fromEntries(calendars.map((c) => [c.id, c.summary]));
      const darpIndex = buildExistingNoteIndex(existingRaw);

      const parsed = events.map((ev) => {
        const result = parseAppointmentDeterministic(ev, { knownPatients: [], aliases: calendarSettings.aliases });
        return {
          key: `${ev.calendarId}__${ev.eventId}`,
          calendarId: ev.calendarId,
          eventId: ev.eventId,
          calendarName: calendarNameById[ev.calendarId] || ev.calendarId,
          title: ev.title,
          start: ev.start,
          durationMinutes: ev.durationMinutes,
          patientName: result.name || '',
          parseConfidence: result.confidence,
          needsNameReview: result.needsReview,
        };
      });

      const patientNames = [...new Set(parsed.map((r) => r.patientName).filter(Boolean))];
      let treatmentPlanPatients = new Set();
      if (patientNames.length) {
        const { data, error: tpError } = await supabase
          .from('documents')
          .select('patient_name')
          .eq('document_type', 'treatment_plan')
          .in('patient_name', patientNames);
        if (tpError) throw new Error(`Failed to check Treatment Plan status: ${tpError.message}`);
        treatmentPlanPatients = new Set((data || []).map((d) => d.patient_name));
      }

      const firstVisitKeys = computeFirstVisitKeys(parsed);
      const finalRows = parsed.map((r) => {
        const isFirstVisit = firstVisitKeys.has(r.key);
        return {
          ...r,
          isFirstVisit,
          darpCreated: hasDarpNote(darpIndex, { calendarId: r.calendarId, eventId: r.eventId, start: r.start }),
          treatmentPlanStatus: !r.patientName ? 'n/a' : isFirstVisit
            ? (treatmentPlanPatients.has(r.patientName) ? 'created' : 'missing')
            : 'n/a',
        };
      }).sort((a, b) => new Date(a.start) - new Date(b.start));

      setRows(finalRows);
      setHasRun(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => r.patientName.toLowerCase().includes(q) || r.title.toLowerCase().includes(q));
  }, [rows, search]);

  const stats = useMemo(() => ({
    total: rows.length,
    uniquePatients: new Set(rows.map((r) => r.patientName).filter(Boolean)).size,
    missingDarp: rows.filter((r) => !r.darpCreated).length,
    missingTreatmentPlan: rows.filter((r) => r.treatmentPlanStatus === 'missing').length,
  }), [rows]);

  function exportCSV() {
    const headers = ['Date', 'Appointment', 'Calendar', 'Patient', 'Name Confidence', 'First Visit', 'DARP Note', 'Treatment Plan'];
    const csvRows = filteredRows.map((r) => [
      r.start ? new Date(r.start).toLocaleString('en-US', { timeZone: getEffectiveTimeZone(settings) }) : '',
      r.title,
      r.calendarName,
      r.patientName || '(unparsed)',
      r.needsNameReview ? `${r.parseConfidence} (verify)` : r.parseConfidence,
      r.isFirstVisit ? 'Yes' : 'No',
      r.darpCreated ? 'Created' : 'Missing',
      r.treatmentPlanStatus === 'n/a' ? 'N/A' : r.treatmentPlanStatus === 'created' ? 'Created' : 'Missing',
    ]);
    const csv = [headers, ...csvRows].map((row) => row.map((v) => {
      const value = String(v ?? '');
      const safeValue = /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
      return `"${safeValue.replace(/"/g, '""')}"`;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `appointment-documentation-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-full bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/25 flex items-center justify-center">
            <ClipboardCheck className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <h1 className="text-lg font-black text-white">Appointment Documentation Report</h1>
            <p className="text-xs text-slate-500">Every appointment in range, and whether its notes were created</p>
          </div>
        </div>

        {!calendarScopeGranted && (
          <div className="mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 flex gap-3 items-start">
            <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300/80 leading-relaxed">
              Connect Google Calendar in <a href="/settings" className="underline hover:text-white">Settings</a> to run this report.
            </p>
          </div>
        )}

        {calendarScopeGranted && (
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 mb-5 space-y-5">
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

            <div>
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2">Date Range</h2>
              <div className="flex flex-wrap gap-2">
                {DATE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPreset(p.id)}
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

            <button
              onClick={handleGenerate}
              disabled={loading || selectedCalendarIds.length === 0}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 text-white text-sm font-black transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-sky-500/20"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Building report…</> : <><RefreshCw className="w-4 h-4" /> Generate Report</>}
            </button>
          </div>
        )}

        {error && (
          <div className="mb-5 rounded-2xl border border-red-500/25 bg-red-500/5 px-5 py-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {hasRun && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {[
                { label: 'Appointments', value: stats.total, icon: CalendarClock, color: 'text-sky-400', bg: 'bg-sky-500/10' },
                { label: 'Unique Patients', value: stats.uniquePatients, icon: Users, color: 'text-teal-400', bg: 'bg-teal-500/10' },
                { label: 'Missing Session Notes', value: stats.missingDarp, icon: AlertTriangle, color: stats.missingDarp > 0 ? 'text-red-400' : 'text-emerald-400', bg: stats.missingDarp > 0 ? 'bg-red-500/10' : 'bg-emerald-500/10' },
                { label: 'Missing Treatment Plans', value: stats.missingTreatmentPlan, icon: FileText, color: stats.missingTreatmentPlan > 0 ? 'text-red-400' : 'text-emerald-400', bg: stats.missingTreatmentPlan > 0 ? 'bg-red-500/10' : 'bg-emerald-500/10' },
              ].map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className="rounded-2xl border border-white/8 bg-white/3 p-4">
                  <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-3`}>
                    <Icon className={`w-4 h-4 ${color}`} />
                  </div>
                  <p className="text-lg font-black text-white truncate">{value}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 font-semibold">{label}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by patient or appointment title…"
                  className="w-full pl-9 pr-4 py-2 bg-slate-800 border border-white/10 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-sky-500/60 transition-all"
                />
              </div>
              <button
                onClick={exportCSV}
                disabled={filteredRows.length === 0}
                className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white text-xs font-bold transition-all disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            </div>

            {filteredRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-sm font-bold text-slate-500">No appointments match.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-white/8">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-900 border-b border-white/8">
                      {['Date', 'Appointment', 'Patient', 'First Visit', 'DARP Note', 'Treatment Plan'].map((h) => (
                        <th key={h} className="px-4 py-3 text-[11px] font-black uppercase tracking-wider text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r, idx) => {
                      const badge = confidenceBadge(r.parseConfidence, r.needsNameReview);
                      return (
                        <tr key={r.key} className={`border-b border-white/5 hover:bg-white/3 transition-colors ${idx % 2 === 0 ? 'bg-white/1' : ''}`}>
                          <td className="px-4 py-3">
                            <p className="text-sm text-slate-300 whitespace-nowrap">
                              {r.start ? new Date(r.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: getEffectiveTimeZone(settings) }) : '—'}
                            </p>
                            <p className="text-[10px] text-slate-600">{r.durationMinutes != null ? new Date(r.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: getEffectiveTimeZone(settings) }) : ''}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-sm font-bold text-white">{r.title}</p>
                            <p className="text-[10px] text-slate-600">{r.calendarName}{r.durationMinutes != null ? ` · ${r.durationMinutes} min` : ''}</p>
                          </td>
                          <td className="px-4 py-3">
                            {r.patientName ? (
                              <>
                                <p className="text-sm font-bold text-white whitespace-nowrap">{r.patientName}</p>
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold mt-0.5 ${badge.color}`}>{badge.label}</span>
                              </>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-amber-400">
                                <AlertTriangle className="w-3 h-3" /> Unparsed
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {r.isFirstVisit ? (
                              <span className="text-xs font-bold text-sky-300">Yes</span>
                            ) : (
                              <span className="text-slate-700 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <DocStatus status={r.darpCreated} />
                          </td>
                          <td className="px-4 py-3">
                            <DocStatus status={r.treatmentPlanStatus} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
