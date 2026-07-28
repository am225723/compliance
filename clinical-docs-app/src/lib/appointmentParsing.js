/**
 * Parse a patient name out of a calendar appointment's title/description.
 *
 * Parsing is deterministic-first: it only calls the configured AI provider
 * when deterministic rules can't produce a usable candidate. Every result
 * carries a confidence level, and anything below 'high' is flagged
 * `needsReview: true` — Calendar Notes must show these to a human before
 * they're used to search Drive. This is a separate, earlier review gate
 * than folder-matching ambiguity (see lib/patientMatching.js), which is
 * always re-run afterward regardless of how the name was parsed.
 */
import { generateClinicalDocument } from './aiEngine';

const NON_NAME_STOPWORDS = [
  'follow up', 'followup', 'intake', 'new patient', 'session', 'therapy',
  'consult', 'consultation', 'evaluation', 'eval', 'telehealth', 'in person',
  'in-person', 'med management', 'medication management', 'appointment',
  'visit', 'checkup', 'check up', 'psychiatric', 'psychotherapy', 'group',
  'family', 'crisis', 'initial', 'treatment plan', 'progress note', 'zoom',
  'google meet', 'phone call', 'blocked', 'out of office', 'lunch', 'break',
];

// NOTE: the separator alternation below intentionally avoids a regex
// character class combining a hyphen and a colon — Tailwind's content
// scanner greps *all* source text (including regex literals) for bracket
// groups that look like arbitrary-value utilities, and that combination
// looks enough like one to crash the CSS build. Alternation groups
// sidestep that entirely.
const SEPARATOR = '(?:-|:|–|—)'; // hyphen, colon, en dash, em dash

const NAME_PATTERNS = [
  // "John Smith - Follow Up", "John Smith: Follow Up"
  new RegExp(`^([A-Z][a-zA-Z'.-]+(?:\\s+[A-Z][a-zA-Z'.-]+){1,3})\\s*${SEPARATOR}`),
  // "Follow Up - John Smith", "Follow Up: John Smith"
  new RegExp(`${SEPARATOR}\\s*([A-Z][a-zA-Z'.-]+(?:\\s+[A-Z][a-zA-Z'.-]+){1,3})\\s*$`),
  // "Follow Up w/ John Smith", "Session with Jane Doe"
  /\b(?:w\/|with)\s+([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){1,3})\b/,
  // Whole title is just a name, e.g. "John Smith"
  /^([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){1,3})$/,
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function looksLikeStopword(candidate) {
  const lower = candidate.toLowerCase();
  return NON_NAME_STOPWORDS.some((w) => lower === w || lower.includes(w));
}

function extractCandidateFromText(text) {
  if (!text) return null;
  const trimmed = text.trim();
  for (const pattern of NAME_PATTERNS) {
    const m = trimmed.match(pattern);
    if (m?.[1] && !looksLikeStopword(m[1])) return m[1].trim();
  }
  return null;
}

/** Tier 1: does a known patient's folder name appear directly in the text? */
function findKnownPatientMentions(text, knownPatients) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return knownPatients.filter((p) => {
    const name = (p.name || '').toLowerCase().trim();
    if (!name) return false;
    if (lower.includes(name)) return true;
    const lastName = name.split(/\s+/).pop();
    return lastName.length >= 4 && new RegExp(`\\b${escapeRegExp(lastName)}\\b`).test(lower);
  });
}

/**
 * Deterministic parse only (no network call). `knownPatients` is the list
 * of Drive PatientForms subfolders ({id, name}); `aliases` is a
 * user-configured map of raw appointment text -> canonical patient name
 * (Settings -> Calendar).
 */
export function parseAppointmentDeterministic(event, { knownPatients = [], aliases = {} } = {}) {
  const title = event.title || '';
  const description = event.description || '';
  const combined = `${title}\n${description}`;

  for (const [raw, canonical] of Object.entries(aliases)) {
    if (raw && combined.toLowerCase().includes(raw.toLowerCase())) {
      return { name: canonical, confidence: 'high', method: 'alias', needsReview: false };
    }
  }

  const titleMentions = findKnownPatientMentions(title, knownPatients);
  const mentions = titleMentions.length ? titleMentions : findKnownPatientMentions(description, knownPatients);
  if (mentions.length === 1) {
    return { name: mentions[0].name, confidence: 'high', method: 'known-patient', needsReview: false };
  }
  if (mentions.length > 1) {
    return {
      name: null, confidence: 'low', method: 'known-patient-ambiguous', needsReview: true,
      candidates: mentions.map((m) => m.name),
    };
  }

  const candidate = extractCandidateFromText(title) || extractCandidateFromText(description);
  if (candidate) {
    return { name: candidate, confidence: 'medium', method: 'regex', needsReview: true };
  }

  return { name: null, confidence: 'none', method: 'none', needsReview: true };
}

/**
 * AI fallback — only meaningful when the deterministic parser couldn't
 * produce a usable candidate. Always flagged for review; AI output is
 * never trusted enough to auto-proceed to generation.
 */
export async function parseAppointmentWithAI({ event, provider, keys, model }) {
  const systemPrompt = "You extract a patient's full name from a calendar appointment. "
    + 'Reply with ONLY the name and nothing else — no punctuation, no explanation. '
    + 'If you cannot confidently determine a name, reply with exactly: UNKNOWN';
  const userPrompt = `Title: ${event.title || ''}\nDescription: ${event.description || ''}`;

  try {
    const raw = await generateClinicalDocument({ provider, keys, model, systemPrompt, userPrompt });
    const name = raw.trim().replace(/^["']|["']$/g, '');
    if (!name || /^unknown$/i.test(name)) {
      return { name: null, confidence: 'none', method: 'ai', needsReview: true };
    }
    return { name, confidence: 'low', method: 'ai', needsReview: true };
  } catch (e) {
    return { name: null, confidence: 'none', method: 'ai-error', needsReview: true, error: e.message };
  }
}

/**
 * Full parse: deterministic first, AI fallback only if deterministic
 * confidence is below 'medium' and an AI provider is available/enabled.
 */
export async function parseAppointment(event, {
  knownPatients, aliases, useAiFallback = false, provider, keys, model,
} = {}) {
  const deterministic = parseAppointmentDeterministic(event, { knownPatients, aliases });
  if (deterministic.confidence === 'high' || deterministic.confidence === 'medium') {
    return deterministic;
  }
  if (!useAiFallback) return deterministic;

  const aiResult = await parseAppointmentWithAI({ event, provider, keys, model });
  return aiResult.name ? aiResult : deterministic;
}
