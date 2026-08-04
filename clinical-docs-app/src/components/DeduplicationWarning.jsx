/**
 * Show warnings about source files that match multiple rules and would be included more than once
 */

import { AlertTriangle } from 'lucide-react';

export default function DeduplicationWarning({ duplicates }) {
  if (!duplicates || duplicates.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3" role="alert">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="text-xs font-bold text-amber-300">⚠ Duplicate Source Files</p>
          <p className="text-xs text-amber-200 mt-1">
            These files match multiple rules and will be included in the document multiple times:
          </p>
          <ul className="mt-2 space-y-1">
            {duplicates.map((dup, idx) => (
              <li key={idx} className="text-xs text-amber-200">
                <strong>{dup.fileName}</strong> — matches: {dup.matchingRules.map(r => r.label).join(', ')}
              </li>
            ))}
          </ul>
          <p className="text-xs text-amber-300 mt-2">
            💡 Tip: Edit source file rules in Settings to prevent this, or deselect the duplicate files above.
          </p>
        </div>
      </div>
    </div>
  );
}
