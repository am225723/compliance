/**
 * Shared patient <-> Google Drive folder matching, used by both the Batch
 * Processor (typed patient names) and Calendar Notes (names parsed from
 * appointments) so the two entry points can't drift onto different matching
 * behavior.
 */

/**
 * Match a patient name against a list of Drive subfolders using
 * case-insensitive substring matching in both directions (handles both
 * "John" matching folder "John Smith", and folder "J. Smith" matching a
 * fuller typed/parsed name).
 *
 * Returns every candidate folder — callers decide how to handle zero
 * (not found) or multiple (ambiguous) matches. This function never guesses
 * at a single "best" match; ambiguity must always be resolved by a human.
 */
export function matchPatientFolders(name, folders) {
  const lower = (name || '').trim().toLowerCase();
  if (!lower) return [];
  return folders.filter((f) => {
    const folderLower = f.name.toLowerCase();
    return folderLower.includes(lower) || lower.includes(folderLower);
  });
}

/** Classify a set of candidate folders into the standard match states. */
export function classifyMatch(candidates) {
  if (!candidates || candidates.length === 0) return 'not_found';
  if (candidates.length > 1) return 'ambiguous';
  return 'matched';
}
