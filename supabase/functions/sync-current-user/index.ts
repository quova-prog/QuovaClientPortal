import { corsHeaders, createAdminClient, jsonResponse } from '../_shared/auth.ts'
import { getWorkosUser, type WorkosUser } from '../_shared/workosApi.ts'
import { authenticateWorkosIdentity, type WorkosVerifiedIdentity } from '../_shared/workosAuth.ts'

type ExistingProfile = {
  id: string
  org_id: string
  role: string
  email: string | null
  full_name: string | null
  membership_status: string
  deactivated_at: string | null
}

function cleanProfileName(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed || null
}

function workosUserFullName(user: WorkosUser): string | null {
  const name = cleanProfileName(user.name)
  if (name) return name

  const firstName = cleanProfileName(user.first_name) ?? cleanProfileName(user.firstName)
  const lastName = cleanProfileName(user.last_name) ?? cleanProfileName(user.lastName)
  return [firstName, lastName].filter(Boolean).join(' ') || null
}

async function resolveWorkosFullName(identity: WorkosVerifiedIdentity): Promise<string | null> {
  const claimFullName = cleanProfileName(identity.fullName)
  if (claimFullName) return claimFullName

  try {
    const user = await getWorkosUser(identity.workosUserId)
    return workosUserFullName(user)
  } catch (error) {
    console.warn('Unable to resolve WorkOS user name', error instanceof Error ? error.message : error)
    return null
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }

  const identityAuth = await authenticateWorkosIdentity(req)
  if (!identityAuth.authenticated) {
    return jsonResponse({ error: identityAuth.error ?? 'Unauthorized' }, 401, req)
  }

  const identity = identityAuth.identity
  if (!identity.workosOrgId) {
    return jsonResponse({ error: 'WorkOS org_id is required' }, 400, req)
  }

  const admin = createAdminClient()
  const { data: org, error: orgError } = await admin
    .from('organisations')
    .select('id, name, workos_org_id')
    .eq('workos_org_id', identity.workosOrgId)
    .maybeSingle()

  if (orgError) {
    return jsonResponse({ error: 'Unable to resolve organization' }, 500, req)
  }
  if (!org) {
    return jsonResponse({ error: 'Organization not provisioned' }, 404, req)
  }

  const { data: crossOrgProfile } = await admin
    .from('profiles')
    .select('id, org_id')
    .eq('workos_user_id', identity.workosUserId)
    .neq('org_id', org.id)
    .is('deactivated_at', null)
    .maybeSingle()

  if (crossOrgProfile) {
    return jsonResponse({ error: 'WorkOS user is already linked to another organization' }, 409, req)
  }

  const workosFullName = await resolveWorkosFullName(identity)

  const { data: rawExistingProfile, error: existingError } = await admin
    .from('profiles')
    .select('id, org_id, role, email, full_name, membership_status, deactivated_at')
    .eq('workos_user_id', identity.workosUserId)
    .eq('org_id', org.id)
    .maybeSingle()

  if (existingError) {
    return jsonResponse({ error: 'Unable to resolve local profile' }, 500, req)
  }

  const existingProfile = rawExistingProfile as ExistingProfile | null
  if (existingProfile) {
    if (existingProfile.membership_status !== 'active' || existingProfile.deactivated_at) {
      return jsonResponse({ error: 'Membership is deactivated' }, 403, req)
    }

    const nextEmail = identity.email ?? existingProfile.email
    const existingFullName = cleanProfileName(existingProfile.full_name)
    const shouldBackfillFullName = !existingFullName && !!workosFullName
    if (existingProfile.role === identity.role && existingProfile.email === nextEmail && !shouldBackfillFullName) {
      return jsonResponse({
        ok: true,
        action: 'updated',
        profile_id: existingProfile.id,
        org_id: existingProfile.org_id,
      }, 200, req)
    }

    const { data: updatedProfile, error: updateError } = await admin
      .from('profiles')
      .update({
        role: identity.role,
        email: nextEmail,
        ...(shouldBackfillFullName ? { full_name: workosFullName } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingProfile.id)
      .eq('org_id', org.id)
      .select('id, org_id, role, email, full_name')
      .single()

    if (updateError || !updatedProfile) {
      return jsonResponse({ error: 'Unable to refresh local profile' }, 500, req)
    }

    return jsonResponse({
      ok: true,
      action: 'updated',
      profile_id: updatedProfile.id,
      org_id: updatedProfile.org_id,
    }, 200, req)
  }

  const { data: insertedProfile, error: insertError } = await admin
    .from('profiles')
    .insert({
      id: crypto.randomUUID(),
      workos_user_id: identity.workosUserId,
      org_id: org.id,
      role: identity.role,
      email: identity.email,
      full_name: workosFullName,
      membership_status: 'active',
    })
    .select('id, org_id, role, email, full_name')
    .single()

  if (insertError || !insertedProfile) {
    return jsonResponse({ error: 'Unable to create local profile' }, 500, req)
  }

  return jsonResponse({
    ok: true,
    action: 'created',
    profile_id: insertedProfile.id,
    org_id: insertedProfile.org_id,
  }, 200, req)
})
