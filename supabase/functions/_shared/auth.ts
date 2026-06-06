// ============================================================
// Auth helpers for Deno Edge Functions
// User AAL2 and service-role authentication are intentionally split:
// service-role access must be explicitly opted into by each endpoint.
// ============================================================

import { createClient, SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2'

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
const TRUSTED_VERCEL_PREVIEW_SUFFIX = '-quova-progs-projects.vercel.app'

export type UserAal2AuthResult =
  | { authenticated: true; user: User }
  | { authenticated: false; error: string }

export type ServiceRoleAuthResult =
  | { authenticated: true }
  | { authenticated: false; error: string }

function isTrustedVercelPreviewOrigin(origin: string): boolean {
  if (!origin) return false

  try {
    const { protocol, hostname } = new URL(origin)
    const originHostname = hostname.toLowerCase()
    return protocol === 'https:' && originHostname.endsWith(TRUSTED_VERCEL_PREVIEW_SUFFIX)
  } catch {
    return false
  }
}

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
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) || isTrustedVercelPreviewOrigin(origin)
    ? origin
    : ALLOWED_ORIGINS[0]
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

function bearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice('Bearer '.length)
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payloadB64Url = token.split('.')[1] ?? ''
    const payloadB64 = payloadB64Url.replace(/-/g, '+').replace(/_/g, '/')
    const padded = payloadB64 + '='.repeat((4 - payloadB64.length % 4) % 4)
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Authenticate an end-user JWT and require AAL2/MFA.
 * Does NOT accept service-role keys. Use authenticateServiceRole() for cron,
 * database trigger, or other server-to-server endpoints.
 */
export async function authenticateUserAal2(req: Request): Promise<UserAal2AuthResult> {
  const token = bearerToken(req)
  if (!token) {
    return { authenticated: false, error: 'Missing Authorization header' }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    return { authenticated: false, error: 'Invalid token' }
  }

  const payload = parseJwtPayload(token)
  if (!payload || payload.aal !== 'aal2') {
    return { authenticated: false, error: 'MFA required (AAL2)' }
  }

  return { authenticated: true, user }
}

/**
 * Authenticate a service-role bearer token. This is intentionally separate
 * from user authentication so service-role access is opt-in per endpoint.
 */
export function authenticateServiceRole(req: Request): ServiceRoleAuthResult {
  const token = bearerToken(req)
  if (!token) {
    return { authenticated: false, error: 'Missing Authorization header' }
  }

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const edgeServiceRoleKey = Deno.env.get('EDGE_SERVICE_ROLE_KEY')
  if ((serviceRoleKey && token === serviceRoleKey) || (edgeServiceRoleKey && token === edgeServiceRoleKey)) {
    return { authenticated: true }
  }

  return { authenticated: false, error: 'Invalid service-role token' }
}
