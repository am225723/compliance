import { useState, useEffect } from 'react';
import { FileText, Save, RotateCcw, Loader2, CheckCircle2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { DOCUMENT_TYPES } from '../lib/documentTypes';

export default function TemplatesPage() {
  const { templates, saveTemplate, deleteTemplate } = useApp();
  const [selectedKey, setSelectedKey] = useState(DOCUMENT_TYPES[0].key);
  const [html, setHtml] = useState('');
  const [loadingHtml, setLoadingHtml] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const meta = DOCUMENT_TYPES.find(t => t.key === selectedKey);
  const override = templates.find(t => t.key === selectedKey);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingHtml(true);
      try {
        const content = override ? override.html : await fetch(`/templates/${meta.file}`).then(r => r.text());
        if (!cancelled) { setHtml(content); setDirty(false); }
      } finally {
        if (!cancelled) setLoadingHtml(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  async function handleSave() {
    setSaving(true);
    const result = await saveTemplate(selectedKey, html, meta.label);
    setSaving(false);
    if (result) {
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  async function handleResetToDefault() {
    if (!override) return;
    setSaving(true);
    await deleteTemplate(selectedKey);
    const content = await fetch(`/templates/${meta.file}`).then(r => r.text());
    setHtml(content);
    setDirty(false);
    setSaving(false);
  }

  return (
    <div className="min-h-full bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white">Templates</h1>
            <p className="text-xs text-slate-500">Edit the HTML templates used for document generation. Changes apply clinic-wide.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          {/* Template list */}
          <div className="space-y-2">
            {DOCUMENT_TYPES.map(t => {
              const isOverridden = templates.some(tp => tp.key === t.key);
              const isSelected = t.key === selectedKey;
              return (
                <button
                  key={t.key}
                  onClick={() => setSelectedKey(t.key)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                    isSelected ? 'border-teal-500/40 bg-teal-500/10 text-white' : 'border-white/10 bg-white/3 text-slate-400 hover:bg-white/6'
                  }`}
                >
                  <p className="text-sm font-bold">{t.label}</p>
                  <p className={`text-[10px] mt-0.5 ${isOverridden ? 'text-amber-400' : 'text-slate-600'}`}>
                    {isOverridden ? 'Custom' : 'Default'}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Editor */}
          <div className="lg:col-span-3 bg-slate-900 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-black text-white">{meta.label}</h2>
              <div className="flex items-center gap-2">
                {saved && (
                  <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Saved
                  </span>
                )}
                <button
                  onClick={handleResetToDefault}
                  disabled={!override || saving || loadingHtml}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white text-xs font-bold transition-all disabled:opacity-30"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reset to Default
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || loadingHtml || !dirty}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-black transition-all disabled:opacity-40"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </button>
              </div>
            </div>

            {loadingHtml ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="w-6 h-6 text-teal-400 animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <textarea
                  value={html}
                  onChange={e => { setHtml(e.target.value); setDirty(true); }}
                  spellCheck={false}
                  className="w-full h-[560px] bg-slate-950 border border-white/10 rounded-xl px-3 py-3 text-[11px] text-slate-300 font-mono focus:outline-none focus:border-teal-500/40 resize-none"
                />
                <iframe title="template-preview" sandbox="" srcDoc={html} className="w-full h-[560px] rounded-xl border border-white/10 bg-white" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
