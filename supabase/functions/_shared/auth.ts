// ============================================================
// Auth helpers for Deno Edge Functions
// Supports service role key (server-to-server) and user JWT
// ============================================================

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

export { corsHeaders }

export function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { ...corsHeaders, 'content-type': 'text/html; charset=utf-8' },
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

  // Service role key auth (used by DB triggers via pg_net)
  if (token === serviceRoleKey) {
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

  return { authenticated: true, isServiceRole: false, user }
}
