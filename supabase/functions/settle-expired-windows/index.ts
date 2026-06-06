// ============================================================
// QUOVA Edge Function: settle-expired-windows
// Daily cron job. Two responsibilities:
//   1. Force-settle window forwards whose window has ended with undrawn
//      notional (calls the settle_expired_windows() RPC, which inserts a
//      final draw at the contracted rate).
//   2. Fire approaching-expiry alerts (T-7 warning, T-2 urgent) for active
//      window forwards with remaining notional.
// Service-role only (no user-triggered mass settlement).
// ============================================================

import { createAdminClient, authenticateServiceRole, jsonResponse, corsHeaders } from '../_shared/auth.ts'

interface WindowPosition {
  id: string
  org_id: string
  currency_pair: string
  notional_base: number
  drawn_notional: number
  window_end_date: string
  reference_number: string | null
}

function daysUntil(dateStr: string): number {
  const end = new Date(dateStr + 'T00:00:00Z').getTime()
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime()
  return Math.round((end - today) / 86_400_000)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }

  const auth = await authenticateServiceRole(req)
  if (!auth.authenticated) {
    return jsonResponse({ error: auth.error ?? 'Unauthorized' }, 401, req)
  }

  const admin = createAdminClient()

  // 1. Force-settle expired windows.
  const { data: settledCount, error: settleErr } = await admin.rpc('settle_expired_windows')
  if (settleErr) {
    return jsonResponse({ error: `settle_expired_windows failed: ${settleErr.message}` }, 500, req)
  }

  // 2. Approaching-expiry alerts. Active window forwards ending within 7 days
  //    that still have undrawn notional.
  const { data: positions, error: posErr } = await admin
    .from('hedge_positions')
    .select('id, org_id, currency_pair, notional_base, drawn_notional, window_end_date, reference_number')
    .eq('instrument_type', 'window_forward')
    .eq('status', 'active')

  let alertsFired = 0
  if (!posErr && positions) {
    for (const p of positions as WindowPosition[]) {
      const remaining = Number(p.notional_base) - Number(p.drawn_notional)
      if (remaining <= 0) continue
      const d = daysUntil(p.window_end_date)
      // Fire at the T-7 and T-2 thresholds only.
      if (d !== 7 && d !== 2) continue

      const ref = p.reference_number ?? p.id.slice(0, 8).toUpperCase()
      const severity = d <= 2 ? 'urgent' : 'warning'
      const alertKey = `window_expiring_${p.id}_t${d}`
      const { error: upsertErr } = await admin
        .from('alerts')
        .upsert({
          org_id: p.org_id,
          alert_key: alertKey,
          type: 'maturing_position',
          severity,
          title: `Window forward ${ref} settles in ${d} days`,
          body: `${p.currency_pair} window forward ${ref} has ${remaining.toLocaleString()} `
            + `${p.currency_pair.split('/')[0]} undrawn. It auto-settles at the window end on `
            + `${p.window_end_date} if not drawn before then.`,
          href: '/trade',
          metadata: { position_id: p.id, remaining, window_end_date: p.window_end_date, days_until: d },
        }, { onConflict: 'org_id,alert_key' })
      if (!upsertErr) alertsFired += 1
    }
  }

  return jsonResponse({
    message: 'Window settlement sweep complete',
    settled: settledCount ?? 0,
    alerts_fired: alertsFired,
  }, 200, req)
})
