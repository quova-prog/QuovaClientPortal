const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
