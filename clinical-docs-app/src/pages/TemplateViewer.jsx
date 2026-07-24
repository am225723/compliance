import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, ExternalLink, FileText, Calendar, ClipboardList, Heart, ChevronRight, Maximize2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { templates } from '../data/templates';

const iconMap = {
  pre_intake: FileText,
  follow_up: Calendar,
  session_note: ClipboardList,
  treatment_plan: Heart,
};

export default function TemplateViewer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const iframeRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const tmpl = templates.find((t) => t.id === id);

  if (!tmpl) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white gap-4">
        <p className="text-xl font-bold">Template not found.</p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-700"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const Icon = iconMap[tmpl.id];

  const handlePrint = () => {
    if (iframeRef.current) {
      iframeRef.current.contentWindow.focus();
      iframeRef.current.contentWindow.print();
    }
  };

  const handleOpenTab = () => {
    window.open(tmpl.file, '_blank');
  };

  const otherTemplates = templates.filter((t) => t.id !== id);

  return (
    <div className={`flex flex-col bg-slate-950 ${isFullscreen ? 'fixed inset-0 z-50' : 'min-h-screen'}`}>
      {/* Toolbar */}
      <div className="bg-slate-900 border-b border-white/10 px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0">
        {/* Left */}
        <div className="flex items-center gap-3 min-w-0">
          {!isFullscreen && (
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all text-sm font-semibold flex-shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </button>
          )}
          <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${tmpl.color} flex items-center justify-center flex-shrink-0`}>
            <Icon className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:block">{tmpl.tag}</span>
            <h1 className="text-sm font-black text-white leading-tight truncate">{tmpl.title}</h1>
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setIsFullscreen((v) => !v)}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all"
            title="Toggle fullscreen"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleOpenTab}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-all text-sm font-semibold"
          >
            <ExternalLink className="w-4 h-4" />
            <span className="hidden sm:inline">Open in Tab</span>
          </button>
          <button
            onClick={handlePrint}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-bold bg-gradient-to-r ${tmpl.color} shadow-lg hover:opacity-90 transition-opacity`}
          >
            <Printer className="w-4 h-4" />
            <span>Print / PDF</span>
          </button>
        </div>
      </div>

      {/* Two-column layout: iframe + sidebar */}
      <div className={`flex flex-1 overflow-hidden ${isFullscreen ? '' : ''}`}>
        {/* iframe */}
        <div className="flex-1 overflow-hidden bg-slate-100">
          <iframe
            ref={iframeRef}
            src={tmpl.file}
            className="w-full h-full border-0"
            title={tmpl.title}
          />
        </div>

        {/* Sidebar — other templates */}
        {!isFullscreen && (
          <aside className="hidden lg:flex flex-col w-64 bg-slate-900 border-l border-white/10 overflow-y-auto flex-shrink-0">
            <div className="p-4 border-b border-white/10">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Other Templates</p>
            </div>
            <div className="p-3 flex flex-col gap-2">
              {otherTemplates.map((t) => {
                const OtherIcon = iconMap[t.id];
                return (
                  <button
                    key={t.id}
                    onClick={() => navigate(`/template/${t.id}`)}
                    className="group text-left flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/25 transition-all"
                  >
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${t.color} flex items-center justify-center flex-shrink-0`}>
                      <OtherIcon className="w-4 h-4 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-slate-500 font-semibold">{t.tag}</p>
                      <p className="text-xs font-bold text-slate-300 group-hover:text-white transition-colors leading-tight truncate">
                        {t.title}
                      </p>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
