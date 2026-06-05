import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authenticateUserAal2, corsHeaders, createAdminClient, jsonResponse } from '../_shared/auth.ts'

const ALLOWED_MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-20250514'] as const
type AllowedModel = typeof ALLOWED_MODELS[number]

const MODEL_PRICING_MICROS_PER_MILLION_TOKENS: Record<AllowedModel, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1_000_000, output: 5_000_000 },
  'claude-sonnet-4-20250514': { input: 3_000_000, output: 15_000_000 },
}

const MAX_TOKENS_CEILING = 16384
const MAX_REQUEST_BYTES = 512 * 1024
const MAX_MESSAGES = 12
const MAX_MESSAGE_CONTENT_CHARS = 120_000
const MAX_SYSTEM_CHARS = 40_000

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string
}

type ValidatedAnthropicBody = {
  model: AllowedModel
  max_tokens: number
  messages: AnthropicMessage[]
  system?: string
  temperature?: number
}

type LimitedJsonBody =
  | { body: Record<string, unknown>; bodySizeBytes: number }
  | { error: string; status: number }

async function readLimitedJsonBody(req: Request): Promise<LimitedJsonBody> {
  const contentLength = req.headers.get('content-length')
  if (contentLength) {
    const parsedLength = Number(contentLength)
    if (!Number.isFinite(parsedLength) || parsedLength < 0) {
      return { error: 'Invalid content-length header', status: 400 }
    }
    if (parsedLength > MAX_REQUEST_BYTES) {
      return { error: 'Request body too large', status: 413 }
    }
  }

  if (!req.body) {
    return { error: 'Invalid JSON body', status: 400 }
  }

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let bodySizeBytes = 0

  let streamComplete = false
  while (!streamComplete) {
    const { done, value } = await reader.read()
    if (done) {
      streamComplete = true
      continue
    }
    bodySizeBytes += value.byteLength

    if (bodySizeBytes > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => undefined)
      return { error: 'Request body too large', status: 413 }
    }

    chunks.push(value)
  }

  const bytes = new Uint8Array(bodySizeBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'Invalid JSON body', status: 400 }
    }
    return { body: parsed as Record<string, unknown>, bodySizeBytes }
  } catch {
    return { error: 'Invalid JSON body', status: 400 }
  }
}

function validateAnthropicBody(body: Record<string, unknown>): { value?: ValidatedAnthropicBody; error?: string } {
  const { model, max_tokens, messages, system, temperature } = body

  if (!model || !messages || max_tokens === undefined) {
    return { error: 'Missing required fields: model, max_tokens, messages' }
  }

  if (typeof model !== 'string' || !ALLOWED_MODELS.includes(model as AllowedModel)) {
    return { error: `Model not allowed. Allowed: ${ALLOWED_MODELS.join(', ')}` }
  }

  if (typeof max_tokens !== 'number' || !Number.isInteger(max_tokens) || max_tokens < 1 || max_tokens > MAX_TOKENS_CEILING) {
    return { error: `max_tokens must be an integer from 1 to ${MAX_TOKENS_CEILING}` }
  }

  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return { error: `messages must contain 1 to ${MAX_MESSAGES} items` }
  }

  const validatedMessages: AnthropicMessage[] = []
  for (const message of messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return { error: 'Each message must be an object' }
    }

    const role = (message as Record<string, unknown>).role
    const content = (message as Record<string, unknown>).content

    if (role !== 'user' && role !== 'assistant') {
      return { error: 'Each message role must be user or assistant' }
    }
    if (typeof content !== 'string' || content.length === 0) {
      return { error: 'Each message content must be a non-empty string' }
    }
    if (content.length > MAX_MESSAGE_CONTENT_CHARS) {
      return { error: `Message content exceeds ${MAX_MESSAGE_CONTENT_CHARS} characters` }
    }

    validatedMessages.push({ role, content })
  }

  if (system !== undefined && (typeof system !== 'string' || system.length > MAX_SYSTEM_CHARS)) {
    return { error: `system must be a string up to ${MAX_SYSTEM_CHARS} characters` }
  }

  if (temperature !== undefined && (typeof temperature !== 'number' || temperature < 0 || temperature > 1)) {
    return { error: 'temperature must be a number from 0 to 1' }
  }

  return {
    value: {
      model: model as AllowedModel,
      max_tokens: max_tokens as number,
      messages: validatedMessages,
      ...(system !== undefined ? { system: system as string } : {}),
      ...(temperature !== undefined ? { temperature: temperature as number } : {}),
    },
  }
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function estimateAnthropicInputTokens(messages: AnthropicMessage[], system?: string): number {
  const messageTokens = messages.reduce((sum, message) => sum + 8 + estimateTextTokens(message.content), 16)
  return messageTokens + (system ? estimateTextTokens(system) : 0)
}

function calculateCostMicros(model: AllowedModel, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING_MICROS_PER_MILLION_TOKENS[model]
  return Math.ceil(((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1_000_000)
}

function parseAnthropicUsage(payload: unknown): { inputTokens: number; outputTokens: number } | null {
  if (!payload || typeof payload !== 'object') return null

  const usage = (payload as Record<string, unknown>).usage
  if (!usage || typeof usage !== 'object') return null

  const usageRecord = usage as Record<string, unknown>
  const inputTokens = usageRecord.input_tokens
  const outputTokens = usageRecord.output_tokens
  const cacheCreationInputTokens = usageRecord.cache_creation_input_tokens
  const cacheReadInputTokens = usageRecord.cache_read_input_tokens

  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
    return null
  }

  return {
    inputTokens:
      inputTokens
      + (typeof cacheCreationInputTokens === 'number' ? cacheCreationInputTokens : 0)
      + (typeof cacheReadInputTokens === 'number' ? cacheReadInputTokens : 0),
    outputTokens,
  }
}

function extractAnthropicError(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null

  const error = (payload as Record<string, unknown>).error
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }

  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }

  // User-only auth: validates the JWT signature and enforces AAL2.
  // Service-role keys are not accepted by this helper.
  const auth = await authenticateUserAal2(req)
  if (!auth.authenticated) {
    return jsonResponse({ error: auth.error ?? 'Unauthorized' }, 401, req)
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

  const limitedBody = await readLimitedJsonBody(req)
  if ('error' in limitedBody) {
    return jsonResponse({ error: limitedBody.error }, limitedBody.status, req)
  }

  const validation = validateAnthropicBody(limitedBody.body)
  if (!validation.value) {
    return jsonResponse({ error: validation.error ?? 'Invalid request body' }, 400, req)
  }

  const { model, max_tokens, messages, system, temperature } = validation.value
  const { bodySizeBytes } = limitedBody

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return jsonResponse({ error: 'Service configuration error' }, 500, req)
  }

  const estimatedInputTokens = estimateAnthropicInputTokens(messages, system)
  const reservedOutputTokens = max_tokens
  const estimatedCostMicros = calculateCostMicros(model as AllowedModel, estimatedInputTokens, reservedOutputTokens)

  // Rate Limiting (Financial DoS Protection)
  // The RPC binds user_id and org_id from auth.uid() / profiles
  // internally — the caller cannot forge identities. The inserted
  // usage row reserves the estimated spend before we forward to Anthropic.
  const { data: usageLogId, error: rpcError } = await supabase.rpc('check_and_log_ai_usage', {
    p_model: model,
    p_estimated_input_tokens: estimatedInputTokens,
    p_reserved_output_tokens: reservedOutputTokens,
    p_request_bytes: bodySizeBytes,
    p_estimated_cost_micros: estimatedCostMicros,
  })

  if (rpcError) {
    console.error('Rate limit RPC failed:', rpcError)
    // Map the RPC's own org-membership error to a 403 so the client
    // sees a meaningful response instead of a generic 500.
    if (rpcError.message?.includes('does not belong to an organization')) {
      return jsonResponse({ error: 'User does not belong to an organization' }, 403, req)
    }
    return jsonResponse({ error: 'Failed to enforce rate limit' }, 500, req)
  }

  if (!usageLogId) {
    return jsonResponse({ error: 'AI quota exceeded' }, 429, req)
  }


  // Build the forwarded request body (only pass known fields)
  const anthropicBody: Record<string, unknown> = { model, messages }
  anthropicBody.max_tokens = max_tokens
  if (system !== undefined) anthropicBody.system = system
  if (typeof temperature === 'number') anthropicBody.temperature = temperature

  const admin = createAdminClient()
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

    const anthropicPayload = await anthropicRes.json()
    const actualUsage = parseAnthropicUsage(anthropicPayload)
    const actualInputTokens = actualUsage?.inputTokens ?? estimatedInputTokens
    const actualOutputTokens = actualUsage?.outputTokens ?? (anthropicRes.ok ? reservedOutputTokens : 0)
    const actualCostMicros = actualUsage
      ? calculateCostMicros(model as AllowedModel, actualInputTokens, actualOutputTokens)
      : (anthropicRes.ok ? estimatedCostMicros : 0)

    const { error: updateError } = await admin
      .from('ai_usage_logs')
      .update({
        actual_input_tokens: actualInputTokens,
        actual_output_tokens: actualOutputTokens,
        actual_cost_micros: actualCostMicros,
        cost_tokens: actualInputTokens + actualOutputTokens,
        status: anthropicRes.ok ? 'succeeded' : 'failed',
        completed_at: new Date().toISOString(),
        error_message: anthropicRes.ok ? null : extractAnthropicError(anthropicPayload),
      })
      .eq('id', usageLogId)

    if (updateError) {
      console.error('Failed to update AI usage log:', updateError)
    }

    return new Response(JSON.stringify(anthropicPayload), {
      status: anthropicRes.status,
      headers: {
        ...corsHeaders(req),
        'content-type': anthropicRes.headers.get('content-type') ?? 'application/json',
      },
    })
  } catch (err) {
    console.error('Anthropic API call failed:', err)
    const { error: updateError } = await admin
      .from('ai_usage_logs')
      .update({
        actual_input_tokens: estimatedInputTokens,
        actual_output_tokens: 0,
        actual_cost_micros: 0,
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: 'Failed to reach Anthropic API',
      })
      .eq('id', usageLogId)

    if (updateError) {
      console.error('Failed to update AI usage log after Anthropic failure:', updateError)
    }

    return jsonResponse({ error: 'Failed to reach Anthropic API' }, 502, req)
  }
})
