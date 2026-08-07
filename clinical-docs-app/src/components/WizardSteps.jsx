import { Check } from 'lucide-react';

/**
 * Horizontal step tracker for multi-phase wizards (Batch Processor,
 * Calendar Notes). `currentIndex` is the index of the active step;
 * pass `steps.length` once everything is done so every step renders
 * complete instead of leaving one dangling "active".
 */
const ACCENTS = {
  violet: { border: 'border-violet-400', text: 'text-violet-300', ring: 'ring-violet-500/30', bg: 'bg-violet-500' },
  sky:    { border: 'border-sky-400',    text: 'text-sky-300',    ring: 'ring-sky-500/30',    bg: 'bg-sky-500' },
  teal:   { border: 'border-teal-400',   text: 'text-teal-300',   ring: 'ring-teal-500/30',   bg: 'bg-teal-500' },
};

export default function WizardSteps({ steps, currentIndex, accent = 'teal' }) {
  const a = ACCENTS[accent] || ACCENTS.teal;

  return (
    <div className="mb-6 overflow-x-auto">
      <ol className="flex items-center min-w-max">
        {steps.map((label, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <li key={label} aria-current={active ? 'step' : undefined} className="flex items-center">
              <div className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0 transition-all ${
                    done
                      ? `${a.bg} text-white`
                      : active
                      ? `bg-slate-900 border-2 ${a.border} ${a.text} ring-4 ${a.ring}`
                      : 'bg-white/5 border border-white/10 text-slate-600'
                  }`}
                >
                  {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </div>
                <span className={`text-xs font-bold whitespace-nowrap ${active ? 'text-white' : done ? 'text-slate-400' : 'text-slate-600'}`}>
                  <span className="sr-only">{active ? 'Current step: ' : done ? 'Completed: ' : 'Upcoming: '}</span>
                  {label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={`w-8 sm:w-12 h-0.5 mx-2 flex-shrink-0 rounded-full ${done ? a.bg : 'bg-white/10'}`} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
