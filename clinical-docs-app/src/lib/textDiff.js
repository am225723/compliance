/**
 * Word-level diff for comparing two document versions. Deliberately runs on
 * extracted text, not raw HTML — matches the sandboxed-iframe discipline
 * used everywhere else generated HTML is shown (see design.md 2.3): a
 * structural HTML diff would be more precise but means trusting/parsing
 * live markup, which is more risk than a version-comparison view needs.
 * No `diff` package is in package.json, so this is a small local
 * implementation rather than a new dependency.
 */

function htmlToText(html) {
  return (html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tokenize(text) {
  return text.match(/\S+|\s+/g) || [];
}

// Above this many (old-tokens × new-tokens) cells, the O(n*m) LCS table
// would tie up the tab for a noticeable stretch — bail out instead of
// hanging the UI on a very long document pair.
const MAX_DIFF_CELLS = 4_000_000;

/**
 * LCS-based word diff. Returns segments of { value, added, removed } —
 * unchanged runs have both false. Adjacent same-kind segments are merged
 * so callers get readable chunks rather than one entry per token.
 */
export function diffWords(oldText, newText) {
  const a = tokenize(oldText || '');
  const b = tokenize(newText || '');
  const n = a.length;
  const m = b.length;

  if (n * m > MAX_DIFF_CELLS) {
    return null;
  }

  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const segments = [];
  function push(value, added, removed) {
    const last = segments[segments.length - 1];
    if (last && last.added === added && last.removed === removed) {
      last.value += value;
    } else {
      segments.push({ value, added, removed });
    }
  }

  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(a[i], false, false);
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push(a[i], false, true);
      i++;
    } else {
      push(b[j], true, false);
      j++;
    }
  }
  while (i < n) { push(a[i], false, true); i++; }
  while (j < m) { push(b[j], true, false); j++; }

  return segments;
}

/**
 * Diff two document versions' HTML by extracted text.
 * @returns {Array|null} diff segments, or null if the pair is too large to
 *   diff word-by-word (see MAX_DIFF_CELLS).
 */
export function diffDocumentVersions(oldHtml, newHtml) {
  return diffWords(htmlToText(oldHtml), htmlToText(newHtml));
}
