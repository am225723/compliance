import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Modal confirmation for destructive actions (delete, discard, etc.) —
 * render conditionally (`{state && <ConfirmDialog .../>}`) rather than
 * passing `open`, so it never sits mounted-but-hidden.
 */
export default function ConfirmDialog({
  title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel',
  danger = true, onConfirm, onCancel,
}) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center px-4"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="bg-slate-900 border border-white/15 rounded-2xl w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-start gap-3 mb-5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${danger ? 'bg-red-500/15' : 'bg-teal-500/15'}`}>
              <AlertTriangle className={`w-4.5 h-4.5 ${danger ? 'text-red-400' : 'text-teal-400'}`} />
            </div>
            <div className="min-w-0">
              <h2 id="confirm-dialog-title" className="text-sm font-black text-white">{title}</h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{message}</p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={onCancel}
              autoFocus
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs font-bold transition-all"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              className={`px-4 py-2 rounded-xl text-white text-xs font-black transition-all ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-teal-600 hover:bg-teal-500'}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
