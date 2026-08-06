/**
 * Pure cross-referencing helpers for the Appointment Documentation Report —
 * takes calendar appointments and generated documents and works out which
 * appointments still need a session note written up (or, for a patient's
 * first visit in the reported range, a Treatment Plan).
 */
import { calendarOccurrenceKey } from './calendarDedup';

/**
 * The earliest appointment per patient (by start time) among the given
 * rows — a Treatment Plan is only expected there, not at every visit.
 * "First visit" is scoped to the reported date range, not the patient's
 * entire history — a narrow report window can't see further back than
 * that, so this is a best-effort signal, not a clinical record.
 */
export function computeFirstVisitKeys(rows) {
  const earliest = new Map();
  for (const row of rows || []) {
    if (!row.patientName || !row.key) continue;
    const t = new Date(row.start).getTime();
    if (Number.isNaN(t)) continue;
    const current = earliest.get(row.patientName);
    if (!current || t < current.time) earliest.set(row.patientName, { key: row.key, time: t });
  }
  return new Set([...earliest.values()].map(v => v.key));
}

/** Was a DARP note generated and linked to this exact calendar occurrence? */
export function hasDarpNote(darpIndex, { calendarId, eventId, start }) {
  return !!darpIndex.get(calendarOccurrenceKey(calendarId, eventId, start, 'darp'));
}
