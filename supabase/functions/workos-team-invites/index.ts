import { corsHeaders, createAdminClient, jsonResponse } from '../_shared/auth.ts'
import { authenticateWorkosUser } from '../_shared/workosAuth.ts'
import {
  listWorkosInvitations,
  revokeWorkosInvitation,
  sendWorkosInvitation,
  type WorkosInvitation,
} from '../_shared/workosApi.ts'

type InviteAction = {
  action: 'list' | 'send' | 'revoke'
  email?: string
  role?: 'admin' | 'editor' | 'viewer'
  invitation_id?: string
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed || !trimmed.includes('@') || trimmed.length > 254) return null
  return trimmed
}

function cleanRole(value: unknown): 'admin' | 'editor' | 'viewer' | null {
  if (value === 'admin' || value === 'editor' || value === 'viewer') return value
  return null
}

function mapInvitation(invitation: WorkosInvitation, fallbackInviter: string) {
  const state = invitation.state ?? invitation.status ?? 'pending'
  const role = invitation.role_slug ?? invitation.roleSlug ?? 'viewer'
  return {
    id: invitation.id,
    email: invitation.email,
    role,
    invited_by: fallbackInviter,
    accepted_at: state === 'accepted' ? (invitation.created_at ?? invitation.createdAt ?? null) : null,
    expires_at: invitation.expires_at ?? invitation.expiresAt ?? '',
    created_at: invitation.created_at ?? invitation.createdAt ?? '',
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }

  const auth = await authenticateWorkosUser(req)
  if (!auth.authenticated) {
    return jsonResponse({ error: auth.error ?? 'Unauthorized' }, 401, req)
  }
  if (!('context' in auth)) {
    return jsonResponse({ error: 'Unauthorized' }, 401, req)
  }

  if (auth.context.role !== 'admin') {
    return jsonResponse({ error: 'Forbidden: Admin access required' }, 403, req)
  }

  let body: InviteAction
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, req)
  }

  if (body.action === 'list') {
    const invitations = await listWorkosInvitations({
      organization_id: auth.context.workosOrgId,
    })
    return jsonResponse({
      invites: invitations
        .filter(invite => (invite.state ?? invite.status ?? 'pending') !== 'revoked')
        .map(invite => mapInvitation(invite, auth.context.profileId)),
    }, 200, req)
  }

  if (body.action === 'send') {
    const email = cleanEmail(body.email)
    const role = cleanRole(body.role)
    if (!email || !role) {
      return jsonResponse({ error: 'Valid email and role are required' }, 400, req)
    }

    const invitation = await sendWorkosInvitation({
      email,
      organization_id: auth.context.workosOrgId,
      role_slug: role,
      expires_in_days: 7,
      inviter_user_id: auth.context.workosUserId,
    })

    const admin = createAdminClient()
    await admin.from('email_logs').insert({
      org_id: auth.context.orgId,
      user_id: auth.context.profileId,
      email_type: 'team_invite',
      recipient: email,
      subject: 'You have been invited to Quova',
      status: 'sent',
      error: null,
    })

    return jsonResponse({
      message: 'Invite email sent',
      invite: mapInvitation(invitation, auth.context.profileId),
    }, 200, req)
  }

  if (body.action === 'revoke') {
    if (!body.invitation_id) {
      return jsonResponse({ error: 'Missing invitation_id' }, 400, req)
    }

    const invitation = await revokeWorkosInvitation(body.invitation_id)
    return jsonResponse({
      message: 'Invite revoked',
      invite: mapInvitation(invitation, auth.context.profileId),
    }, 200, req)
  }

  return jsonResponse({ error: 'Unsupported invite action' }, 400, req)
})
