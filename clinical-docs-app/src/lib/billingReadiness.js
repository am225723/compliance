/**
 * Billing readiness — flags Reports entries that would need attention
 * before a billing cycle: CPT-claim errors from cptValidation.js, or a
 * still-blank cpt_codes list (a auto-created draft report legitimately
 * starts this way, but shouldn't stay that way indefinitely).
 */
import { validateCptClaim } from './cptValidation';

export function assessReportReadiness(report) {
  const codes = report?.cpt_codes || [];
  const minutes = report?.psychotherapy_minutes ?? null;
  const { errors, warnings } = validateCptClaim(codes, minutes);
  const incomplete = codes.length === 0;
  return {
    ready: errors.length === 0 && !incomplete,
    incomplete,
    errors,
    warnings,
  };
}

export function filterReportsNeedingAttention(reports) {
  return (reports || []).filter(r => !assessReportReadiness(r).ready);
}
