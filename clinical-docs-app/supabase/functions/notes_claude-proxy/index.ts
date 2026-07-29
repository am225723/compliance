import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

// Keeps the Anthropic (Claude) API key server-side. The browser never holds
// this key — it authenticates to this function with its own Supabase user
// session, and this function injects the real Claude key from the
// CLAUDE_API_KEY secret before relaying the request to Anthropic. The client
// sends the exact same body shape it used to send directly to Anthropic
// (model, max_tokens, stream, system, messages); only the auth headers
// differ.
//
// verify_jwt is deliberately OFF for this function (see deploy config). The
// platform's own JWT verification runs before ANY of our code, including the
// OPTIONS branch below — and browsers never attach Authorization to a CORS
// preflight, so turning it on causes every preflight to be rejected with no
// CORS headers at all (looks like "No 'Access-Control-Allow-Origin' header
// is present" in the browser, since the request never reaches this handler).
// Instead we verify the caller's session JWT ourselves, after handling
// OPTIONS, using supabase-js against the project's own auth server.

const CLAUDE_API_KEY = Deno.env.get('CLAUDE_API_KEY') ?? ''
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
// Supabase injects these into every Edge Function automatically.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? ''
  const allowOrigin =
    allowedOrigins.length === 0
      ? origin || '*'
      : allowedOrigins.includes(origin)
        ? origin
        : ''

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function isAllowedOrigin(req: Request) {
  const origin = req.headers.get('origin') ?? ''
  return allowedOrigins.length === 0 || !origin || allowedOrigins.includes(origin)
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
    if (!isAllowedOrigin(req)) {
      return new Response(null, { status: 403, headers: corsHeaders(req) })
    }
    return new Response(null, { headers: corsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'Method not allowed.' }, 405)
  }

  if (!isAllowedOrigin(req)) {
    return jsonResponse(req, { error: 'Origin is not allowed.' }, 403)
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

  if (!CLAUDE_API_KEY) {
    return jsonResponse(req, { error: 'Server is not configured with a Claude API key.' }, 500)
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
    upstream = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: bodyText,
    })
  } catch (error) {
    console.error('notes_claude-proxy: upstream fetch failed', error)
    return jsonResponse(req, { error: 'Failed to reach Claude.' }, 502)
  }

  const headers = new Headers(corsHeaders(req))
  headers.set('Content-Type', upstream.headers.get('content-type') ?? 'text/event-stream')

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  })
})
