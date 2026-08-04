import { diffDocumentVersions } from '../lib/textDiff';

export default function VersionDiffView({ older, newer }) {
  const segments = diffDocumentVersions(older.content_html, newer.content_html);

  return (
    <div className="mt-4 pt-4 border-t border-white/10">
      <p className="text-xs font-bold text-slate-300 mb-2">
        Diff: v{older.version_number} → v{newer.version_number}
      </p>
      {segments === null ? (
        <p className="text-xs text-amber-400">
          These versions are too large to diff word-by-word in the browser. Open each version individually to compare.
        </p>
      ) : (
        <>
          <div className="rounded-lg bg-slate-950 border border-white/10 p-3 text-xs text-slate-300 leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto">
            {segments.map((seg, i) => (
              <span
                key={i}
                className={
                  seg.added ? 'bg-emerald-500/20 text-emerald-300'
                    : seg.removed ? 'bg-red-500/20 text-red-400 line-through'
                    : ''
                }
              >
                {seg.value}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-slate-600 mt-2">
            Diffed on extracted text, not raw HTML — formatting-only changes won't show.
          </p>
        </>
      )}
    </div>
  );
}
