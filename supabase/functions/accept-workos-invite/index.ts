import { corsHeaders, createAdminClient, jsonResponse } from '../_shared/auth.ts'
import { authenticateWorkosIdentity } from '../_shared/workosAuth.ts'
import {
  acceptWorkosInvitation,
  findWorkosInvitationByToken,
  getWorkosUser,
  listWorkosOrganizationMemberships,
  type WorkosInvitation,
  type WorkosOrganizationMembership,
  type WorkosUser,
} from '../_shared/workosApi.ts'

type LocalOrg = {
  id: string
  workos_org_id: string
}

type LocalProfile = {
  id: string
  org_id: string
  full_name: string | null
}

type AppRole = 'admin' | 'editor' | 'viewer'

const VALID_ROLES = new Set<AppRole>(['admin', 'editor', 'viewer'])

function cleanInviteToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length < 8 || trimmed.length > 512 || /\s/.test(trimmed)) return null
  return trimmed
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed || !trimmed.includes('@') || trimmed.length > 254) return null
  return trimmed
}

function cleanRole(value: unknown): AppRole | null {
  return typeof value === 'string' && VALID_ROLES.has(value as AppRole) ? value as AppRole : null
}

function invitationState(invitation: WorkosInvitation): string {
  return (invitation.state ?? invitation.status ?? 'pending').toLowerCase()
}

function invitationEmail(invitation: WorkosInvitation): string | null {
  return cleanEmail(invitation.email)
}

function invitationOrganizationId(invitation: WorkosInvitation): string | null {
  const value = invitation.organization_id ?? invitation.organizationId
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function invitationRole(invitation: WorkosInvitation): AppRole {
  return cleanRole(invitation.role_slug ?? invitation.roleSlug) ?? 'viewer'
}

function membershipUserId(membership: WorkosOrganizationMembership): string | null {
  return membership.user_id ?? membership.userId ?? null
}

function membershipOrgId(membership: WorkosOrganizationMembership): string | null {
  return membership.organization_id ?? membership.organizationId ?? null
}

function membershipRole(membership: WorkosOrganizationMembership): AppRole | null {
  return cleanRole(membership.role?.slug) ?? cleanRole(membership.roles?.[0]?.slug)
}

function activeMembership(memberships: WorkosOrganizationMembership[]): WorkosOrganizationMembership | null {
  return memberships.find(membership => (membership.status ?? 'active') === 'active') ?? null
}

function workosUserEmail(user: WorkosUser): string | null {
  return cleanEmail(user.email)
}

function workosUserFullName(user: WorkosUser): string | null {
  const name = typeof user.name === 'string' ? user.name.trim() : ''
  if (name) return name

  const firstName = typeof user.first_name === 'string'
    ? user.first_name.trim()
    : typeof user.firstName === 'string'
      ? user.firstName.trim()
      : ''
  const lastName = typeof user.last_name === 'string'
    ? user.last_name.trim()
    : typeof user.lastName === 'string'
      ? user.lastName.trim()
      : ''
  return [firstName, lastName].filter(Boolean).join(' ') || null
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Invitation could not be accepted'
}

async function ensureLocalProfile(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    org: LocalOrg
    workosUser: WorkosUser
    role: AppRole
  },
) {
  const { org, workosUser, role } = input
  const email = workosUserEmail(workosUser)
  if (!email) throw new Error('Signed-in WorkOS user has no verified email')

  const now = new Date().toISOString()
  const fullName = workosUserFullName(workosUser)
  const profilePayload = (existingFullName: string | null = null) => ({
    workos_user_id: workosUser.id,
    email,
    full_name: fullName ?? existingFullName,
    role,
    membership_status: 'active',
    deactivated_at: null,
    updated_at: now,
  })

  const { data: crossOrgWorkosProfile, error: crossOrgWorkosError } = await admin
    .from('profiles')
    .select('id, org_id')
    .eq('workos_user_id', workosUser.id)
    .neq('org_id', org.id)
    .is('deactivated_at', null)
    .maybeSingle()

  if (crossOrgWorkosError) throw new Error('Unable to verify existing WorkOS profile')
  if (crossOrgWorkosProfile) throw new Error('WorkOS user is already linked to another organization')

  const { data: crossOrgEmailProfile, error: crossOrgEmailError } = await admin
    .from('profiles')
    .select('id, org_id')
    .ilike('email', email)
    .neq('org_id', org.id)
    .is('deactivated_at', null)
    .maybeSingle()

  if (crossOrgEmailError) throw new Error('Unable to verify existing email profile')
  if (crossOrgEmailProfile) throw new Error('Email is already linked to another organization')

  const { data: existingByWorkos, error: existingByWorkosError } = await admin
    .from('profiles')
    .select('id, org_id, full_name')
    .eq('workos_user_id', workosUser.id)
    .eq('org_id', org.id)
    .maybeSingle()

  if (existingByWorkosError) throw new Error('Unable to resolve local WorkOS profile')
  if (existingByWorkos) {
    const existingProfile = existingByWorkos as LocalProfile
    const { data: updatedProfile, error: updateError } = await admin
      .from('profiles')
      .update(profilePayload(existingProfile.full_name))
      .eq('id', existingProfile.id)
      .eq('org_id', org.id)
      .select('id, org_id')
      .single()

    if (updateError || !updatedProfile) throw new Error('Unable to refresh local profile')
    return { action: 'updated' as const, profile: updatedProfile as { id: string; org_id: string } }
  }

  const { data: existingByEmail, error: existingByEmailError } = await admin
    .from('profiles')
    .select('id, org_id, full_name')
    .eq('org_id', org.id)
    .ilike('email', email)
    .maybeSingle()

  if (existingByEmailError) throw new Error('Unable to resolve local email profile')
  if (existingByEmail) {
    const existingProfile = existingByEmail as LocalProfile
    const { data: linkedProfile, error: linkError } = await admin
      .from('profiles')
      .update(profilePayload(existingProfile.full_name))
      .eq('id', existingProfile.id)
      .eq('org_id', org.id)
      .select('id, org_id')
      .single()

    if (linkError || !linkedProfile) throw new Error('Unable to link local profile')
    return { action: 'updated' as const, profile: linkedProfile as { id: string; org_id: string } }
  }

  const { data: insertedProfile, error: insertError } = await admin
    .from('profiles')
    .insert({
      id: crypto.randomUUID(),
      org_id: org.id,
      created_at: now,
      ...profilePayload(),
    })
    .select('id, org_id')
    .single()

  if (insertError || !insertedProfile) throw new Error('Unable to create local profile')
  return { action: 'created' as const, profile: insertedProfile as { id: string; org_id: string } }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }

  const identityAuth = await authenticateWorkosIdentity(req, { allowMissingOrgId: true })
  if (!identityAuth.authenticated) {
    return jsonResponse({ error: identityAuth.error ?? 'Unauthorized' }, 401, req)
  }

  const identity = identityAuth.identity
  if (identity.workosOrgId) {
    return jsonResponse({ error: 'Use sync-current-user for organization-scoped sessions' }, 409, req)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, req)
  }

  const invitationToken = cleanInviteToken(body.invitation_token)
  if (!invitationToken) {
    return jsonResponse({ error: 'Valid invitation_token is required' }, 400, req)
  }

  try {
    const workosUser = await getWorkosUser(identity.workosUserId)
    const signedInEmail = workosUserEmail(workosUser)
    if (!signedInEmail) {
      return jsonResponse({ error: 'Signed-in WorkOS user has no email' }, 400, req)
    }

    const invitation = await findWorkosInvitationByToken(invitationToken)
    const inviteEmail = invitationEmail(invitation)
    if (!inviteEmail || inviteEmail !== signedInEmail) {
      return jsonResponse({ error: 'Invitation email does not match signed-in user' }, 403, req)
    }

    const state = invitationState(invitation)
    if (state !== 'pending' && state !== 'accepted') {
      return jsonResponse({ error: 'Invitation is no longer pending' }, 409, req)
    }

    const workosOrgId = invitationOrganizationId(invitation)
    if (!workosOrgId) {
      return jsonResponse({ error: 'Invitation is not linked to an organization' }, 400, req)
    }

    const admin = createAdminClient()
    const { data: org, error: orgError } = await admin
      .from('organisations')
      .select('id, workos_org_id')
      .eq('workos_org_id', workosOrgId)
      .maybeSingle()

    if (orgError) {
      return jsonResponse({ error: 'Unable to resolve organization' }, 500, req)
    }
    if (!org) {
      return jsonResponse({ error: 'Organization not provisioned' }, 404, req)
    }

    const acceptedInvitation = state === 'accepted'
      ? invitation
      : await acceptWorkosInvitation(invitation.id)

    const memberships = await listWorkosOrganizationMemberships({
      organization_id: workosOrgId,
      user_id: identity.workosUserId,
    })
    const membership = activeMembership(memberships)
    if (!membership) {
      throw new Error('Active WorkOS membership not found after invitation acceptance')
    }
    if (membershipUserId(membership) && membershipUserId(membership) !== identity.workosUserId) {
      throw new Error('WorkOS membership user mismatch')
    }
    if (membershipOrgId(membership) && membershipOrgId(membership) !== workosOrgId) {
      throw new Error('WorkOS membership organization mismatch')
    }

    const role = membershipRole(membership) ?? invitationRole(acceptedInvitation)
    const { action, profile } = await ensureLocalProfile(admin, {
      org: org as LocalOrg,
      workosUser,
      role,
    })

    return jsonResponse({
      ok: true,
      action,
      org_id: profile.org_id,
      profile_id: profile.id,
      workos_org_id: workosOrgId,
    }, 200, req)
  } catch (error) {
    console.error('accept-workos-invite failed', {
      error: actionErrorMessage(error),
    })
    return jsonResponse({ error: actionErrorMessage(error) }, 502, req)
  }
})
