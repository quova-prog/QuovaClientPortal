const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const WORKOS_INVITE_TOKEN_SESSION_KEY = 'quova:workos-invitation-token'
const WORKOS_INVITE_TOKEN_TTL_MS = 30 * 60 * 1000

export type InviteParams = {
  legacyInviteId: string | null
  workosInviteToken: string | null
}

export function readInviteParams(search: string | URLSearchParams): InviteParams {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const rawInvite = params.get('invite')?.trim() || null
  const explicitWorkosToken =
    params.get('invitation_token')?.trim()
    || params.get('invitationToken')?.trim()
    || params.get('token')?.trim()
    || null

  if (explicitWorkosToken) {
    return { legacyInviteId: null, workosInviteToken: explicitWorkosToken }
  }

  if (!rawInvite) {
    return { legacyInviteId: null, workosInviteToken: null }
  }

  if (UUID_RE.test(rawInvite)) {
    return { legacyInviteId: rawInvite, workosInviteToken: null }
  }

  return { legacyInviteId: null, workosInviteToken: rawInvite }
}

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function rememberWorkosInviteToken(token: string, now = Date.now()): void {
  const trimmed = token.trim()
  if (!trimmed) return

  const storage = getSessionStorage()
  if (!storage) return

  storage.setItem(WORKOS_INVITE_TOKEN_SESSION_KEY, JSON.stringify({
    token: trimmed,
    savedAt: now,
  }))
}

export function readRememberedWorkosInviteToken(now = Date.now()): string | null {
  const storage = getSessionStorage()
  if (!storage) return null

  const raw = storage.getItem(WORKOS_INVITE_TOKEN_SESSION_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as { token?: unknown; savedAt?: unknown }
    const token = typeof parsed.token === 'string' ? parsed.token.trim() : ''
    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0
    if (!token || !savedAt || now - savedAt > WORKOS_INVITE_TOKEN_TTL_MS) {
      storage.removeItem(WORKOS_INVITE_TOKEN_SESSION_KEY)
      return null
    }

    return token
  } catch {
    storage.removeItem(WORKOS_INVITE_TOKEN_SESSION_KEY)
    return null
  }
}

export function clearRememberedWorkosInviteToken(): void {
  getSessionStorage()?.removeItem(WORKOS_INVITE_TOKEN_SESSION_KEY)
}
