const SETTINGS_KEY = 'clinicaldocs_settings';

export const defaultSettings = {
  // AI Provider
  aiProvider:   'openai',      // 'openai' | 'gemini' | 'claude' | 'ollama'
  aiModel:      '',            // override model; empty = use provider default

  // Per-provider keys / config
  openaiApiKey:      '',
  geminiApiKey:      '',
  claudeApiKey:      '',
  ollamaUrl:         'http://localhost:11434',
  ollamaModel:       'gemma3:latest',
  ollamaCloudApiKey: '',

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

/** Return the keys object needed by aiEngine.generateClinicalDocument */
export function getProviderKeys(settings) {
  return {
    openaiApiKey:      settings.openaiApiKey,
    geminiApiKey:      settings.geminiApiKey,
    claudeApiKey:      settings.claudeApiKey,
    ollamaUrl:         settings.ollamaUrl,
    ollamaModel:       settings.ollamaModel,
    ollamaCloudApiKey: settings.ollamaCloudApiKey,
  };
}
