import type { WorkosAuthConfig } from '@/lib/workosConfig'

export const WORKOS_AUTHORIZATION_SESSION_ID_RE = /^[A-Za-z0-9_-]{10,128}$/

export function readWorkosAuthorizationSessionId(search: string | URLSearchParams): string | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const value = params.get('authorization_session_id')?.trim()
    || params.get('authorizationSessionId')?.trim()
    || null

  if (!value || !WORKOS_AUTHORIZATION_SESSION_ID_RE.test(value)) return null
  return value
}

export function buildWorkosAuthorizationSessionUrl(
  config: WorkosAuthConfig,
  authorizationSessionId: string | null,
): string | null {
  const sessionId = authorizationSessionId?.trim()
  if (!sessionId || !WORKOS_AUTHORIZATION_SESSION_ID_RE.test(sessionId)) return null

  const apiHostname = config.workos.apiHostname
  const clientId = config.workos.clientId
  const redirectUri = config.workos.redirectUri
  if (!apiHostname || !clientId || !redirectUri) return null

  const url = new URL(`https://${apiHostname}/`)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('authorization_session_id', sessionId)
  return url.toString()
}
