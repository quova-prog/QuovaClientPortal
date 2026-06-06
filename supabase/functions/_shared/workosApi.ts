const WORKOS_API_BASE = Deno.env.get('WORKOS_API_BASE') ?? 'https://api.workos.com'

export type WorkosOrganization = {
  id: string
  name?: string
}

export type WorkosInvitation = {
  id: string
  email: string
  state?: string
  status?: string
  role_slug?: string
  roleSlug?: string
  organization_id?: string
  expires_at?: string
  expiresAt?: string
  created_at?: string
  createdAt?: string
}

export type WorkosUser = {
  id: string
  email: string
  first_name?: string | null
  firstName?: string | null
  last_name?: string | null
  lastName?: string | null
  name?: string | null
}

export type WorkosOrganizationMembership = {
  id: string
  user_id?: string
  userId?: string
  organization_id?: string
  organizationId?: string
  status?: 'active' | 'inactive' | 'pending'
  role?: { slug?: string }
  roles?: Array<{ slug?: string }>
}

function apiKey(): string {
  const value = Deno.env.get('WORKOS_API_KEY')
  if (!value) throw new Error('Missing WORKOS_API_KEY')
  return value
}

async function workosFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const apiKey = Deno.env.get('WORKOS_API_KEY')
  if (!apiKey) throw new Error('Missing WORKOS_API_KEY')

  const response = await fetch(`${WORKOS_API_BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  const text = await response.text()
  let body: Record<string, unknown> = {}
  try {
    body = text ? JSON.parse(text) as Record<string, unknown> : {}
  } catch {
    body = text ? { message: text } : {}
  }

  if (!response.ok) {
    const message = typeof body.message === 'string'
      ? body.message
      : typeof body.error === 'string'
        ? body.error
        : typeof body.error_description === 'string'
          ? body.error_description
          : `WorkOS request failed with ${response.status}`
    throw new Error(message)
  }

  return body as T
}

function unwrap<T>(body: Record<string, unknown>, key: string): T {
  return (body[key] ?? body) as T
}

export async function getWorkosOrganizationByExternalId(externalId: string): Promise<WorkosOrganization | null> {
  try {
    const body = await workosFetch<Record<string, unknown>>(`/organizations/external_id/${encodeURIComponent(externalId)}`)
    return unwrap<WorkosOrganization>(body, 'organization')
  } catch (error) {
    if (error instanceof Error && /not found|404/i.test(error.message)) return null
    return null
  }
}

export async function createWorkosOrganization(input: {
  name: string
  externalId: string
}): Promise<WorkosOrganization> {
  const body = await workosFetch<Record<string, unknown>>('/organizations', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      external_id: input.externalId,
    }),
  })
  return unwrap<WorkosOrganization>(body, 'organization')
}

export async function createWorkosOrganizationMembership(input: {
  organizationId: string
  userId: string
  roleSlug: 'admin' | 'editor' | 'viewer'
}): Promise<void> {
  await workosFetch<Record<string, unknown>>('/user_management/organization_memberships', {
    method: 'POST',
    body: JSON.stringify({
      organization_id: input.organizationId,
      user_id: input.userId,
      role_slug: input.roleSlug,
    }),
  })
}

export async function listWorkosOrganizationMemberships(input: {
  organization_id: string
  user_id: string
}): Promise<WorkosOrganizationMembership[]> {
  const params = new URLSearchParams({
    organization_id: input.organization_id,
    user_id: input.user_id,
    limit: '100',
  })
  const body = await workosFetch<{ data?: WorkosOrganizationMembership[] }>(`/user_management/organization_memberships?${params.toString()}`)
  return body.data ?? []
}

export async function listWorkosUsers(input: {
  email: string
}): Promise<WorkosUser[]> {
  const params = new URLSearchParams({
    email: input.email,
    limit: '10',
  })
  const body = await workosFetch<{ data?: WorkosUser[] }>(`/user_management/users?${params.toString()}`)
  return body.data ?? []
}

export async function updateWorkosOrganizationMembershipRole(
  membershipId: string,
  roleSlug: 'admin' | 'editor' | 'viewer',
): Promise<WorkosOrganizationMembership> {
  const body = await workosFetch<Record<string, unknown>>(`/user_management/organization_memberships/${encodeURIComponent(membershipId)}`, {
    method: 'PUT',
    body: JSON.stringify({ role_slug: roleSlug }),
  })
  return unwrap<WorkosOrganizationMembership>(body, 'organization_membership')
}

export async function deactivateWorkosOrganizationMembership(membershipId: string): Promise<WorkosOrganizationMembership> {
  const body = await workosFetch<Record<string, unknown>>(`/user_management/organization_memberships/${encodeURIComponent(membershipId)}/deactivate`, {
    method: 'PUT',
  })
  return unwrap<WorkosOrganizationMembership>(body, 'organization_membership')
}

export async function listWorkosInvitations(input: {
  organization_id: string
}): Promise<WorkosInvitation[]> {
  const params = new URLSearchParams({
    organization_id: input.organization_id,
    limit: '100',
  })
  const body = await workosFetch<{ data?: WorkosInvitation[] }>(`/user_management/invitations?${params.toString()}`)
  return body.data ?? []
}

export async function sendWorkosInvitation(input: {
  email: string
  organization_id: string
  role_slug: 'admin' | 'editor' | 'viewer'
  expires_in_days: number
  inviter_user_id: string
}): Promise<WorkosInvitation> {
  apiKey()
  const body = await workosFetch<Record<string, unknown>>('/user_management/invitations', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return unwrap<WorkosInvitation>(body, 'invitation')
}

export async function revokeWorkosInvitation(invitationId: string): Promise<WorkosInvitation> {
  const body = await workosFetch<Record<string, unknown>>(`/user_management/invitations/${encodeURIComponent(invitationId)}/revoke`, {
    method: 'POST',
  })
  return unwrap<WorkosInvitation>(body, 'invitation')
}
