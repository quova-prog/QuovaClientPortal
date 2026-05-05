import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authenticateRequest, corsHeaders, jsonResponse } from '../_shared/auth.ts'

const ALLOWED_MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-20250514']
const MAX_TOKENS_CEILING = 16384

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // Centralised auth: validates the JWT signature AND enforces AAL2.
  // Service-role callers (DB triggers via pg_net) are not expected here
  // and would only receive AI access if they passed their own key,
  // which they don't and shouldn't.
  const auth = await authenticateRequest(req)
  if (!auth.authenticated || !auth.user) {
    return jsonResponse({ error: auth.error ?? 'Unauthorized' }, 401)
  }
  if (auth.isServiceRole) {
    // Service role hitting the AI proxy would charge against no specific
    // user's quota and bypass the per-user rate limit. Block explicitly.
    return jsonResponse({ error: 'Service-role calls not permitted on this endpoint' }, 403)
  }

  // We need the user-scoped Supabase client below for the rate-limit
  // RPC call, since check_and_log_ai_usage relies on auth.uid() inside
  // the function. Re-construct it from the same bearer token.
  const jwt = req.headers.get('Authorization')!.replace('Bearer ', '')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })

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

  // Rate Limiting (Financial DoS Protection)
  // The RPC binds user_id and org_id from auth.uid() / profiles
  // internally — the caller cannot forge identities. We pass only
  // the model. The function raises 'Authentication required' or
  // 'User does not belong to an organization' when those preconditions
  // fail; both surface here as rpcError.
  const { data: allowed, error: rpcError } = await supabase.rpc('check_and_log_ai_usage', {
    p_model: model as string,
  })

  if (rpcError) {
    console.error('Rate limit RPC failed:', rpcError)
    // Map the RPC's own org-membership error to a 403 so the client
    // sees a meaningful response instead of a generic 500.
    if (rpcError.message?.includes('does not belong to an organization')) {
      return jsonResponse({ error: 'User does not belong to an organization' }, 403)
    }
    return jsonResponse({ error: 'Failed to enforce rate limit' }, 500)
  }

  if (!allowed) {
    return jsonResponse({ error: 'Rate limit exceeded: 50 requests per hour allowed.' }, 429)
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
