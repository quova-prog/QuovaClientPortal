// ============================================================
// QUOVA Edge Function: send-daily-digest
// Sends daily/weekly digest emails with attached PDF
// Triggered by pg_cron (hourly) or manual invocation
// ============================================================

import { createAdminClient, authenticateRequest, jsonResponse, corsHeaders } from '../_shared/auth.ts'
import { sendEmail } from '../_shared/sendgrid.ts'
import { dailyDigestEmail } from '../_shared/emailTemplates.ts'
import { generateDigestPdf, type DigestPdfData } from '../_shared/digestPdf.ts'
import { signUnsubscribeToken } from '../_shared/crypto.ts'

const APP_BASE_URL = Deno.env.get('APP_BASE_URL') ?? 'https://app.quovaos.com'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const auth = await authenticateRequest(req)
  if (!auth.authenticated) {
    return jsonResponse({ error: auth.error ?? 'Unauthorized' }, 401)
  }
  
  if (!auth.isServiceRole) {
    return jsonResponse({ error: 'Forbidden: Service Role required for mass digest operations' }, 403)
  }

  // Optional: target a specific org
  let targetOrgId: string | null = null
  try {
    const body = await req.json()
    targetOrgId = body.org_id ?? null
  } catch {
    // No body = process all orgs
  }

  const admin = createAdminClient()
  const currentHour = new Date().getUTCHours()
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString()

  // Fetch eligible orgs (Pro + Enterprise)
  let orgQuery = admin.from('organisations').select('id, name, plan').in('plan', ['pro', 'enterprise'])
  if (targetOrgId) orgQuery = orgQuery.eq('id', targetOrgId)
  const { data: orgs } = await orgQuery

  if (!orgs || orgs.length === 0) {
    return jsonResponse({ message: 'No eligible orgs', sent: 0 }, 200)
  }

  let totalSent = 0
  const orgResults: Record<string, { sent: number; errors: string[] }> = {}

  for (const org of orgs) {
    // Find users with digest enabled and matching delivery hour
    const { data: prefs } = await admin
      .from('notification_preferences')
      .select('user_id, digest_frequency, digest_time')
      .eq('org_id', org.id)
      .eq('email_digest', true)
      .eq('digest_time', currentHour)

    if (!prefs || prefs.length === 0) continue

    // Determine if this is a daily or weekly run day
    const dayOfWeek = new Date().getUTCDay() // 0=Sun, 1=Mon
    const dailyUsers = prefs.filter(p => p.digest_frequency === 'daily')
    const weeklyUsers = prefs.filter(p => p.digest_frequency === 'weekly' && dayOfWeek === 1) // Monday
    const eligiblePrefs = [...dailyUsers, ...weeklyUsers]

    if (eligiblePrefs.length === 0) continue

    // Gather org data for digest
    const digestData = await gatherDigestData(admin, org.id, org.name, yesterday)

    // Generate PDF
    let pdfBase64: string
    try {
      const pdfBytes = generateDigestPdf(digestData)
      const pdfArray = Array.from(new Uint8Array(pdfBytes))
      pdfBase64 = btoa(pdfArray.map(b => String.fromCharCode(b)).join(''))
    } catch (err) {
      console.error(`PDF generation failed for org ${org.id}:`, err)
      pdfBase64 = ''
    }

    // Fetch user emails
    const { data: authUsers } = await admin.auth.admin.listUsers()
    const userMap = new Map(authUsers?.users?.map(u => [u.id, u]) ?? [])

    const orgResult = { sent: 0, errors: [] as string[] }

    for (const pref of eligiblePrefs) {
      const authUser = userMap.get(pref.user_id)
      if (!authUser?.email) continue

      const emailType = pref.digest_frequency === 'weekly' ? 'weekly_digest' : 'daily_digest'

      // Build unsubscribe URL
      let tokenStr = ''
      try {
        tokenStr = await signUnsubscribeToken({ user_id: pref.user_id, pref: 'email_digest' }, 7 * 86400000)
      } catch (err) {
        console.error(`Failed to generate unsubscribe token for user ${pref.user_id}:`, err)
        orgResult.errors.push(`${authUser.email}: Token generation failed`)
        continue // Skip sending if we can't attach an unsubscribe token
      }
      const unsubscribeUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/unsubscribe-email?token=${tokenStr}`

      const emailContent = dailyDigestEmail({
        orgName: org.name,
        date: today,
        totalExposureUsd: fmtUsd(digestData.totalExposureUsd),
        coveragePct: `${digestData.overallCoveragePct.toFixed(1)}%`,
        activeHedges: digestData.activeHedgeCount,
        unhedgedUsd: fmtUsd(digestData.unhedgedUsd),
        urgentCount: digestData.alerts.filter(a => a.severity === 'urgent').length,
        warningCount: digestData.alerts.filter(a => a.severity === 'warning').length,
        infoCount: digestData.alerts.filter(a => a.severity === 'info').length,
        topAlerts: digestData.alerts.slice(0, 5).map(a => ({ title: a.title, severity: a.severity, type: a.type })),
        appBaseUrl: APP_BASE_URL,
        unsubscribeUrl,
      })

      const result = await sendEmail({
        to: authUser.email,
        subject: emailContent.subject,
        html: emailContent.html,
        attachment: pdfBase64 ? {
          content: pdfBase64,
          filename: `quova-digest-${today}.pdf`,
          type: 'application/pdf',
        } : undefined,
      })

      // Log
      await admin.from('email_logs').insert({
        org_id: org.id,
        user_id: pref.user_id,
        email_type: emailType,
        recipient: authUser.email,
        subject: emailContent.subject,
        status: result.ok ? 'sent' : 'failed',
        error: result.error ?? null,
      })

      if (result.ok) {
        orgResult.sent++
        totalSent++
      } else {
        orgResult.errors.push(`${authUser.email}: ${result.error}`)
      }
    }

    orgResults[org.id] = orgResult
  }

  return jsonResponse({ message: `Digest complete`, sent: totalSent, orgs: orgResults }, 200)
})

// ── Data gathering ────────────────────────────────────────────────────

async function gatherDigestData(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  orgName: string,
  since: string,
): Promise<DigestPdfData> {
  // Fetch alerts from past 24h
  const { data: alerts } = await admin
    .from('alerts')
    .select('severity, type, title, created_at')
    .eq('org_id', orgId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  // Fetch exposure summary
  const { data: exposureSummary } = await admin
    .from('v_exposure_summary')
    .select('*')
    .eq('org_id', orgId)

  // Fetch hedge coverage
  const { data: hedgeCoverage } = await admin
    .from('v_hedge_coverage')
    .select('*')
    .eq('org_id', orgId)

  // Fetch active hedge count
  const { count: activeHedgeCount } = await admin
    .from('hedge_positions')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'active')

  // Fetch policy
  const { data: policy } = await admin
    .from('hedge_policies')
    .select('min_coverage_pct, max_coverage_pct')
    .eq('org_id', orgId)
    .eq('active', true)
    .maybeSingle()

  // Fetch maturing positions (7 days)
  const sevenDaysOut = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
  const { data: maturing } = await admin
    .from('hedge_positions')
    .select('currency_pair, instrument_type, notional_usd, notional_base, value_date')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .lte('value_date', sevenDaysOut)
    .order('value_date')

  // Compute aggregates
  const totalExposureUsd = (exposureSummary ?? []).reduce((s, r) => s + Math.abs(r.total_usd_equivalent ?? 0), 0)
  const totalHedgedUsd = (hedgeCoverage ?? []).reduce((s, r) => s + Math.abs(r.total_hedged ?? 0), 0)
  const overallCoveragePct = totalExposureUsd > 0 ? (totalHedgedUsd / totalExposureUsd) * 100 : 0
  const unhedgedUsd = Math.max(0, totalExposureUsd - totalHedgedUsd)

  const coverageByPair = (hedgeCoverage ?? []).map(c => ({
    pair: c.currency_pair,
    exposureUsd: Math.abs(c.net_exposure ?? 0),
    hedgedUsd: Math.abs(c.total_hedged ?? 0),
    coveragePct: c.coverage_pct ?? 0,
    status: (c.coverage_pct ?? 0) >= (policy?.min_coverage_pct ?? 85) ? 'compliant' : 'under_hedged',
  }))

  const maturingPositions = (maturing ?? []).map(m => ({
    pair: m.currency_pair,
    instrument: m.instrument_type,
    notionalUsd: m.notional_usd ?? m.notional_base,
    valueDate: m.value_date,
    daysToMaturity: Math.max(0, Math.ceil((new Date(m.value_date).getTime() - Date.now()) / 86400000)),
  }))

  return {
    orgName,
    date: new Date().toISOString().split('T')[0],
    totalExposureUsd,
    totalHedgedUsd,
    overallCoveragePct,
    activeHedgeCount: activeHedgeCount ?? 0,
    unhedgedUsd,
    policyMinPct: policy?.min_coverage_pct ?? 85,
    policyMaxPct: policy?.max_coverage_pct ?? 120,
    coverageByPair,
    alerts: (alerts ?? []).map(a => ({
      severity: a.severity,
      type: a.type,
      title: a.title,
      created_at: a.created_at,
    })),
    maturingPositions,
  }
}

function fmtUsd(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1_000_000)     return `${sign}$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1_000)         return `${sign}$${(abs / 1e3).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}
