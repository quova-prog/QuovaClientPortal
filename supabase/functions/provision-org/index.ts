import { corsHeaders, createAdminClient, jsonResponse } from '../_shared/auth.ts'
import { authenticateWorkosIdentity } from '../_shared/workosAuth.ts'
import {
  createWorkosOrganization,
  createWorkosOrganizationMembership,
  getWorkosOrganizationByExternalId,
} from '../_shared/workosApi.ts'

const PROVISION_MAX_ATTEMPTS = 5
const PROVISION_RATE_LIMIT_MS = 60 * 60 * 1000
const PROVISION_IN_PROGRESS_MS = 30 * 1000

type ProvisionLock = {
  workos_user_id: string
  status: 'in_progress' | 'complete' | 'failed'
  attempts: number
  local_org_id: string | null
  local_profile_id: string | null
  workos_org_id: string | null
  first_attempt_at: string
  last_attempt_at: string
}

function cleanOrgName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length < 2 || trimmed.length > 120) return null
  return trimmed
}

function ageMs(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY
  return Date.now() - new Date(value).getTime()
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

  const orgName = cleanOrgName(body.org_name)
  if (!orgName) {
    return jsonResponse({ error: 'Organization name is required' }, 400, req)
  }

  const admin = createAdminClient()
  const { data: existingProfile, error: existingProfileError } = await admin
    .from('profiles')
    .select('id, org_id')
    .eq('workos_user_id', identity.workosUserId)
    .maybeSingle()

  if (existingProfileError) {
    return jsonResponse({ error: 'Unable to check existing membership' }, 500, req)
  }

  if (existingProfile) {
    return jsonResponse({ error: 'WorkOS user already has a local profile' }, 409, req)
  }

  const { data: rawExistingLock } = await admin
    .from('workos_provisioning_locks')
    .select('*')
    .eq('workos_user_id', identity.workosUserId)
    .maybeSingle()

  const existingLock = rawExistingLock as ProvisionLock | null
  if (existingLock?.status === 'complete' && existingLock.workos_org_id && existingLock.local_org_id && existingLock.local_profile_id) {
    return jsonResponse({
      ok: true,
      action: 'existing',
      org_id: existingLock.local_org_id,
      profile_id: existingLock.local_profile_id,
      workos_org_id: existingLock.workos_org_id,
    }, 200, req)
  }

  if (existingLock?.status === 'in_progress' && ageMs(existingLock.last_attempt_at) < PROVISION_IN_PROGRESS_MS) {
    return jsonResponse({ error: 'Provisioning already in progress' }, 409, req)
  }

  if (
    existingLock
    && existingLock.attempts >= PROVISION_MAX_ATTEMPTS
    && ageMs(existingLock.last_attempt_at) < PROVISION_RATE_LIMIT_MS
  ) {
    return jsonResponse({ error: 'Provisioning rate limit exceeded' }, 429, req)
  }

  const localOrgId = existingLock?.local_org_id ?? crypto.randomUUID()
  const localProfileId = existingLock?.local_profile_id ?? crypto.randomUUID()
  const nextAttempts = (existingLock?.attempts ?? 0) + 1
  const now = new Date().toISOString()

  const lockPayload = {
    workos_user_id: identity.workosUserId,
    email: identity.email,
    org_name: orgName,
    status: 'in_progress',
    attempts: nextAttempts,
    local_org_id: localOrgId,
    local_profile_id: localProfileId,
    error: null,
    last_attempt_at: now,
    ...(existingLock ? {} : { first_attempt_at: now }),
  }

  const lockWrite = existingLock
    ? await admin.from('workos_provisioning_locks').update(lockPayload).eq('workos_user_id', identity.workosUserId)
    : await admin.from('workos_provisioning_locks').insert(lockPayload)

  if (lockWrite.error) {
    return jsonResponse({ error: 'Unable to reserve provisioning lock' }, 500, req)
  }

  try {
    const existingWorkosOrg = await getWorkosOrganizationByExternalId(localOrgId)
    const workosOrg = existingWorkosOrg ?? await createWorkosOrganization({
      name: orgName,
      externalId: localOrgId,
    })

    await createWorkosOrganizationMembership({
      organizationId: workosOrg.id,
      userId: identity.workosUserId,
      roleSlug: 'admin',
    })

    const bankId = localOrgId
    const { error: bankError } = await admin
      .from('banks')
      .upsert({
        id: bankId,
        slug: `workos-${localOrgId}`,
        display_name: `${orgName} Bank`,
        legal_name: `${orgName} Bank`,
        region: 'global',
        status: 'active',
      }, {
        onConflict: 'id',
      })

    if (bankError) throw new Error('Unable to upsert local bank')

    const { error: orgError } = await admin
      .from('organisations')
      .upsert({
        id: localOrgId,
        bank_id: bankId,
        name: orgName,
        plan: 'exposure',
        modules: ['fx'],
        workos_org_id: workosOrg.id,
      }, {
        onConflict: 'id',
      })

    if (orgError) throw new Error('Unable to upsert local organization')

    const { error: profileError } = await admin
      .from('profiles')
      .insert({
        id: localProfileId,
        org_id: localOrgId,
        workos_user_id: identity.workosUserId,
        email: identity.email,
        role: 'admin',
        membership_status: 'active',
      })

    if (profileError) throw new Error('Unable to create local profile')

    await admin
      .from('workos_provisioning_locks')
      .update({
        status: 'complete',
        workos_org_id: workosOrg.id,
        completed_at: new Date().toISOString(),
        error: null,
      })
      .eq('workos_user_id', identity.workosUserId)

    return jsonResponse({
      ok: true,
      action: 'created',
      org_id: localOrgId,
      profile_id: localProfileId,
      workos_org_id: workosOrg.id,
    }, 200, req)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provisioning failed'
    await admin
      .from('workos_provisioning_locks')
      .update({
        status: 'failed',
        error: message,
        last_attempt_at: new Date().toISOString(),
      })
      .eq('workos_user_id', identity.workosUserId)

    return jsonResponse({ error: message }, 500, req)
  }
})
