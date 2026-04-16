// ============================================================
// QUOVA Edge Function: send-nudge
// Sends email and/or in-app nudge notifications to customers
// when support staff detect data gaps.
// ============================================================

import { createAdminClient, authenticateRequest, jsonResponse, corsHeaders } from '../_shared/auth.ts'
import { sendEmail } from '../_shared/sendgrid.ts'
import { signUnsubscribeToken } from '../_shared/crypto.ts'

const APP_BASE_URL = Deno.env.get('APP_BASE_URL') ?? 'https://app.quovaos.com'

// ── Nudge templates ──────────────────────────────────────────

interface NudgeTemplate {
  subject: string
  title: string
  message: string
  cta_url: string
}

const NUDGE_TEMPLATES: Record<string, NudgeTemplate> = {
  no_hedge_policy: {
    subject: 'Set up your hedge policy in Quova',
    title: 'Hedge policy not configured',
    message: 'A hedge policy defines your target coverage range and risk tolerance. Without one, Quova cannot generate recommendations or flag policy breaches. It only takes a few minutes to configure.',
    cta_url: '/strategy',
  },
  no_exposures: {
    subject: 'Upload your FX exposures to Quova',
    title: 'No FX exposures uploaded',
    message: 'Quova needs your FX exposure data to calculate coverage ratios, generate hedge recommendations, and produce board reports. Upload a CSV or connect your ERP to get started.',
    cta_url: '/upload',
  },
  no_entities: {
    subject: 'Add your legal entities in Quova',
    title: 'No legal entities configured',
    message: 'Legal entities allow Quova to track exposures and hedges at the subsidiary level, which is essential for intercompany netting and consolidated reporting.',
    cta_url: '/settings',
  },
  stale_exposures: {
    subject: 'Your Quova exposure data may be outdated',
    title: 'Exposure data may be stale',
    message: 'Your FX exposure data has not been updated recently. Stale data leads to inaccurate coverage ratios and can cause missed hedging opportunities. Please upload a fresh file or check your ERP connection.',
    cta_url: '/upload',
  },
  no_hedges: {
    subject: 'Book your first hedge in Quova',
    title: 'No hedges booked yet',
    message: 'You have FX exposures but no hedge positions recorded. Use the Hedge Advisor to get AI-powered recommendations, or book a hedge directly to start tracking your coverage.',
    cta_url: '/advisor',
  },
  no_bank_accounts: {
    subject: 'Add your bank accounts to Quova',
    title: 'No bank accounts configured',
    message: 'Bank accounts are needed for settlement tracking and cash flow forecasting. Adding them takes just a minute and unlocks more accurate reporting.',
    cta_url: '/bank-accounts',
  },
  no_counterparties: {
    subject: 'Add your counterparties in Quova',
    title: 'No counterparties configured',
    message: 'Counterparty records let Quova track which banks you trade with, monitor concentration risk, and generate accurate trade confirmations.',
    cta_url: '/counterparties',
  },
  onboarding_stalled: {
    subject: 'Complete your Quova onboarding',
    title: 'Onboarding incomplete',
    message: 'It looks like your onboarding is not yet finished. Completing it unlocks the full Quova platform including exposure analytics, hedge tracking, and board reporting.',
    cta_url: '/onboarding',
  },
  coverage_below_policy: {
    subject: 'Coverage alert: below policy minimum',
    title: 'Coverage below policy minimum',
    message: 'One or more currency pairs have hedge coverage below your policy minimum. Review your exposure page and consider booking additional hedges to bring coverage back into policy range.',
    cta_url: '/exposure',
  },
  hedges_expiring_soon: {
    subject: 'Hedge positions expiring soon',
    title: 'Hedges expiring soon',
    message: 'You have hedge positions approaching maturity. Review them to decide whether to roll, close, or let them settle. Unrolled hedges will leave your exposure unhedged after maturity.',
    cta_url: '/trade',
  },
  no_recent_login: {
    subject: 'We miss you at Quova',
    title: 'Time to check in',
    message: 'It has been a while since your last login. FX markets move daily, and your exposure profile may have changed. Log in to review your coverage and make sure your hedges are on track.',
    cta_url: '/dashboard',
  },
}

// ── Email HTML builder ───────────────────────────────────────

function buildNudgeEmailHtml(opts: {
  title: string
  message: string
  customMessage?: string
  ctaUrl: string
  ctaLabel: string
  orgName: string
  unsubscribeUrl: string
}): string {
  const body = opts.customMessage ?? opts.message
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 0">
<tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
    <!-- Header -->
    <tr><td style="background:#0b1526;padding:24px 32px;text-align:center">
      <span style="color:#00c8a0;font-size:22px;font-weight:700;letter-spacing:0.5px">Quova</span>
    </td></tr>
    <!-- Body -->
    <tr><td style="padding:32px">
      <h2 style="margin:0 0 16px;color:#0f172a;font-size:18px;font-weight:600">${escapeHtml(opts.title)}</h2>
      <p style="margin:0 0 8px;color:#475569;font-size:14px;line-height:1.6">Hi ${escapeHtml(opts.orgName)} team,</p>
      <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6">${escapeHtml(body)}</p>
      <table cellpadding="0" cellspacing="0"><tr><td style="background:#00c8a0;border-radius:8px;padding:12px 28px">
        <a href="${APP_BASE_URL}${opts.ctaUrl}" style="color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;display:inline-block">${escapeHtml(opts.ctaLabel)}</a>
      </td></tr></table>
    </td></tr>
    <!-- Footer -->
    <tr><td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center">
      <p style="margin:0;color:#94a3b8;font-size:12px">
        This is an automated nudge from Quova support on behalf of your account.
        <br><a href="${opts.unsubscribeUrl}" style="color:#94a3b8;text-decoration:underline">Unsubscribe</a>
      </p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Main handler ─────────────────────────────────────────────

interface NudgeGap {
  type: string
  channel: 'email' | 'in_app' | 'both'
}

interface NudgeRequest {
  org_id: string
  gaps: NudgeGap[]
  custom_message?: string
}

interface GapResult {
  gap_type: string
  status: 'sent' | 'skipped' | 'failed'
  error?: string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // ── Auth ───────────────────────────────────────────────────
  const auth = await authenticateRequest(req)
  if (!auth.authenticated || !auth.user) {
    return jsonResponse({ error: auth.error ?? 'Unauthorized' }, 401)
  }

  const userId = auth.user.id

  // ── Parse body ─────────────────────────────────────────────
  let body: NudgeRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { org_id, gaps, custom_message } = body
  if (!org_id || !Array.isArray(gaps) || gaps.length === 0) {
    return jsonResponse({ error: 'Missing org_id or gaps array' }, 400)
  }

  const admin = createAdminClient()

  // ── Verify caller is active support user ───────────────────
  const { data: supportUser } = await admin
    .from('support_users')
    .select('id, is_active')
    .eq('user_id', userId)
    .single()

  if (!supportUser?.is_active) {
    return jsonResponse({ error: 'Forbidden: active support user required' }, 403)
  }

  // ── Verify JIT access grant for target org ─────────────────
  const { data: grant } = await admin
    .from('support_access_grants')
    .select('id')
    .eq('user_id', userId)
    .eq('org_id', org_id)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .single()

  if (!grant) {
    return jsonResponse({ error: 'Forbidden: no active JIT access grant for this organisation' }, 403)
  }

  // ── Fetch org name ─────────────────────────────────────────
  const { data: org } = await admin
    .from('organisations')
    .select('id, name')
    .eq('id', org_id)
    .single()

  const orgName = org?.name ?? 'your organisation'

  // ── Fetch admin/editor profiles for email ──────────────────
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, email, role')
    .eq('org_id', org_id)
    .in('role', ['admin', 'editor'])

  const emailRecipients = (profiles ?? []).filter((p: any) => p.email)

  // ── Process each gap ───────────────────────────────────────
  const results: GapResult[] = []

  for (const gap of gaps) {
    const template = NUDGE_TEMPLATES[gap.type]
    if (!template) {
      results.push({ gap_type: gap.type, status: 'failed', error: `Unknown gap type: ${gap.type}` })
      continue
    }

    try {
      // ── 72h cooldown check ───────────────────────────────
      const cooldownCutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
      const { data: recentNudge } = await admin
        .from('nudges')
        .select('id')
        .eq('org_id', org_id)
        .eq('gap_type', gap.type)
        .gt('created_at', cooldownCutoff)
        .limit(1)
        .single()

      if (recentNudge) {
        results.push({ gap_type: gap.type, status: 'skipped', error: 'Nudge sent within last 72 hours' })
        continue
      }

      const sendEmailChannel = gap.channel === 'email' || gap.channel === 'both'
      const sendInApp = gap.channel === 'in_app' || gap.channel === 'both'
      let emailSent = false
      let inAppSent = false

      // ── Send email ─────────────────────────────────────
      if (sendEmailChannel && emailRecipients.length > 0) {
        for (const recipient of emailRecipients) {
          const tokenStr = await signUnsubscribeToken(
            { user_id: recipient.id, pref: 'email_urgent' },
            30 * 86400000, // 30-day expiry for nudge unsubscribe
          )
          const unsubscribeUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/unsubscribe-email?token=${tokenStr}`

          const html = buildNudgeEmailHtml({
            title: template.title,
            message: template.message,
            customMessage: custom_message,
            ctaUrl: template.cta_url,
            ctaLabel: 'Open Quova',
            orgName,
            unsubscribeUrl,
          })

          const result = await sendEmail({
            to: recipient.email,
            subject: template.subject,
            html,
          })

          // Log to email_logs
          await admin.from('email_logs').insert({
            org_id,
            user_id: recipient.id,
            email_type: 'nudge',
            recipient: recipient.email,
            subject: template.subject,
            status: result.ok ? 'sent' : 'failed',
            error: result.error ?? null,
          })

          if (result.ok) emailSent = true
        }
      }

      // ── Create in-app notification ─────────────────────
      if (sendInApp) {
        const { error: notifErr } = await admin
          .from('customer_notifications')
          .insert({
            org_id,
            gap_type: gap.type,
            title: template.title,
            message: custom_message ?? template.message,
            cta_url: template.cta_url,
          })

        if (!notifErr) inAppSent = true
      }

      // ── Record nudge ──────────────────────────────────
      await admin.from('nudges').insert({
        org_id,
        gap_type: gap.type,
        channel: gap.channel,
        message: custom_message ?? template.message,
        sent_by: userId,
      })

      const channelSuccess =
        (sendEmailChannel && emailSent) ||
        (sendInApp && inAppSent) ||
        (sendEmailChannel && emailRecipients.length === 0 && sendInApp && inAppSent)

      results.push({
        gap_type: gap.type,
        status: channelSuccess ? 'sent' : 'failed',
        error: channelSuccess ? undefined : 'No recipients or delivery failed',
      })
    } catch (err) {
      results.push({ gap_type: gap.type, status: 'failed', error: String(err) })
    }
  }

  return jsonResponse({ results }, 200)
})
