/**
 * Best-effort date extraction from source file names (e.g.
 * "Session_2026-07-15.pdf", "07-15-2026 notes.docx", "July 15 2026.txt"),
 * used to default a generated document's date of service to when the
 * session actually happened instead of the date it was generated.
 */

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function isValidDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

function toIsoDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function fullYear(y) {
  if (y >= 100) return y;
  return y <= 69 ? 2000 + y : 1900 + y; // 2-digit year: assume 2000-2069, else 1970-1999
}

const MONTH_NAME = `(${Object.keys(MONTHS).join('|')})`;

// Boundaries use lookarounds rather than \b: file names commonly separate
// the date from surrounding text with "_", which \b treats as a word
// character (same class as digits/letters) and so does not count as a
// boundary there.
const NOT_DIGIT_BEFORE = '(?<!\\d)';
const NOT_DIGIT_AFTER = '(?!\\d)';
const NOT_LETTER_BEFORE = '(?<![a-zA-Z])';

// Ordered most-specific/least-ambiguous first. Each pattern's handler
// receives the regex match and returns { year, month, day } or null.
const PATTERNS = [
  // ISO: 2026-07-15, 2026_07_15, 2026.07.15
  {
    re: new RegExp(`${NOT_DIGIT_BEFORE}(20\\d{2})[-_.](\\d{1,2})[-_.](\\d{1,2})${NOT_DIGIT_AFTER}`),
    parse: m => ({ year: +m[1], month: +m[2], day: +m[3] }),
  },
  // Compact ISO: 20260715
  {
    re: new RegExp(`${NOT_DIGIT_BEFORE}(20\\d{2})(\\d{2})(\\d{2})${NOT_DIGIT_AFTER}`),
    parse: m => ({ year: +m[1], month: +m[2], day: +m[3] }),
  },
  // Month name + day + year: July 15 2026 / Jul-15-2026 / July 15th, 2026
  {
    re: new RegExp(`${NOT_LETTER_BEFORE}${MONTH_NAME}\\.?[-_ ]?(\\d{1,2})(?:st|nd|rd|th)?,?[-_ ]?(20\\d{2})${NOT_DIGIT_AFTER}`, 'i'),
    parse: m => ({ year: +m[3], month: MONTHS[m[1].toLowerCase()], day: +m[2] }),
  },
  // Day + month name + year: 15 July 2026 / 15-Jul-2026
  {
    re: new RegExp(`${NOT_DIGIT_BEFORE}(\\d{1,2})[-_ ]${MONTH_NAME}\\.?[-_ ]?(20\\d{2})${NOT_DIGIT_AFTER}`, 'i'),
    parse: m => ({ year: +m[3], month: MONTHS[m[2].toLowerCase()], day: +m[1] }),
  },
  // US MM-DD-YYYY (4-digit year, unambiguous)
  {
    re: new RegExp(`${NOT_DIGIT_BEFORE}(\\d{1,2})[-_.](\\d{1,2})[-_.](20\\d{2})${NOT_DIGIT_AFTER}`),
    parse: m => ({ year: +m[3], month: +m[1], day: +m[2] }),
  },
  // US MM-DD-YY (2-digit year — checked last, most ambiguous). Dots are
  // deliberately excluded here (unlike the patterns above): a dotted
  // x.y.z triplet is as likely to be a version string like "v1.2.24" as a
  // date, and this row's date_of_service feeds a billing record — the
  // unambiguous 4-digit-year pattern above already covers dotted dates.
  {
    re: new RegExp(`${NOT_DIGIT_BEFORE}(\\d{1,2})[-_](\\d{1,2})[-_](\\d{2})${NOT_DIGIT_AFTER}`),
    parse: m => ({ year: fullYear(+m[3]), month: +m[1], day: +m[2] }),
  },
];

/** Extract the first plausible date found in a single file name, or null. */
export function extractDateFromFileName(fileName) {
  if (!fileName) return null;
  for (const { re, parse } of PATTERNS) {
    const match = fileName.match(re);
    if (!match) continue;
    const { year, month, day } = parse(match);
    if (isValidDate(year, month, day)) return toIsoDate(year, month, day);
  }
  return null;
}

/**
 * Extract the most recent plausible date across a set of file names —
 * used as a proxy for "when the session happened" when no calendar event
 * is linked. Patients' folders often contain notes from several visits;
 * the most recent dated file is the best available guess at which visit
 * this generation run is documenting.
 */
export function extractLatestDateFromFileNames(fileNames) {
  const dates = (fileNames || [])
    .map(extractDateFromFileName)
    .filter(Boolean);
  if (dates.length === 0) return null;
  return dates.reduce((latest, d) => (d > latest ? d : latest));
}
