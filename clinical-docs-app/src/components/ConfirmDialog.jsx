import { useEffect } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

/**
 * Modal confirmation for destructive actions (delete, discard, etc.) —
 * render conditionally (`{state && <ConfirmDialog .../>}`) rather than
 * passing `open`, so it never sits mounted-but-hidden.
 *
 * `busy` marks the confirmed action as in flight: Escape, the backdrop,
 * and both buttons are disabled, since an in-flight request can't
 * actually be cancelled by dismissing the dialog — pretending otherwise
 * would let a "cancelled" delete complete anyway.
 */
export default function ConfirmDialog({
  title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel',
  danger = true, busy = false, error = null, onConfirm, onCancel,
}) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center px-4"
      onClick={() => { if (!busy) onCancel(); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-busy={busy}
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
              {error && (
                <p className="text-xs text-red-400 mt-2 leading-relaxed">{error}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={onCancel}
              disabled={busy}
              autoFocus
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-black transition-all disabled:opacity-60 disabled:cursor-not-allowed ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-teal-600 hover:bg-teal-500'}`}
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
