/**
 * Multi-provider AI generation engine.
 * Supports: OpenAI GPT-4o, Ollama, Gemini (Google AI Studio), Claude (Anthropic)
 *
 * Template Injection Protocol:
 *   - Strictly replaces span.ai-prompt text only.
 *   - Preserves all HTML structure, CSS, and DOM layout.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY, supabase } from './supabase';

// ─────────────────────────────────────────────────────────────────
// Provider Definitions
// ─────────────────────────────────────────────────────────────────

export const AI_PROVIDERS = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    logo: '🟢',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    fields: [{ key: 'openaiApiKey', label: 'API Key', placeholder: 'sk-...', secret: true }],
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    logo: '🔵',
    defaultModel: 'gemini-3.6-flash',
    // gemini-2.0-flash / gemini-2.5-flash / gemini-2.5-pro were retired
    // (2.5 series deprecated 2026-06-17); gemini-3.1-pro-preview still
    // carries a "-preview" suffix in its model ID despite being Google's
    // current stable Pro-tier offering.
    models: ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview'],
    // Key lives server-side as a Supabase Edge Function secret (notes_gemini-proxy) — no client field.
    serverManaged: true,
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    logo: '🟠',
    defaultModel: 'claude-opus-4-5',
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-3-5'],
    // Key lives server-side as a Supabase Edge Function secret (notes_claude-proxy) — no client field.
    serverManaged: true,
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (Local)',
    logo: '🦙',
    defaultModel: 'gemma3:latest',
    models: ['gemma3:latest', 'gemma3:27b', 'llama3.2', 'llama3.3', 'mistral', 'phi4', 'qwen3'],
    fields: [
      { key: 'ollamaUrl',   label: 'Ollama Base URL', placeholder: 'http://localhost:11434', secret: false },
      { key: 'ollamaModel', label: 'Model Name',      placeholder: 'gemma3:latest',          secret: false },
    ],
  },
  ollama_cloud: {
    id: 'ollama_cloud',
    label: 'Ollama Cloud',
    logo: '☁️',
    defaultModel: 'gemma4:27b-cloud',
    models: [
      'gemma4:27b-cloud',
      'gemma4:12b-cloud',
      'gpt-oss:120b',
      'gpt-oss:20b',
      'qwen3.5:122b-cloud',
      'qwen3.5:35b-cloud',
      'deepseek-v4-pro:cloud',
      'deepseek-v4-flash:cloud',
      'nemotron-3-super:cloud',
      'kimi-k2.6:cloud',
      'gemini-3-flash-preview:cloud',
      'mistral-large-3:cloud',
    ],
    // Key lives server-side as a Supabase Edge Function secret (notes_ollama-proxy) — no client field.
    serverManaged: true,
  },
};

export const PROVIDER_IDS = Object.keys(AI_PROVIDERS);

/**
 * Call one of the server-managed provider proxies (notes_*-proxy Edge
 * Functions). These functions hold the real provider API key as a secret and
 * verify the caller's session JWT themselves (not via Supabase's
 * platform-level verify_jwt — that rejects CORS preflight requests before
 * the function's own OPTIONS handling runs, see supabase/config.toml), so
 * the caller must be a logged-in user of this app — never the provider's own
 * key, which the browser no longer has. `apikey` is the project's
 * publishable key, required for Supabase to route the request at all;
 * `Authorization` carries the user's session JWT, which the function checks.
 */
async function callProxy(functionName, label, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not signed in — please log in again to use this AI provider.');
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`${label} error ${response.status}: ${await response.text()}`);
  return response;
}

// ─────────────────────────────────────────────────────────────────
// System & User Prompts
// ─────────────────────────────────────────────────────────────────

export function buildSystemPrompt(detailLevel) {
  const detailInstructions = {
    'Standard':
      'Provide clear, concise, insurance-ready clinical documentation. Use professional psychiatric language.',
    'Highly Detailed':
      'Provide thorough, highly detailed clinical documentation with comprehensive symptom descriptions, clinical reasoning, and treatment rationale. Use DSM-5 aligned language and include all relevant nuance.',
    'Bulleted Summary':
      'Provide bulleted, scannable clinical documentation. Use short bullet points and concise clinical phrases. Avoid long prose paragraphs.',
  };

  return `You are an expert clinical AI scribe for Dr. Douglas Zelisko, M.D., a Board Certified Psychiatrist at Integrative Psychiatry in West Hartford, CT.

Your task is to generate psychiatric clinical documentation by injecting content into HTML templates.

Detail Level: ${detailLevel}
Instruction: ${detailInstructions[detailLevel] || detailInstructions['Highly Detailed']}

CRITICAL RULES:
1. You will receive an HTML document with <span class="ai-prompt">...</span> elements containing field-specific instructions.
2. Replace ONLY the text content inside each ai-prompt span with your generated clinical content.
3. Do NOT change any HTML structure, CSS classes, div containers, or surrounding elements whatsoever.
4. Do NOT add new HTML tags inside the spans — plain text only (you may use newline characters for line breaks).
5. Never invent facts: specific symptoms, events, history, medications, dates, or other clinical data must come only from what is documented in the provided source files.
6. Within that limit, you may — and should — use standard clinical language and reasonable clinical inference to express what the source material supports: phrase Mental Status Exam findings in standard MSE terminology even if the source uses casual wording, name the psychotherapy interventions used when the techniques described in the source are recognizable (e.g. cognitive restructuring, behavioral activation, motivational interviewing), write a clinical formulation that connects documented symptoms/history/stressors into a coherent case conceptualization, and state medical necessity in terms of documented functional impairment and risk. This is translating and synthesizing what's there into professional clinical documentation, not adding new facts.
7. If a field's data is not present in the source material and cannot be reasonably inferred from what IS present per rule 6, leave the value blank and do not write "Not documented" in the body.
8. Follow each per-field instruction inside each ai-prompt span precisely.
9. Return the COMPLETE HTML document with every ai-prompt span replaced. Do not truncate or summarize the HTML.`;
}

export function buildTreatmentPlanPrompt(sourceText, templateHtml) {
  return `SOURCE DOCUMENTS:
${sourceText}

---

TREATMENT PLAN HTML TEMPLATE — inject clinical content into every ai-prompt span:
${templateHtml}`;
}

export function buildDARPPrompt(sourceText, treatmentPlanHtml, templateHtml) {
  return `SOURCE DOCUMENTS:
${sourceText}

---

PASS 1 — COMPLETED TREATMENT PLAN (use as foundational context; align the DARP Plan section with these goals):
${treatmentPlanHtml}

---

DARP PROGRESS NOTE HTML TEMPLATE — inject clinical content into every ai-prompt span:
${templateHtml}`;
}

// ─────────────────────────────────────────────────────────────────
// Unified Dispatcher
// ─────────────────────────────────────────────────────────────────

/**
 * Generate clinical document using the configured AI provider.
 *
 * @param {object} params
 * @param {string} params.provider   - 'openai' | 'gemini' | 'claude' | 'ollama' | 'ollama_cloud'
 * @param {object} params.keys       - { openaiApiKey, ollamaUrl, ollamaModel } — gemini/claude/ollama_cloud
 *   keys live server-side (Supabase Edge Function secrets) and aren't passed here.
 * @param {string} params.model      - override model (optional)
 * @param {string} params.systemPrompt
 * @param {string} params.userPrompt
 * @param {function} params.onChunk  - (delta, fullText) => void  (streaming callback)
 * @returns {Promise<string>} full generated text
 */
export async function generateClinicalDocument({ provider, keys, model, systemPrompt, userPrompt, onChunk }) {
  switch (provider) {
    case 'openai':        return generateOpenAI({ keys, model, systemPrompt, userPrompt, onChunk });
    case 'gemini':        return generateGemini({ keys, model, systemPrompt, userPrompt, onChunk });
    case 'claude':        return generateClaude({ keys, model, systemPrompt, userPrompt, onChunk });
    case 'ollama':        return generateOllama({ keys, model, systemPrompt, userPrompt, onChunk });
    case 'ollama_cloud':  return generateOllamaCloud({ keys, model, systemPrompt, userPrompt, onChunk });
    default:              throw new Error(`Unknown AI provider: "${provider}"`);
  }
}

// ─────────────────────────────────────────────────────────────────
// OpenAI  (GPT-4o etc.)
// ─────────────────────────────────────────────────────────────────

async function generateOpenAI({ keys, model, systemPrompt, userPrompt, onChunk }) {
  const apiKey = keys.openaiApiKey;
  if (!apiKey) throw new Error('OpenAI API key not configured.');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || 'gpt-4o',
      stream: true,
      max_tokens: 16000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI error ${response.status}: ${await response.text()}`);
  return readSSEStream(response, onChunk, (json) => json.choices?.[0]?.delta?.content || '');
}

// ─────────────────────────────────────────────────────────────────
// Gemini  (Google AI Studio)
// ─────────────────────────────────────────────────────────────────

async function generateGemini({ model, systemPrompt, userPrompt, onChunk }) {
  const response = await callProxy('notes_gemini-proxy', 'Gemini', {
    model: model || 'gemini-3.6-flash',
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { maxOutputTokens: 16000 },
  });
  return readSSEStream(response, onChunk, (json) => json.candidates?.[0]?.content?.parts?.[0]?.text || '');
}

// ─────────────────────────────────────────────────────────────────
// Claude  (Anthropic)
// ─────────────────────────────────────────────────────────────────

async function generateClaude({ model, systemPrompt, userPrompt, onChunk }) {
  // Relayed through notes_claude-proxy, which holds the real Anthropic key
  // server-side and injects it — the browser only authenticates with its
  // own Supabase session.
  const response = await callProxy('notes_claude-proxy', 'Claude', {
    model:      model || 'claude-opus-4-5',
    max_tokens: 16000,
    stream:     true,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  });

  // Claude SSE uses event: content_block_delta
  return readSSEStream(response, onChunk, (json) => {
    if (json.type === 'content_block_delta') return json.delta?.text || '';
    return '';
  });
}

// ─────────────────────────────────────────────────────────────────
// Ollama  (local or cloud)
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Ollama  (local)
// ─────────────────────────────────────────────────────────────────────────────

async function generateOllama({ keys, model, systemPrompt, userPrompt, onChunk }) {
  const baseUrl = (keys.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
  const modelName = model || keys.ollamaModel || 'gemma3:latest';

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    modelName,
      stream:   true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Ollama error ${response.status}: ${await response.text()}`);
  return readNDJSONStream(response, onChunk);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ollama Cloud  (proxied through a Supabase Edge Function)
//
// Browsers can't call https://ollama.com/api/chat directly - Ollama Cloud
// doesn't send Access-Control-Allow-Origin, so the CORS preflight fails no
// matter what site is calling it. The `notes_ollama-proxy` Edge Function
// makes the request server-to-server (where CORS doesn't apply), holds the
// real Ollama Cloud key as a secret, and adds its own CORS headers to the
// response. The browser only ever authenticates with its own Supabase
// session — it never sees the Ollama Cloud key.
// ─────────────────────────────────────────────────────────────────────────────

async function generateOllamaCloud({ model, systemPrompt, userPrompt, onChunk }) {
  const response = await callProxy('notes_ollama-proxy', 'Ollama Cloud', {
    model:    model || 'gemma4:27b-cloud',
    stream:   true,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
  });
  return readNDJSONStream(response, onChunk);
}

// ─────────────────────────────────────────────────────────────────
// SSE Stream Reader  (shared by OpenAI, Gemini, Claude)
// ─────────────────────────────────────────────────────────────────

async function readSSEStream(response, onChunk, extractDelta) {
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText  = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const json  = JSON.parse(data);
        const delta = extractDelta(json);
        if (delta) {
          fullText += delta;
          if (onChunk) onChunk(delta, fullText);
        }
      } catch { /* skip malformed lines */ }
    }
  }
  return fullText;
}

// ─────────────────────────────────────────────────────────────────
// PDF Text Extraction  (PDF.js via CDN)
// ─────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// NDJSON Stream Reader  (shared by Ollama local + Ollama Cloud)
// ─────────────────────────────────────────────────────────────────────────────

async function readNDJSONStream(response, onChunk) {
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText  = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const json  = JSON.parse(trimmed);
        const delta = json.message?.content || '';
        fullText += delta;
        if (onChunk && delta) onChunk(delta, fullText);
        if (json.done) return fullText;
      } catch { /* skip malformed lines */ }
    }
  }
  return fullText;
}

// ─────────────────────────────────────────────────────────────────
// Real PDF rendering (client-side) — used so "PDF" output actually
// produces a application/pdf file instead of an HTML file with a
// misleading ".pdf.html" name.
// ─────────────────────────────────────────────────────────────────

/**
 * Render a generated clinical document's HTML into an actual PDF Blob.
 * @param {string} html
 * @returns {Promise<Blob>}
 */
export async function htmlToPdfBlob(html) {
  const { default: html2pdf } = await import('html2pdf.js');

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.style.width = '816px'; // ~8.5in @ 96dpi
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    return await html2pdf()
      .from(container)
      .set({
        margin: 10,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .outputPdf('blob');
  } finally {
    document.body.removeChild(container);
  }
}

export async function extractPdfText(arrayBuffer) {
  if (!window.pdfjsLib) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text;
}
