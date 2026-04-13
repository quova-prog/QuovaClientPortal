// ============================================================
// QUOVA Edge Function: unsubscribe-email
// Handles one-click unsubscribe from email notifications
// No login required (CAN-SPAM compliance)
// ============================================================

import { createAdminClient, htmlResponse, jsonResponse, corsHeaders } from '../_shared/auth.ts'
import { unsubscribeConfirmationHtml } from '../_shared/emailTemplates.ts'
import { verifyUnsubscribeToken } from '../_shared/crypto.ts'

const PREF_LABELS: Record<string, string> = {
  email_urgent: 'urgent alert',
  email_digest: 'daily digest',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const url = new URL(req.url)
  const tokenStr = url.searchParams.get('token')

  if (!tokenStr) {
    return htmlResponse('<h1>Missing token</h1><p>Invalid unsubscribe link.</p>', 400)
  }

  // Decode and verify token
  const payload = await verifyUnsubscribeToken(tokenStr)
  if (!payload) {
    return htmlResponse('<h1>Invalid or Expired Link</h1><p>This unsubscribe link is malformed or has expired. Please update your notification preferences in Quova settings.</p>', 400)
  }

  const { user_id, pref } = payload
  if (!user_id || !pref || !PREF_LABELS[pref]) {
    return htmlResponse('<h1>Invalid token</h1><p>Unknown preference type.</p>', 400)
  }

  const admin = createAdminClient()

  // Update preference
  const { error } = await admin
    .from('notification_preferences')
    .update({ [pref]: false })
    .eq('user_id', user_id)

  if (error) {
    console.error('Unsubscribe failed:', error)
    return htmlResponse('<h1>Error</h1><p>Could not update your preferences. Please try again from Quova settings.</p>', 500)
  }

  return htmlResponse(unsubscribeConfirmationHtml(PREF_LABELS[pref]))
})
