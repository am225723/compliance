/**
 * Preset management UI — save, load, and delete generation presets per document type
 */

import { useState, useEffect } from 'react';
import { Save, Trash2, Upload, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchPresets, savePreset, deletePreset, applyPreset } from '../lib/generationPresets';

export default function PresetManager({ docTypeKey, settings, onApplyPreset, userId }) {
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetDescription, setPresetDescription] = useState('');

  useEffect(() => {
    if (!userId) return;
    loadPresets();
  }, [docTypeKey, userId]);

  async function loadPresets() {
    setLoading(true);
    const data = await fetchPresets(supabase, userId, docTypeKey);
    setPresets(data);
    setLoading(false);
  }

  async function handleSavePreset() {
    if (!presetName.trim()) {
      alert('Please enter a preset name');
      return;
    }
    setSaving(true);
    const saved = await savePreset(supabase, userId, {
      name: presetName,
      description: presetDescription,
      docTypeKey,
      aiProvider: settings.aiProvider,
      aiModel: settings.aiModel,
      detailLevel: settings.detailLevel,
      outputFormat: settings.outputFormat,
      sourceFileRules: settings.sourceFiles,
    });
    if (saved) {
      setPresets(prev => [...prev, saved]);
      setPresetName('');
      setPresetDescription('');
    }
    setSaving(false);
  }

  async function handleDeletePreset(presetId) {
    if (!window.confirm('Delete this preset?')) return;
    const ok = await deletePreset(supabase, presetId);
    if (ok) {
      setPresets(prev => prev.filter(p => p.id !== presetId));
    }
  }

  function handleLoadPreset(preset) {
    const settings = applyPreset(preset, settings);
    onApplyPreset(settings);
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
        <h3 className="font-black text-white mb-3">Save Current Configuration as Preset</h3>
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Preset name (e.g., 'Standard DARP')"
            value={presetName}
            onChange={e => setPresetName(e.target.value)}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/40"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={presetDescription}
            onChange={e => setPresetDescription(e.target.value)}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/40"
          />
          <button
            onClick={handleSavePreset}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Preset
          </button>
        </div>
      </div>

      {/* Load presets */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
        <h3 className="font-black text-white mb-3">Saved Presets ({presets.length})</h3>
        {loading ? (
          <div className="text-center py-4 text-slate-400">Loading presets…</div>
        ) : presets.length === 0 ? (
          <p className="text-xs text-slate-400">No presets yet. Save your first configuration above!</p>
        ) : (
          <div className="space-y-2">
            {presets.map(preset => (
              <div key={preset.id} className="flex items-center gap-2 p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{preset.name}</p>
                  {preset.description && <p className="text-xs text-slate-400 truncate">{preset.description}</p>}
                  <p className="text-xs text-slate-500 mt-1">
                    {preset.ai_provider} {preset.ai_model ? `• ${preset.ai_model}` : ''} • {preset.detail_level}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleLoadPreset(preset)}
                    className="p-2 rounded-lg bg-teal-500/20 text-teal-400 hover:bg-teal-500/30 transition-colors"
                    title="Load preset"
                  >
                    <Upload className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeletePreset(preset.id)}
                    className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                    title="Delete preset"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
