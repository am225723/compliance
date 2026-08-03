/**
 * Extracts patient-facing sections — "Empathetic Patient Summary Letter" and
 * "Client-Facing Psychoeducation" — out of a generated document's HTML so
 * they can be copied or emailed independently of the full clinical note.
 * Both currently live inside the Pre-Intake template's "Client-Facing
 * Materials" block, but this matches by heading text rather than document
 * type so it keeps working if the template moves them around.
 */

export const CLIENT_FACING_SECTION_TITLES = [
  'Empathetic Patient Summary Letter',
  'Client-Facing Psychoeducation',
];

function findSectionCard(doc, title) {
  const headings = doc.querySelectorAll('h1, h2, h3, h4');
  for (const heading of headings) {
    if (heading.textContent.trim() === title) {
      return heading.closest('.tool-card') || heading.parentElement;
    }
  }
  return null;
}

/** @returns {{ title: string, html: string, text: string } | null} */
export function extractClientFacingSection(documentHtml, title) {
  if (!documentHtml || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(documentHtml, 'text/html');
  const card = findSectionCard(doc, title);
  if (!card) return null;
  return {
    title,
    html: card.outerHTML,
    text: card.textContent.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(),
  };
}

/** All known client-facing sections found in a document, in a stable order. */
export function extractAllClientFacingSections(documentHtml) {
  return CLIENT_FACING_SECTION_TITLES
    .map(title => extractClientFacingSection(documentHtml, title))
    .filter(Boolean);
}
