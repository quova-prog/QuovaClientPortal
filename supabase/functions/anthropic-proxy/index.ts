import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-20250514']
const MAX_TOKENS_CEILING = 16384

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // Authenticate caller via Supabase JWT
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing or invalid Authorization header' }, 401)
  }

  const jwt = authHeader.replace('Bearer ', '')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  // Parse and validate request body
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { model, max_tokens, messages, system, temperature } = body

  if (!model || !messages) {
    return jsonResponse({ error: 'Missing required fields: model, messages' }, 400)
  }

  if (!ALLOWED_MODELS.includes(model as string)) {
    return jsonResponse({ error: `Model not allowed. Allowed: ${ALLOWED_MODELS.join(', ')}` }, 400)
  }

  if (typeof max_tokens === 'number' && max_tokens > MAX_TOKENS_CEILING) {
    return jsonResponse({ error: `max_tokens exceeds ceiling of ${MAX_TOKENS_CEILING}` }, 400)
  }

  // Build the forwarded request body (only pass known fields)
  const anthropicBody: Record<string, unknown> = { model, messages }
  if (typeof max_tokens === 'number') anthropicBody.max_tokens = max_tokens
  if (system !== undefined) anthropicBody.system = system
  if (typeof temperature === 'number') anthropicBody.temperature = temperature

  // Forward to Anthropic
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return jsonResponse({ error: 'Service configuration error' }, 500)
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
    })

    return new Response(anthropicRes.body, {
      status: anthropicRes.status,
      headers: {
        ...corsHeaders,
        'content-type': anthropicRes.headers.get('content-type') ?? 'application/json',
      },
    })
  } catch (err) {
    console.error('Anthropic API call failed:', err)
    return jsonResponse({ error: 'Failed to reach Anthropic API' }, 502)
  }
})
