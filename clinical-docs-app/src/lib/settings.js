import { AI_PROVIDERS } from './aiEngine';

const SETTINGS_KEY = 'clinicaldocs_settings';

export const defaultSettings = {
  // AI Provider
  aiProvider:   'gemini',      // 'openai' | 'gemini' | 'claude' | 'ollama'
  aiModel:      '',            // override model; empty = use provider default

  // Per-provider keys / config. Gemini, Claude, and Ollama Cloud keys are
  // NOT stored here — they live server-side as Supabase Edge Function
  // secrets (see notes_gemini-proxy / notes_claude-proxy / notes_ollama-proxy).
  openaiApiKey: '',
  ollamaUrl:    'http://localhost:11434',
  ollamaModel:  'gemma3:latest',

  // Output options
  outputFormat: 'Both',          // 'HTML' | 'PDF' | 'Both'
  detailLevel:  'Highly Detailed', // 'Standard' | 'Highly Detailed' | 'Bulleted Summary'
  namingConvention: {
    treatmentPlan: '[LastName]_[Date]_TreatmentPlan',
    darp:          '[LastName]_[Date]_DARP',
    preIntake:     '[LastName]_[Date]_PreIntake',
    followUp:      '[LastName]_[Date]_FollowUp',
  },

  driveConnected: false,

  // AutoPilot — autonomous watch-and-generate
  autoPilot: {
    enabled: false,
    intervalMinutes: 30,
    docTypes: ['treatment_plan'],   // one or more of: treatment_plan | session_note | pre_intake | follow_up
    patientScope: 'all',            // 'all' | 'list'
    patientList: [],                // used when patientScope === 'list'
    lastCheckedByPatient: {},       // { [patientName]: isoTimestamp }
    lastRunSummary: null,           // aggregate-only counts from the most recent run — see design.md 2.5
  },

  // Calendar Notes defaults
  calendar: {
    defaultPreset: 'last7',         // one of dateRanges.DATE_PRESETS ids
    calendarIds: [],                // Google Calendar IDs selected by default
    docTypes: ['session_note'],     // default document type(s) to generate per appointment
    aliases: {},                    // { rawAppointmentText: canonicalPatientName }
    skipPatterns: [],               // raw substrings — matching events are excluded before parsing (e.g. non-patient recurring events)
    timeZone: '',                   // IANA zone; '' = use the browser's local zone
    useAiFallback: true,            // allow AI fallback when deterministic parsing is uncertain
  },

  // Approximate filename-matching rules per document type, used to preselect
  // source files on the Batch Processor generator page. { [docTypeKey]: Rule[] }
  // where Rule = { id, label, enabled, required, patterns: string[] }.
  sourceFiles: {
    treatment_plan: [
      { id: 'intake', label: 'Intake / Pre-Intake', enabled: true, required: false, patterns: ['intake', 'pre intake', 'pre-intake', 'headway intake'] },
      { id: 'assessment', label: 'Assessment / Evaluation', enabled: true, required: false, patterns: ['assessment', 'evaluation', 'psych eval', 'initial evaluation'] },
    ],
    session_note: [
      { id: 'session_source', label: 'Session transcript, Zoom note, or Notes by Gemini', enabled: true, required: false, patterns: ['zoomnote', 'zoom note', 'notesbygemini', 'notes by gemini', 'gemini notes', 'transcript', 'session summary', 'session note'] },
      { id: 'treatment_plan', label: 'Treatment Plan source file', enabled: false, required: false, patterns: ['treatment plan', 'treatmentplan'] },
    ],
    pre_intake: [
      { id: 'intake', label: 'Intake form', enabled: true, required: false, patterns: ['intake', 'headway intake', 'new patient', 'questionnaire'] },
    ],
    follow_up: [
      { id: 'follow_up_source', label: 'Follow-up source', enabled: true, required: false, patterns: ['follow up', 'follow-up', 'zoomnote', 'zoom note', 'transcript', 'session'] },
    ],
  },
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };
    const saved = JSON.parse(raw);
    // Shallow-spread would let an older saved blob's nested objects (missing
    // newer keys like namingConvention.preIntake) silently shadow the defaults.
    return {
      ...defaultSettings,
      ...saved,
      namingConvention: { ...defaultSettings.namingConvention, ...saved.namingConvention },
      autoPilot: { ...defaultSettings.autoPilot, ...saved.autoPilot },
      calendar: {
        ...defaultSettings.calendar,
        ...saved.calendar,
        aliases: { ...defaultSettings.calendar.aliases, ...saved.calendar?.aliases },
      },
      sourceFiles: { ...defaultSettings.sourceFiles, ...saved.sourceFiles },
    };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function applyNamingConvention(template, lastName, date) {
  return template
    .replace(/\[LastName\]/g, lastName)
    .replace(/\[Date\]/g, date);
}

/** Resolve the IANA time zone to use for Calendar Notes date-range math. */
export function getEffectiveTimeZone(settings) {
  return settings?.calendar?.timeZone
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
}

/** Return the keys object needed by aiEngine.generateClinicalDocument */
export function getProviderKeys(settings) {
  return {
    openaiApiKey: settings.openaiApiKey,
    ollamaUrl:    settings.ollamaUrl,
    ollamaModel:  settings.ollamaModel,
  };
}

/**
 * Is this provider ready to use? Server-managed providers (Gemini, Claude,
 * Ollama Cloud) hold their API key as a Supabase Edge Function secret and
 * are always "configured" from the client's point of view — readiness there
 * is a deployment concern, not something the browser can check. OpenAI still
 * needs a client-side key; Ollama (local) needs no key at all.
 */
export function isProviderConfigured(provider, keys) {
  if (AI_PROVIDERS[provider]?.serverManaged) return true;
  if (provider === 'openai') return !!keys.openaiApiKey;
  if (provider === 'ollama') return true;
  return false;
}
