// ============================================================
// QUOVA Edge Function: close-accounting-period
// Admin-only accounting close orchestration. The client supplies approved
// fair-value/effectiveness inputs; the function loads designations, balances,
// and draw events server-side, then writes through narrow accounting RPCs.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createAdminClient, authenticateRequest, jsonResponse, corsHeaders } from '../_shared/auth.ts'
import {
  closeAccountingPeriod,
  createSupabaseCloseAccountingRepository,
  type CloseDesignationPeriodInput,
} from '../_shared/hedgeAccounting.ts'

const PERIOD_RE = /^[0-9]{4}-[0-9]{2}$/

interface CloseAccountingPeriodBody {
  period?: unknown
  inputsByDesignationId?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseInputsByDesignationId(value: unknown): Record<string, CloseDesignationPeriodInput> {
  if (!isRecord(value)) return {}
  return value as Record<string, CloseDesignationPeriodInput>
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }

  const auth = await authenticateRequest(req)
  if (!auth.authenticated || !auth.user) {
    return jsonResponse({ error: auth.error ?? 'Unauthorized' }, 401, req)
  }
  if (auth.isServiceRole) {
    return jsonResponse({ error: 'Service-role calls not permitted on this endpoint' }, 403, req)
  }

  let body: CloseAccountingPeriodBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, req)
  }

  const period = typeof body.period === 'string' ? body.period : ''
  if (!PERIOD_RE.test(period)) {
    return jsonResponse({ error: 'Invalid accounting period' }, 400, req)
  }

  const admin = createAdminClient()
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('org_id, role')
    .eq('id', auth.user.id)
    .single()

  if (profileErr || !profile) {
    return jsonResponse({ error: 'Profile not found' }, 403, req)
  }
  if (profile?.role !== 'admin') {
    return jsonResponse({ error: 'Forbidden: Admin role required' }, 403, req)
  }

  const jwt = req.headers.get('Authorization')!.replace('Bearer ', '')
  const userDb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  )

  const repository = createSupabaseCloseAccountingRepository({
    db: userDb as never,
    orgId: profile.org_id,
    inputsByDesignationId: parseInputsByDesignationId(body.inputsByDesignationId),
  })

  try {
    const result = await closeAccountingPeriod(repository, period)
    return jsonResponse({
      message: 'Accounting period close complete',
      period: result.period,
      call_count: result.callCount,
    }, 200, req)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = /locked|missing fair value|missing effectiveness|invalid accounting period/i.test(message)
      ? 409
      : 500
    return jsonResponse({ error: message }, status, req)
  }
})
