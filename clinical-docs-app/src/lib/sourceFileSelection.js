/**
 * Approximate filename matching for the Source File Selection feature.
 * Rules live in settings.sourceFiles[docTypeKey]; each rule lists patterns
 * matched against discovered Drive files to preselect which ones feed the
 * document pipeline for that document type.
 */

function normalize(value = '') {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fileMatchesPattern(fileName, pattern) {
  const file = normalize(fileName);
  const wanted = normalize(pattern);
  return Boolean(wanted) && file.includes(wanted);
}

/** Enabled rules for a document type, with patterns trimmed/cleaned. */
export function getSourceRules(settings, docTypeKey) {
  return (settings?.sourceFiles?.[docTypeKey] || [])
    .filter(rule => rule && rule.enabled !== false)
    .map(rule => ({
      ...rule,
      patterns: (rule.patterns || []).map(String).map(v => v.trim()).filter(Boolean),
    }));
}

/**
 * Preselect files against the configured rules. With no rules, every
 * discovered file is preselected (matches prior behavior of reading
 * everything in the folder).
 */
export function resolveSourceFiles(files, rules) {
  const safeFiles = Array.isArray(files) ? files : [];
  const safeRules = Array.isArray(rules) ? rules : [];
  if (safeRules.length === 0) {
    return { selectedFileIds: safeFiles.map(file => file.id), ruleResults: [], missingRequired: [], missingOptional: [] };
  }
  const selected = new Set();
  const ruleResults = safeRules.map(rule => {
    const matches = safeFiles.filter(file => rule.patterns.some(pattern => fileMatchesPattern(file.name, pattern)));
    matches.forEach(file => selected.add(file.id));
    return { rule, matches };
  });
  return {
    selectedFileIds: [...selected],
    ruleResults,
    missingRequired: ruleResults.filter(({ rule, matches }) => rule.required && matches.length === 0),
    missingOptional: ruleResults.filter(({ rule, matches }) => !rule.required && matches.length === 0),
  };
}

/** Re-check the user's final (possibly manually overridden) selection against the rules before generating. */
export function validateSelectedSourceFiles(files, selectedFileIds, rules) {
  const selected = new Set(selectedFileIds || []);
  const selectedFiles = (files || []).filter(file => selected.has(file.id));
  const ruleResults = (rules || []).map(rule => ({
    rule,
    matches: selectedFiles.filter(file => rule.patterns.some(pattern => fileMatchesPattern(file.name, pattern))),
  }));
  return {
    selectedFiles,
    missingRequired: ruleResults.filter(({ rule, matches }) => rule.required && matches.length === 0),
    missingOptional: ruleResults.filter(({ rule, matches }) => !rule.required && matches.length === 0),
  };
}
