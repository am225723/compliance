/**
 * Identifies "session recording" style source files — Zoom notes or Notes by
 * Gemini transcripts — that the Batch Processor's multi-note pipeline treats
 * specially: each one produces its own DARP Progress Note, and the oldest
 * one bootstraps a Treatment Plan's Pass-1 context (see documentPipeline.js
 * planPatientOutputs()).
 */
import { fileMatchesPattern } from './sourceFileSelection';
import { extractDateFromFileName } from './dateExtraction';

export const SESSION_SOURCE_PATTERNS = [
  'zoomnote', 'zoom note',
  'notesbygemini', 'notes by gemini', 'gemini notes',
  'transcript', 'session summary', 'session note',
];

export function isSessionSourceFile(fileName, patterns = SESSION_SOURCE_PATTERNS) {
  return patterns.some(pattern => fileMatchesPattern(fileName, pattern));
}

/**
 * Session-source files among `files`, each annotated with its extracted
 * date and sorted oldest-first. Files with no extractable date sort after
 * dated ones (by name, for stable ordering) since we can't place them in
 * the timeline.
 */
export function getSessionSourceFiles(files, patterns = SESSION_SOURCE_PATTERNS) {
  const matches = (files || []).filter(f => isSessionSourceFile(f.name, patterns));
  return matches
    .map(f => ({ ...f, extractedDate: extractDateFromFileName(f.name) }))
    .sort((a, b) => {
      if (a.extractedDate && b.extractedDate) {
        if (a.extractedDate < b.extractedDate) return -1;
        if (a.extractedDate > b.extractedDate) return 1;
        return a.name.localeCompare(b.name);
      }
      if (a.extractedDate) return -1;
      if (b.extractedDate) return 1;
      return a.name.localeCompare(b.name);
    });
}
