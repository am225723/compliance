/**
 * Generation audit & error tracking library.
 * Supports batch logging, error recording, and failure recovery.
 */

/**
 * Detect duplicate files that would be included multiple times via different rules.
 * Returns array of { fileId, fileName, matchingRules: Rule[] }
 */
export function detectDuplicateSourceFiles(selectedFiles, sourceRuleResults) {
  const fileToRules = new Map(); // fileId -> Set of rule ids

  sourceRuleResults.forEach(({ rule, matches }) => {
    matches.forEach(file => {
      if (!fileToRules.has(file.id)) {
        fileToRules.set(file.id, new Set());
      }
      fileToRules.get(file.id).add(rule.id);
    });
  });

  const duplicates = [];
  fileToRules.forEach((ruleIds, fileId) => {
    if (ruleIds.size > 1) {
      const file = selectedFiles.find(f => f.id === fileId);
      const matchingRuleIds = Array.from(ruleIds);
      const matchingRules = sourceRuleResults
        .filter(({ rule }) => matchingRuleIds.includes(rule.id))
        .map(({ rule }) => rule);

      duplicates.push({
        fileId,
        fileName: file?.name || 'Unknown',
        matchingRules,
      });
    }
  });

  return duplicates;
}

/**
 * Collect pre-generation validation errors/warnings before starting the batch.
 * Returns { criticalErrors: Error[], warnings: Warning[] }
 */
export function validateBatchBefore(patients, rules) {
  const criticalErrors = [];
  const warnings = [];

  patients.forEach(patient => {
    if (!patient.status === 'matched') return;

    // Check for missing required files
    const requiredRules = rules.filter(r => r.required);
    requiredRules.forEach(rule => {
      const hasMatch = patient.files.some(f =>
        rule.patterns.some(pattern => {
          const { fileMatchesPattern } = require('./sourceFileSelection');
          return fileMatchesPattern(f.name, pattern);
        })
      );
      if (!hasMatch) {
        criticalErrors.push({
          patient: patient.name,
          message: `Required source file missing: ${rule.label}`,
        });
      }
    });

    // Check for duplicates (warning, not critical)
    const duplicates = detectDuplicateSourceFiles(patient.files, patient.sourceRuleResults || []);
    if (duplicates.length > 0) {
      warnings.push({
        patient: patient.name,
        message: `${duplicates.length} file(s) match multiple rules and will be included multiple times: ${duplicates.map(d => d.fileName).join(', ')}`,
        duplicates,
      });
    }
  });

  return { criticalErrors, warnings };
}

/**
 * Format cost data for display. Accepts tokens from API response or null if not tracked.
 */
export function calculateAndFormatCost(provider, model, promptTokens, completionTokens) {
  if (!promptTokens || !completionTokens) {
    return { totalTokens: 0, estimatedCostCents: null, display: 'N/A' };
  }

  const totalTokens = promptTokens + completionTokens;
  let estimatedCostCents = null;

  // Simple cost estimation based on provider pricing (mid-2024 rates)
  if (provider === 'openai') {
    if (model?.includes('gpt-4')) {
      estimatedCostCents = Math.round((promptTokens * 0.03 + completionTokens * 0.06) / 100);
    } else {
      estimatedCostCents = Math.round((promptTokens * 0.0005 + completionTokens * 0.0015) / 100);
    }
  } else if (provider === 'claude') {
    estimatedCostCents = Math.round((promptTokens * 0.003 + completionTokens * 0.015) / 100);
  } else if (provider === 'gemini') {
    estimatedCostCents = Math.round((promptTokens * 0.00035 + completionTokens * 0.0007) / 100);
  }

  return {
    totalTokens,
    estimatedCostCents,
    display: estimatedCostCents ? `$${(estimatedCostCents / 100).toFixed(4)}` : 'N/A',
  };
}

/**
 * Create a batch ID for tracking this generation run.
 */
export function generateBatchId() {
  return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Save generation log to Supabase. Call once at the start of batch generation.
 */
export async function saveGenerationLog(supabase, {
  userId, batchId, batchName, docTypeKey, settingsSnapshot,
}) {
  const { data, error } = await supabase
    .from('generation_logs')
    .insert({
      user_id: userId,
      batch_id: batchId,
      batch_name: batchName,
      document_type: docTypeKey,
      status: 'in_progress',
      settings_snapshot: settingsSnapshot,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to save generation log:', error);
    return null;
  }
  return data;
}

/**
 * Save per-patient generation error. Call when a patient fails during generation.
 */
export async function saveGenerationError(supabase, {
  userId, generationLogId, patientName, error, docTypeKey,
}) {
  const errorType = detectErrorType(error);
  const { data, error: saveError } = await supabase
    .from('generation_errors')
    .insert({
      user_id: userId,
      generation_log_id: generationLogId,
      patient_name: patientName,
      error_message: error.message || String(error),
      error_type: errorType,
      error_detail: { name: error.name, stack: error.stack },
      document_type: docTypeKey,
      retry_eligible: isRetryEligible(errorType),
    })
    .select()
    .single();

  if (saveError) {
    console.error('Failed to save generation error:', saveError);
    return null;
  }
  return data;
}

/**
 * Update generation log with final stats.
 */
export async function completeGenerationLog(supabase, {
  generationLogId, successfulCount, failedCount, skippedCount,
}) {
  const totalProcessed = successfulCount + failedCount + skippedCount;
  const status = failedCount === 0 ? 'completed' : (successfulCount > 0 ? 'partial' : 'failed');

  const { error } = await supabase
    .from('generation_logs')
    .update({
      status,
      completed_at: new Date().toISOString(),
      successful_count: successfulCount,
      failed_count: failedCount,
      skipped_count: skippedCount,
    })
    .eq('id', generationLogId);

  if (error) {
    console.error('Failed to update generation log:', error);
  }
}

function detectErrorType(error) {
  const msg = (error.message || '').toLowerCase();
  if (msg.includes('missing') || msg.includes('not found')) return 'missing_files';
  if (msg.includes('api') || msg.includes('network') || msg.includes('timeout')) return 'api_error';
  if (msg.includes('validation') || msg.includes('invalid')) return 'validation_error';
  return 'unknown';
}

function isRetryEligible(errorType) {
  return errorType === 'api_error' || errorType === 'unknown';
}
