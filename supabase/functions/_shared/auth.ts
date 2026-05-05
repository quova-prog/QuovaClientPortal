// ============================================================
// Auth helpers for Deno Edge Functions
// Supports service role key (server-to-server) and user JWT
// ============================================================

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── CORS allowlist ───────────────────────────────────────────
// Origins permitted to call Edge Functions from a browser.
// Override at deploy time with the ALLOWED_ORIGINS env var
// (comma-separated). The first entry is also the default echoed
// back when the request has no Origin header (server-to-server,
// pg_net cron, etc) — though for those callers CORS is irrelevant.
const FALLBACK_ORIGINS = [
  'https://app.quovaos.com',
  'https://support.quovaos.com',
  // Local dev (Vite default ports)
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://localhost:5177',
]

const ENV_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const ALLOWED_ORIGINS: string[] = ENV_ORIGINS.length > 0 ? ENV_ORIGINS : FALLBACK_ORIGINS

/**
 * Build CORS headers for a specific request.
 *
 * If the request's `Origin` header is on the allowlist, that origin
 * is echoed back exactly. Otherwise the first allowlisted origin is
 * returned as the default — the browser will block cross-origin
 * fetches that don't match, which is the desired behaviour.
 *
 * Always includes `Vary: Origin` so caches don't conflate responses
 * across different request origins.
 */
export function corsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get('Origin') ?? ''
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin':  allowOrigin,
    'Vary':                         'Origin',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  }
}

export function jsonResponse(body: Record<string, unknown>, status: number, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'content-type': 'application/json' },
  })
}

export function htmlResponse(html: string, status = 200, req?: Request): Response {
  return new Response(html, {
    status,
    headers: { ...corsHeaders(req), 'content-type': 'text/html; charset=utf-8' },
  })
}

/** Create a Supabase admin client (service role — bypasses RLS) */
export function createAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

/** Authenticate request — accepts service role key or user JWT */
export async function authenticateRequest(req: Request): Promise<{ authenticated: boolean; isServiceRole?: boolean; user?: any; error?: string }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { authenticated: false, error: 'Missing Authorization header' }
  }

  const token = authHeader.replace('Bearer ', '')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const edgeServiceRoleKey = Deno.env.get('EDGE_SERVICE_ROLE_KEY')

  // Service role key auth (used by DB triggers via pg_net)
  if (token === serviceRoleKey || (edgeServiceRoleKey && token === edgeServiceRoleKey)) {
    return { authenticated: true, isServiceRole: true }
  }

  // User JWT auth
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    return { authenticated: false, error: 'Invalid token' }
  }

  // Enforce AAL2 (MFA). JWT payloads are base64url-encoded, not
  // standard base64 — convert before atob() so payloads containing
  // '-' or '_' aren't falsely rejected with InvalidCharacterError.
  try {
    const payloadB64Url = token.split('.')[1] ?? ''
    const payloadB64 = payloadB64Url.replace(/-/g, '+').replace(/_/g, '/')
    const padded = payloadB64 + '='.repeat((4 - payloadB64.length % 4) % 4)
    const payloadStr = atob(padded)
    const payload = JSON.parse(payloadStr)
    if (payload.aal !== 'aal2') {
      return { authenticated: false, error: 'MFA required (AAL2)' }
    }
  } catch (e) {
    return { authenticated: false, error: 'Invalid token payload or missing AAL' }
  }

  return { authenticated: true, isServiceRole: false, user }
}
