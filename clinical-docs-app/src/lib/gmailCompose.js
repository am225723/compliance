/**
 * Builds a Gmail web-compose deep link with a prefilled subject/body.
 *
 * Deliberately not a Gmail API "send" integration: that would require adding
 * the gmail.send OAuth scope (a new, more sensitive consent beyond the
 * existing Drive/Calendar scopes) and would mean the app transmits
 * patient-facing content directly. This opens the clinician's own Gmail
 * compose window instead — they review and hit send themselves, nothing is
 * sent by this app, and no new OAuth scope is needed.
 */
export function buildGmailComposeUrl({ to = '', subject = '', body = '' } = {}) {
  const params = new URLSearchParams({ view: 'cm', fs: '1', su: subject, body });
  if (to) params.set('to', to);
  return `https://mail.google.com/mail/?${params.toString()}`;
}
