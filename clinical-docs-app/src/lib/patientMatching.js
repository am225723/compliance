/**
 * Shared patient <-> Google Drive folder matching, used by both the Batch
 * Processor (typed patient names) and Calendar Notes (names parsed from
 * appointments) so the two entry points can't drift onto different matching
 * behavior.
 */

function normalizeName(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[.,'"()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s) {
  return normalizeName(s).split(' ').filter(Boolean);
}

/**
 * Match a patient name against a list of Drive subfolders using two
 * complementary strategies, unioned together:
 *
 *  - Case-insensitive substring containment in both directions (handles
 *    "John" matching folder "John Smith", folder "J. Smith" matching a
 *    fuller typed/parsed name, and a decorated calendar title like "Jane
 *    Doe (Telehealth)" matching folder "Jane Doe").
 *  - Order-independent token-subset matching (handles the same name
 *    written in a different arrangement, e.g. calendar "John Smith"
 *    against folder "Smith, John", and a folder with an extra token the
 *    calendar title lacks, e.g. calendar "John Smith" against folder
 *    "John Michael Smith" — plain substring containment misses both since
 *    neither string contains the other verbatim).
 *
 * Returns every candidate folder — callers decide how to handle zero
 * (not found) or multiple (ambiguous) matches. This function never guesses
 * at a single "best" match; ambiguity must always be resolved by a human —
 * unioning strategies only ever adds candidates for a human to pick from,
 * it never narrows down to one.
 */
export function matchPatientFolders(name, folders) {
  const lower = (name || '').trim().toLowerCase();
  if (!lower) return [];

  const nameTokens = tokenize(name);

  return folders.filter((f) => {
    const folderLower = f.name.toLowerCase();
    if (folderLower.includes(lower) || lower.includes(folderLower)) return true;

    if (!nameTokens.length) return false;
    const folderTokens = tokenize(f.name);
    if (!folderTokens.length) return false;
    const [smaller, larger] = nameTokens.length <= folderTokens.length
      ? [nameTokens, folderTokens]
      : [folderTokens, nameTokens];
    return smaller.every((t) => larger.includes(t));
  });
}

/** Classify a set of candidate folders into the standard match states. */
export function classifyMatch(candidates) {
  if (!candidates || candidates.length === 0) return 'not_found';
  if (candidates.length > 1) return 'ambiguous';
  return 'matched';
}
