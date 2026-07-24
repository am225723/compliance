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
  },

  driveConnected: false,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...JSON.parse(raw) };
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
