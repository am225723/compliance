import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

// Keeps the Gemini (Google AI Studio) API key server-side. The browser never
// holds this key — it authenticates to this function with its own Supabase
// user session (see verify_jwt in the deploy config), and this function
// injects the real Gemini key from the GEMINI_API_KEY secret before relaying
// the request to Google. The client sends the same body shape it used to
// send directly to Gemini (minus the key), plus `model`, which this function
// pulls out to build the upstream URL.

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''

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
