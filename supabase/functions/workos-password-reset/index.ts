import { corsHeaders, jsonResponse } from '../_shared/auth.ts'
import { createWorkosPasswordReset, getWorkosUser, type WorkosPasswordReset } from '../_shared/workosApi.ts'
import { authenticateWorkosUser } from '../_shared/workosAuth.ts'

function cleanEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? ''
  return trimmed && trimmed.includes('@') ? trimmed : null
}

function resetUrlFrom(reset: WorkosPasswordReset): string | null {
  const value = reset.password_reset_url ?? reset.passwordResetUrl
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }

  const auth = await authenticateWorkosUser(req)
  if (!auth.authenticated || !('context' in auth)) {
    return jsonResponse({ error: auth.error ?? 'Unauthorized' }, 401, req)
  }

  let email = cleanEmail(auth.context.email)
  if (!email) {
    try {
      const user = await getWorkosUser(auth.context.workosUserId)
      email = cleanEmail(user.email)
    } catch {
      return jsonResponse({ error: 'Unable to resolve WorkOS user email' }, 500, req)
    }
  }

  if (!email) {
    return jsonResponse({ error: 'WorkOS user email is required' }, 400, req)
  }

  let reset: WorkosPasswordReset
  try {
    reset = await createWorkosPasswordReset({ email })
  } catch (error) {
    const detail = error instanceof Error && error.message.trim()
      ? error.message
      : 'Unable to create password reset'
    return jsonResponse({ error: detail }, 502, req)
  }

  const resetUrl = resetUrlFrom(reset)
  if (!resetUrl) {
    return jsonResponse({ error: 'WorkOS did not return a password reset URL' }, 502, req)
  }

  return jsonResponse({
    ok: true,
    email,
    password_reset_url: resetUrl,
  }, 200, req)
})
