import { corsHeaders, createAdminClient, jsonResponse } from '../_shared/auth.ts'
import { authenticateWorkosIdentity } from '../_shared/workosAuth.ts'

type ExistingProfile = {
  id: string
  org_id: string
  role: string
  email: string | null
  membership_status: string
  deactivated_at: string | null
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

  const { data: rawExistingProfile, error: existingError } = await admin
    .from('profiles')
    .select('id, org_id, role, email, membership_status, deactivated_at')
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

    if (existingProfile.role === identity.role && existingProfile.email === identity.email) {
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
        email: identity.email,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingProfile.id)
      .eq('org_id', org.id)
      .select('id, org_id, role, email')
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
      membership_status: 'active',
    })
    .select('id, org_id, role, email')
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
