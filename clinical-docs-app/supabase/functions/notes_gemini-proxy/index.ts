import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

// Keeps the Gemini (Google AI Studio) API key server-side. The browser never
// holds this key — it authenticates to this function with its own Supabase
// user session, and this function injects the real Gemini key from the
// GEMINI_API_KEY secret before relaying the request to Google. The client
// sends the same body shape it used to send directly to Gemini (minus the
// key), plus `model`, which this function pulls out to build the upstream
// URL.
//
// verify_jwt is deliberately OFF for this function (see deploy config). The
// platform's own JWT verification runs before ANY of our code, including the
// OPTIONS branch below — and browsers never attach Authorization to a CORS
// preflight, so turning it on causes every preflight to be rejected with no
// CORS headers at all (looks like "No 'Access-Control-Allow-Origin' header
// is present" in the browser, since the request never reaches this handler).
// Instead we verify the caller's session JWT ourselves, after handling
// OPTIONS, using supabase-js against the project's own auth server.
//
// CORS is intentionally wide open (reflects any Origin) rather than gated by
// an ALLOWED_ORIGINS allowlist: Supabase secrets are shared across every
// Edge Function in a project, and this project backs several unrelated
// integrations, so a restrictive ALLOWED_ORIGINS set for one of them would
// silently break this one too. CORS isn't the real access-control boundary
// here anyway — it only affects whether a browser lets its own JS read the
// response, not whether the request executes. The actual gate is the
// Supabase session JWT check below.

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
// Supabase injects these into every Edge Function automatically.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'Method not allowed.' }, 405)
  }

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) {
    return jsonResponse(req, { error: 'Not signed in.' }, 401)
  }
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data: { user }, error: authError } = await authClient.auth.getUser(jwt)
  if (authError || !user) {
    return jsonResponse(req, { error: 'Not signed in.' }, 401)
  }

  if (!GEMINI_API_KEY) {
    return jsonResponse(req, { error: 'Server is not configured with a Gemini API key.' }, 500)
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return jsonResponse(req, { error: 'Invalid request body.' }, 400)
  }

  const { model, ...upstreamBody } = payload
  if (!model || typeof model !== 'string') {
    return jsonResponse(req, { error: 'Missing "model" in request body.' }, 400)
  }

  // Key goes in a header, not the query string — a failed fetch below logs
  // the error object, which for Deno network errors typically includes the
  // request URL; keeping the key out of the URL keeps it out of those logs.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`

  let upstream: Response
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify(upstreamBody),
    })
  } catch (error) {
    console.error('notes_gemini-proxy: upstream fetch failed', error)
    return jsonResponse(req, { error: 'Failed to reach Gemini.' }, 502)
  }

  const headers = new Headers(corsHeaders(req))
  headers.set('Content-Type', upstream.headers.get('content-type') ?? 'text/event-stream')

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  })
})
