import { corsHeaders, createAdminClient, jsonResponse } from '../_shared/auth.ts'
import { authenticateWorkosIdentity } from '../_shared/workosAuth.ts'
import {
  listWorkosOrganizationMemberships,
  type WorkosOrganizationMembership,
} from '../_shared/workosApi.ts'

type LocalOrg = {
  id: string
  workos_org_id: string
}

function membershipOrgId(membership: WorkosOrganizationMembership): string | null {
  const value = membership.organization_id ?? membership.organizationId
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function activeMemberships(memberships: WorkosOrganizationMembership[]): WorkosOrganizationMembership[] {
  return memberships.filter(membership => (membership.status ?? 'active') === 'active')
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

  try {
    const memberships = activeMemberships(await listWorkosOrganizationMemberships({
      user_id: identity.workosUserId,
    }))
    const workosOrgIds = [...new Set(memberships.map(membershipOrgId).filter((value): value is string => Boolean(value)))]

    if (workosOrgIds.length === 0) {
      return jsonResponse({
        ok: true,
        reason: 'no_membership',
        org_id: null,
        workos_org_id: null,
        message: 'No active WorkOS organization memberships',
      }, 200, req)
    }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('organisations')
      .select('id, workos_org_id')
      .in('workos_org_id', workosOrgIds)

    if (error) {
      return jsonResponse({ error: 'Unable to resolve organization' }, 500, req)
    }

    const matchedOrgs = (data ?? []) as LocalOrg[]
    if (matchedOrgs.length === 0) {
      return jsonResponse({ error: 'Organization not provisioned' }, 404, req)
    }
    if (matchedOrgs.length > 1) {
      return jsonResponse({ error: 'Multiple organizations require selection' }, 409, req)
    }

    const matchedOrg = matchedOrgs[0]
    return jsonResponse({
      ok: true,
      org_id: matchedOrg.id,
      workos_org_id: matchedOrg.workos_org_id,
    }, 200, req)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Organization could not be resolved'
    console.error('resolve-workos-organization failed', { error: message })
    return jsonResponse({ error: message }, 502, req)
  }
})
