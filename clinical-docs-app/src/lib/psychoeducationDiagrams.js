/**
 * A small, hand-authored set of diagrams for the Client-Facing
 * Psychoeducation PDF handout — not AI image generation. This app has no
 * image-generation provider wired in, and stock photography would need
 * licensing this repo doesn't have, so instead: a few genuinely useful,
 * clinically-generic vector diagrams that get matched in by keyword and
 * composed into the handout alongside the generated text. Deliberately
 * simple shapes/text only (no gradients/filters) so html2canvas — used by
 * htmlToPdfBlob() — renders them reliably.
 */

export const PSYCHOEDUCATION_DIAGRAMS = [
  {
    id: 'sleep_hygiene',
    title: 'Sleep Hygiene Checklist',
    keywords: ['sleep hygiene', 'sleep schedule', 'insomnia', 'sleep quality', 'trouble sleeping'],
    svg: `
<svg viewBox="0 0 360 200" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:360px;height:auto;">
  <rect x="0" y="0" width="360" height="200" fill="#f0fdfa" rx="12" />
  ${[
    'Consistent sleep/wake time',
    'No screens 30+ min before bed',
    'Cool, dark, quiet room',
    'Avoid caffeine after midday',
    'Wind-down routine each night',
  ].map((label, i) => `
    <rect x="24" y="${24 + i * 34}" width="18" height="18" rx="4" fill="#ffffff" stroke="#0d9488" stroke-width="2" />
    <path d="M27 ${33 + i * 34} l4 5 l8 -9" fill="none" stroke="#0d9488" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    <text x="54" y="${38 + i * 34}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#134e4a">${label}</text>
  `).join('')}
</svg>`.trim(),
  },
  {
    id: 'cbt_thought_cycle',
    title: 'Thought – Feeling – Behavior Cycle',
    keywords: ['cognitive restructuring', 'thought cycle', 'automatic thought', 'cognitive distortion', 'cbt'],
    svg: `
<svg viewBox="0 0 360 240" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:360px;height:auto;">
  <rect x="0" y="0" width="360" height="240" fill="#fdf4ff" rx="12" />
  <circle cx="180" cy="50" r="42" fill="#ffffff" stroke="#a855f7" stroke-width="2" />
  <text x="180" y="55" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#6b21a8">Thought</text>
  <circle cx="80" cy="170" r="42" fill="#ffffff" stroke="#a855f7" stroke-width="2" />
  <text x="80" y="175" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#6b21a8">Feeling</text>
  <circle cx="280" cy="170" r="42" fill="#ffffff" stroke="#a855f7" stroke-width="2" />
  <text x="280" y="175" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#6b21a8">Behavior</text>
  <path d="M150 80 L100 135" fill="none" stroke="#a855f7" stroke-width="2" marker-end="url(#arrow)" />
  <path d="M122 170 L238 170" fill="none" stroke="#a855f7" stroke-width="2" marker-end="url(#arrow)" />
  <path d="M258 138 L206 82" fill="none" stroke="#a855f7" stroke-width="2" marker-end="url(#arrow)" />
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0 0 L8 4 L0 8 Z" fill="#a855f7" />
    </marker>
  </defs>
</svg>`.trim(),
  },
  {
    id: 'medication_schedule',
    title: 'Daily Medication Schedule',
    keywords: ['medication schedule', 'dosing schedule', 'take as directed', 'morning dose', 'evening dose', 'twice daily'],
    svg: `
<svg viewBox="0 0 360 160" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:360px;height:auto;">
  <rect x="0" y="0" width="360" height="160" fill="#eff6ff" rx="12" />
  ${['Morning', 'Afternoon', 'Evening'].map((label, i) => `
    <rect x="${24 + i * 112}" y="24" width="96" height="112" rx="10" fill="#ffffff" stroke="#3b82f6" stroke-width="2" />
    <circle cx="${72 + i * 112}" cy="60" r="16" fill="#dbeafe" stroke="#3b82f6" stroke-width="2" />
    <text x="${72 + i * 112}" y="65" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#1e40af">Rx</text>
    <text x="${72 + i * 112}" y="105" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#1e3a8a">${label}</text>
  `).join('')}
</svg>`.trim(),
  },
];

/** Diagrams whose keywords appear in `text`, in catalog order, capped at `max`. */
export function matchDiagrams(text, max = 2) {
  const lower = (text || '').toLowerCase();
  return PSYCHOEDUCATION_DIAGRAMS
    .filter(d => d.keywords.some(k => lower.includes(k)))
    .slice(0, max);
}
