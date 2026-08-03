/**
 * Composes the "Client-Facing Psychoeducation" section into a standalone,
 * downloadable PDF handout — the extracted section's content plus up to two
 * matched diagrams (see psychoeducationDiagrams.js) — reusing the existing
 * htmlToPdfBlob() renderer rather than adding a second PDF pipeline.
 */
import { htmlToPdfBlob } from './aiEngine';
import { matchDiagrams } from './psychoeducationDiagrams';

export function buildHandoutHtml({ sectionHtml, sectionText, patientName }) {
  const diagrams = matchDiagrams(sectionText);
  const diagramsHtml = diagrams.map(d => `
    <div style="margin: 28px 0; text-align: center;">
      <h4 style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; color: #334155; margin: 0 0 10px;">${d.title}</h4>
      ${d.svg}
    </div>
  `).join('');

  return `
<div style="font-family: Helvetica, Arial, sans-serif; max-width: 680px; margin: 0 auto; padding: 32px; color: #1e293b;">
  <h1 style="font-size: 20px; margin: 0 0 4px;">Client-Facing Psychoeducation</h1>
  ${patientName ? `<p style="font-size: 12px; color: #64748b; margin: 0 0 24px;">Prepared for ${patientName}</p>` : ''}
  ${sectionHtml}
  ${diagramsHtml}
</div>`.trim();
}

/** @returns {Promise<Blob>} a PDF blob ready to download */
export async function buildPsychoeducationHandoutPdf({ sectionHtml, sectionText, patientName }) {
  return htmlToPdfBlob(buildHandoutHtml({ sectionHtml, sectionText, patientName }));
}
