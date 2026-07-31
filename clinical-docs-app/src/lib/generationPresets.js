/**
 * Generation preset management library.
 * Save, load, and apply preset configurations for batch generation.
 */

/**
 * Save a generation preset to Supabase.
 */
export async function savePreset(supabase, userId, {
  name, description, docTypeKey, aiProvider, aiModel, detailLevel,
  outputFormat, sourceFileRules,
}) {
  const { data, error } = await supabase
    .from('generation_presets')
    .insert({
      user_id: userId,
      name,
      description,
      document_type: docTypeKey,
      ai_provider: aiProvider,
      ai_model: aiModel || null,
      detail_level: detailLevel,
      output_format: outputFormat,
      source_file_rules: sourceFileRules,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to save preset:', error);
    return null;
  }
  return data;
}

/**
 * Update an existing preset.
 */
export async function updatePreset(supabase, presetId, updates) {
  const { data, error } = await supabase
    .from('generation_presets')
    .update(updates)
    .eq('id', presetId)
    .select()
    .single();

  if (error) {
    console.error('Failed to update preset:', error);
    return null;
  }
  return data;
}

/**
 * Delete a preset.
 */
export async function deletePreset(supabase, presetId) {
  const { error } = await supabase
    .from('generation_presets')
    .delete()
    .eq('id', presetId);

  if (error) {
    console.error('Failed to delete preset:', error);
    return false;
  }
  return true;
}

/**
 * Fetch all presets for the current user and optionally filter by document type.
 */
export async function fetchPresets(supabase, userId, docTypeKey = null) {
  let query = supabase
    .from('generation_presets')
    .select('*')
    .eq('user_id', userId)
    .order('document_type', { ascending: true })
    .order('created_at', { ascending: false });

  if (docTypeKey) {
    query = query.eq('document_type', docTypeKey);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to fetch presets:', error);
    return [];
  }

  return data || [];
}

/**
 * Create a settings object from a preset.
 */
export function applyPreset(preset, baseSettings) {
  return {
    ...baseSettings,
    aiProvider: preset.ai_provider,
    aiModel: preset.ai_model || '',
    detailLevel: preset.detail_level,
    outputFormat: preset.output_format,
    sourceFiles: preset.source_file_rules || baseSettings.sourceFiles,
  };
}

/**
 * Create a preset from current settings.
 */
export function createPresetFromSettings(settings, docTypeKey, name, description = '') {
  return {
    name,
    description,
    docTypeKey,
    aiProvider: settings.aiProvider,
    aiModel: settings.aiModel,
    detailLevel: settings.detailLevel,
    outputFormat: settings.outputFormat,
    sourceFileRules: settings.sourceFiles,
  };
}
