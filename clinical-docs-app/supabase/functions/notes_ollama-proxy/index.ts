import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

// Ollama Cloud does not send CORS headers, so browsers can never call
// https://ollama.com/api/chat directly cross-origin. This function relays
// the request server-to-server (no CORS applies between two servers) and
// attaches our own CORS headers to the response we send back to the
// browser.
//
// Unlike the original version of this proxy, the Ollama Cloud API key is
// now a server-side secret (OLLAMA_CLOUD_API_KEY) rather than something the
// browser sends — the browser authenticates with its own Supabase user
// session instead (see verify_jwt in the deploy config), and this function
// injects the real key before relaying to Ollama Cloud.
//
// ALLOWED_ORIGINS (optional): comma-separated list of allowed origins, e.g.
//   "https://notes.docz.space,https://app.example.com"
// Leave unset to allow any origin - useful when this one Supabase project
// backs many independent repos/sites and the calling origins aren't fixed.

const OLLAMA_API_URL = 'https://ollama.com/api/chat'
const OLLAMA_CLOUD_API_KEY = Deno.env.get('OLLAMA_CLOUD_API_KEY') ?? ''

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
