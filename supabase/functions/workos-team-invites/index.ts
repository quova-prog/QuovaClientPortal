import { corsHeaders, createAdminClient, jsonResponse } from '../_shared/auth.ts'
import { authenticateWorkosUser } from '../_shared/workosAuth.ts'
import {
  deactivateWorkosOrganizationMembership,
  listWorkosOrganizationMemberships,
  listWorkosInvitations,
  revokeWorkosInvitation,
  sendWorkosInvitation,
  updateWorkosOrganizationMembershipRole,
  type WorkosOrganizationMembership,
  type WorkosInvitation,
} from '../_shared/workosApi.ts'

type InviteAction = {
  action: 'list' | 'send' | 'revoke' | 'update_role' | 'remove_member'
  email?: string
  role?: 'admin' | 'editor' | 'viewer'
  invitation_id?: string
  profile_id?: string
}

type TargetProfile = {
  id: string
  org_id: string
  role: 'admin' | 'editor' | 'viewer'
  email: string | null
  workos_user_id: string | null
  membership_status: string | null
  deactivated_at: string | null
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

function cleanProfileId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return null
  return trimmed
}

function invitationState(invitation: WorkosInvitation): string {
  return invitation.state ?? invitation.status ?? 'pending'
}

function mapInvitation(invitation: WorkosInvitation, fallbackInviter: string) {
  const state = invitationState(invitation)
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

async function loadTargetProfile(
  admin: ReturnType<typeof createAdminClient>,
  profileId: string,
  orgId: string,
): Promise<TargetProfile | null> {
  const { data, error } = await admin
    .from('profiles')
    .select('id, org_id, role, email, workos_user_id, membership_status, deactivated_at')
    .eq('id', profileId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error || !data) return null
  return data as TargetProfile
}

async function countOtherActiveAdmins(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  targetProfileId: string,
): Promise<number> {
  const { count, error } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('role', 'admin')
    .eq('membership_status', 'active')
    .is('deactivated_at', null)
    .not('workos_user_id', 'is', null)
    .neq('id', targetProfileId)

  if (error) throw new Error('Unable to verify remaining admins')
  return count ?? 0
}

function activeMembership(memberships: WorkosOrganizationMembership[]): WorkosOrganizationMembership | null {
  return memberships.find(membership => (membership.status ?? 'active') === 'active') ?? null
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Team invite request failed'
}

async function resolveActiveWorkosMembership(workosOrgId: string, workosUserId: string): Promise<WorkosOrganizationMembership> {
  const memberships = await listWorkosOrganizationMemberships({
    organization_id: workosOrgId,
    user_id: workosUserId,
  })
  const membership = activeMembership(memberships)
  if (!membership) throw new Error('Active WorkOS membership not found')
  return membership
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

  try {
    if (body.action === 'list') {
      const invitations = await listWorkosInvitations({
        organization_id: auth.context.workosOrgId,
      })
      return jsonResponse({
        invites: invitations
          .filter(invite => invitationState(invite) === 'pending')
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

    if (body.action === 'update_role') {
      const profileId = cleanProfileId(body.profile_id)
      const role = cleanRole(body.role)
      if (!profileId || !role) {
        return jsonResponse({ error: 'Valid profile_id and role are required' }, 400, req)
      }

      const admin = createAdminClient()
      const target = await loadTargetProfile(admin, profileId, auth.context.orgId)
      if (!target || target.membership_status !== 'active' || target.deactivated_at) {
        return jsonResponse({ error: 'User not found in your organization' }, 404, req)
      }
      if (!target.workos_user_id) {
        return jsonResponse({ error: 'Member is not linked to WorkOS' }, 409, req)
      }
      if (role !== 'admin' && target.role === 'admin') {
        const remainingAdmins = await countOtherActiveAdmins(admin, auth.context.orgId, target.id)
        if (remainingAdmins === 0) {
          return jsonResponse({ error: 'Cannot demote the last admin' }, 409, req)
        }
      }

      const membership = await resolveActiveWorkosMembership(auth.context.workosOrgId, target.workos_user_id)
      await updateWorkosOrganizationMembershipRole(membership.id, role)

      const { error: updateError } = await admin
        .from('profiles')
        .update({ role, updated_at: new Date().toISOString() })
        .eq('id', target.id)
        .eq('org_id', auth.context.orgId)

      if (updateError) {
        return jsonResponse({ error: 'WorkOS role changed, but local profile cache could not be updated' }, 500, req)
      }

      return jsonResponse({ message: 'Member role updated', member: { id: target.id, role } }, 200, req)
    }

    if (body.action === 'remove_member') {
      const profileId = cleanProfileId(body.profile_id)
      if (!profileId) {
        return jsonResponse({ error: 'Valid profile_id is required' }, 400, req)
      }
      if (profileId === auth.context.profileId) {
        return jsonResponse({ error: 'Cannot remove yourself from the organization' }, 409, req)
      }

      const admin = createAdminClient()
      const target = await loadTargetProfile(admin, profileId, auth.context.orgId)
      if (!target || target.membership_status !== 'active' || target.deactivated_at) {
        return jsonResponse({ error: 'User not found in your organization' }, 404, req)
      }
      if (!target.workos_user_id) {
        return jsonResponse({ error: 'Member is not linked to WorkOS' }, 409, req)
      }
      if (target.role === 'admin') {
        const remainingAdmins = await countOtherActiveAdmins(admin, auth.context.orgId, target.id)
        if (remainingAdmins === 0) {
          return jsonResponse({ error: 'Cannot remove the last admin' }, 409, req)
        }
      }

      const membership = await resolveActiveWorkosMembership(auth.context.workosOrgId, target.workos_user_id)
      await deactivateWorkosOrganizationMembership(membership.id)

      const { error: updateError } = await admin
        .from('profiles')
        .update({
          membership_status: 'deactivated',
          deactivated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', target.id)
        .eq('org_id', auth.context.orgId)

      if (updateError) {
        return jsonResponse({ error: 'WorkOS membership deactivated, but local profile cache could not be updated' }, 500, req)
      }

      return jsonResponse({ message: 'Member removed' }, 200, req)
    }

    return jsonResponse({ error: 'Unsupported invite action' }, 400, req)
  } catch (error) {
    console.error('workos-team-invites action failed', {
      action: body.action,
      error: actionErrorMessage(error),
    })
    return jsonResponse({ error: actionErrorMessage(error) }, 502, req)
  }
})
