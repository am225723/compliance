/**
 * CPT-claim validation for Reports entries — see issue #22. Draft-entry
 * policy (product decision): errors are combinations that are always wrong
 * and block saving; warnings flag likely mistakes but don't block, since an
 * auto-created draft report row legitimately starts out incomplete (e.g. no
 * CPT codes at all, or an E/M code picked before its add-on) and the
 * clinician fills it in over time.
 */
import {
  VALID_CPT_CODES, EM_CODES, ADDON_CODES, ADDON_TIME_RANGES,
  STANDALONE_THERAPY_CODES, STANDALONE_THERAPY_TIME_RANGES,
  INITIAL_EVAL_CODE, CRISIS_FIRST_CODE, CRISIS_ADDITIONAL_CODE, CRISIS_CODES,
  FAMILY_THERAPY_CODES, INTERACTIVE_COMPLEXITY_CODE,
} from './cptCodes';

function formatRange([min, max]) {
  return max === Infinity ? `${min}+ min` : `${min}–${max} min`;
}

/**
 * @param {string[]} codes - the claim's selected CPT codes
 * @param {number|null} minutes - psychotherapy_minutes, or null if unset
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateCptClaim(codes, minutes) {
  const errors = [];
  const warnings = [];
  const list = codes || [];

  const unknown = list.filter(c => !VALID_CPT_CODES.has(c));
  if (unknown.length) {
    errors.push(`Unknown CPT code${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')} — not in the approved catalog.`);
  }

  const emCodes = list.filter(c => EM_CODES.includes(c));
  if (emCodes.length > 1) {
    errors.push(`Only one E/M code may be billed per encounter (selected: ${emCodes.join(', ')}).`);
  }

  const addonCodes = list.filter(c => ADDON_CODES.includes(c));
  if (addonCodes.length > 1) {
    errors.push(`Only one psychotherapy add-on may be billed per encounter (selected: ${addonCodes.join(', ')}).`);
  }
  if (addonCodes.length && !emCodes.length) {
    errors.push(`Psychotherapy add-on ${addonCodes.join(', ')} requires an E/M code in the same claim.`);
  }

  if (list.includes(INITIAL_EVAL_CODE) && emCodes.length) {
    errors.push(`90792 should not be combined with an E/M code (${emCodes.join(', ')}) on the same encounter.`);
  }

  if (list.includes(CRISIS_ADDITIONAL_CODE) && !list.includes(CRISIS_FIRST_CODE)) {
    errors.push(`90840 requires 90839 (first 60 minutes of crisis psychotherapy) in the same claim.`);
  }

  const crisisCodes = list.filter(c => CRISIS_CODES.includes(c));
  if (crisisCodes.length && emCodes.length) {
    errors.push(`Crisis psychotherapy (${crisisCodes.join(', ')}) should not be combined with an E/M code (${emCodes.join(', ')}).`);
  }

  const standaloneCodes = list.filter(c => STANDALONE_THERAPY_CODES.includes(c));
  if (standaloneCodes.length && emCodes.length) {
    warnings.push(`${standaloneCodes.join(', ')} is a stand-alone psychotherapy code, usually billed without an E/M code — did you mean the add-on code instead?`);
  }

  if (list.includes(INTERACTIVE_COMPLEXITY_CODE)) {
    const familyCodes = list.filter(c => FAMILY_THERAPY_CODES.includes(c));
    if (list.filter(c => c !== INTERACTIVE_COMPLEXITY_CODE).length === 0) {
      errors.push('90785 (Interactive Complexity) requires a primary psychiatric service code in the same claim.');
    }
    if (emCodes.length && !addonCodes.length && !standaloneCodes.length) {
      errors.push('90785 with an E/M code also requires a psychotherapy code (add-on or stand-alone) in the same claim.');
    }
    if (crisisCodes.length) {
      errors.push(`90785 should not be combined with crisis psychotherapy (${crisisCodes.join(', ')}).`);
    }
    if (familyCodes.length) {
      errors.push(`90785 should not be combined with family psychotherapy (${familyCodes.join(', ')}).`);
    }
  }

  const timedCode = [...addonCodes, ...standaloneCodes][0];
  if (timedCode) {
    const range = ADDON_TIME_RANGES[timedCode] || STANDALONE_THERAPY_TIME_RANGES[timedCode];
    if (minutes == null) {
      warnings.push(`No psychotherapy minutes recorded for ${timedCode} (expected ${formatRange(range)}).`);
    } else if (minutes < range[0] || minutes > range[1]) {
      warnings.push(`Psychotherapy minutes (${minutes}) fall outside ${timedCode}'s expected range of ${formatRange(range)}.`);
    }
  }

  return { errors, warnings };
}
