// ============================================================
// QUOVA Edge Function: send-urgent-email
// Sends immediate email when an urgent alert is created
// Triggered by DB trigger via pg_net or manual invocation
// ============================================================

import { createAdminClient, authenticateRequest, jsonResponse, corsHeaders } from '../_shared/auth.ts'
import { sendEmail } from '../_shared/sendgrid.ts'
import { urgentAlertEmail } from '../_shared/emailTemplates.ts'
import { signUnsubscribeToken } from '../_shared/crypto.ts'

const APP_BASE_URL = Deno.env.get('APP_BASE_URL') ?? 'https://app.quovaos.com'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // Authenticate
  const auth = await authenticateRequest(req)
  if (!auth.authenticated) {
    return jsonResponse({ error: auth.error ?? 'Unauthorized' }, 401)
  }

  // Parse body
  let body: { alert_id: string; org_id: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { alert_id, org_id } = body
  if (!alert_id || !org_id) {
    return jsonResponse({ error: 'Missing alert_id or org_id' }, 400)
  }

  const admin = createAdminClient()

  // Fetch alert
  const { data: alert, error: alertErr } = await admin
    .from('alerts')
    .select('*')
    .eq('id', alert_id)
    .single()

  if (alertErr || !alert) {
    return jsonResponse({ error: 'Alert not found' }, 404)
  }

  // Guard: already emailed
  if (alert.email_sent_at) {
    return jsonResponse({ message: 'Already emailed', alert_id }, 200)
  }

  // Guard: not urgent
  if (alert.severity !== 'urgent') {
    return jsonResponse({ message: 'Not an urgent alert', alert_id }, 200)
  }

  // Fetch org
  const { data: org } = await admin
    .from('organisations')
    .select('id, name, plan')
    .eq('id', org_id)
    .single()

  if (!org || !['pro', 'enterprise'].includes(org.plan)) {
    return jsonResponse({ message: 'Org not on eligible tier', org_id }, 200)
  }

  // Fetch users with email_urgent enabled and matching alert type
  const { data: prefs } = await admin
    .from('notification_preferences')
    .select('user_id, alert_types')
    .eq('org_id', org_id)
    .eq('email_urgent', true)

  if (!prefs || prefs.length === 0) {
    // Mark as sent to avoid re-triggering
    await admin.from('alerts').update({ email_sent_at: new Date().toISOString() }).eq('id', alert_id)
    return jsonResponse({ message: 'No users opted in', alert_id }, 200)
  }

  // Filter to users whose alert_types includes this alert type
  const eligible = prefs.filter(p => p.alert_types?.includes(alert.type))
  if (eligible.length === 0) {
    await admin.from('alerts').update({ email_sent_at: new Date().toISOString() }).eq('id', alert_id)
    return jsonResponse({ message: 'No users subscribed to this alert type', alert_id }, 200)
  }

  // Fetch user emails
  const userIds = eligible.map(p => p.user_id)
  const { data: users } = await admin.auth.admin.listUsers()
  const userMap = new Map(users?.users?.map(u => [u.id, u]) ?? [])

  let sentCount = 0
  const errors: string[] = []

  for (const pref of eligible) {
    const authUser = userMap.get(pref.user_id)
    if (!authUser?.email) continue

    // Build unsubscribe URL
    const tokenStr = await signUnsubscribeToken({ user_id: pref.user_id, pref: 'email_urgent' }, 7 * 86400000)
    const unsubscribeUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/unsubscribe-email?token=${tokenStr}`

    const emailData = urgentAlertEmail({
      alertTitle: alert.title,
      alertBody: alert.body,
      alertType: alert.type,
      severity: alert.severity,
      href: alert.href,
      orgName: org.name,
      appBaseUrl: APP_BASE_URL,
      unsubscribeUrl,
    })

    const result = await sendEmail({
      to: authUser.email,
      toName: undefined,
      subject: emailData.subject,
      html: emailData.html,
    })

    // Log email
    await admin.from('email_logs').insert({
      org_id,
      user_id: pref.user_id,
      email_type: 'urgent_alert',
      recipient: authUser.email,
      subject: emailData.subject,
      alert_id,
      status: result.ok ? 'sent' : 'failed',
      error: result.error ?? null,
    })

    if (result.ok) {
      sentCount++
    } else {
      errors.push(`${authUser.email}: ${result.error}`)
    }
  }

  // Mark alert as emailed
  await admin.from('alerts').update({ email_sent_at: new Date().toISOString() }).eq('id', alert_id)

  return jsonResponse({
    message: `Sent ${sentCount} email(s)`,
    alert_id,
    sent: sentCount,
    errors: errors.length > 0 ? errors : undefined,
  }, 200)
})
