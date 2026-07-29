import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

// Ollama Cloud does not send CORS headers, so browsers can never call
// https://ollama.com/api/chat directly cross-origin. This function relays
// the request server-to-server (no CORS applies between two servers) and
// attaches our own CORS headers to the response we send back to the
// browser.
//
// Unlike the original version of this proxy, the Ollama Cloud API key is
// now a server-side secret (OLLAMA_CLOUD_API_KEY) rather than something the
// browser sends — the browser authenticates with its own Supabase user
// session instead, and this function injects the real key before relaying
// to Ollama Cloud.
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

const OLLAMA_API_URL = 'https://ollama.com/api/chat'
const OLLAMA_CLOUD_API_KEY = Deno.env.get('OLLAMA_CLOUD_API_KEY') ?? ''
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

  if (!OLLAMA_CLOUD_API_KEY) {
    return jsonResponse(req, { error: 'Server is not configured with an Ollama Cloud API key.' }, 500)
  }

  let bodyText: string
  try {
    bodyText = await req.text()
    JSON.parse(bodyText)
  } catch {
    return jsonResponse(req, { error: 'Invalid request body.' }, 400)
  }

  let upstream: Response
  try {
    upstream = await fetch(OLLAMA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OLLAMA_CLOUD_API_KEY}`,
      },
      body: bodyText,
    })
  } catch (error) {
    console.error('notes_ollama-proxy: upstream fetch failed', error)
    return jsonResponse(req, { error: 'Failed to reach Ollama Cloud.' }, 502)
  }

  const headers = new Headers(corsHeaders(req))
  headers.set('Content-Type', upstream.headers.get('content-type') ?? 'application/x-ndjson')

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  })
})
