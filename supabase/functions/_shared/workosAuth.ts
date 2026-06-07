import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'https://esm.sh/jose@5.9.6'

export type WorkosAppRole = 'admin' | 'editor' | 'viewer'

export type WorkosUserAuthContext = {
  workosUserId: string
  workosOrgId: string
  profileId: string
  orgId: string
  role: 'admin' | 'editor' | 'viewer'
  email: string | null
}

export type WorkosVerifiedIdentity = {
  workosUserId: string
  workosOrgId: string | null
  role: WorkosAppRole
  email: string | null
  firstName: string | null
  lastName: string | null
  fullName: string | null
}

export type WorkosAuthOptions = {
  allowMissingOrgId?: boolean
}

export type WorkosIdentityAuthResult =
  | { authenticated: true; identity: WorkosVerifiedIdentity }
  | { authenticated: false; error: string }

export type WorkosAuthResult =
  | { authenticated: true; context: WorkosUserAuthContext }
  | WorkosIdentityAuthResult

type WorkosJwtClaims = JWTPayload & {
  role?: unknown
  user_role?: unknown
  org_id?: unknown
  email?: unknown
  first_name?: unknown
  firstName?: unknown
  last_name?: unknown
  lastName?: unknown
  name?: unknown
}

function bearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice('Bearer '.length)
}

function appRole(value: unknown): WorkosAppRole | null {
  if (value === 'admin' || value === 'editor' || value === 'viewer') return value
  return null
}

function claimString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function joinNameParts(firstName: string | null, lastName: string | null): string | null {
  return [firstName, lastName].filter(Boolean).join(' ') || null
}

function workosClaimsName(claims: WorkosJwtClaims): {
  firstName: string | null
  lastName: string | null
  fullName: string | null
} {
  const firstName = claimString(claims.first_name) ?? claimString(claims.firstName)
  const lastName = claimString(claims.last_name) ?? claimString(claims.lastName)
  const fullName = claimString(claims.name) ?? joinNameParts(firstName, lastName)
  return { firstName, lastName, fullName }
}

async function verifyWorkosJwt(token: string): Promise<WorkosJwtClaims> {
  const clientId = Deno.env.get('WORKOS_CLIENT_ID')
  if (!clientId) {
    throw new Error('Missing WORKOS_CLIENT_ID')
  }

  const expectedIssuer = `https://api.workos.com/user_management/${clientId}`
  const jwks = createRemoteJWKSet(new URL(`https://api.workos.com/sso/jwks/${clientId}`))
  const { payload } = await jwtVerify(token, jwks, {
    issuer: expectedIssuer,
  })

  return payload as WorkosJwtClaims
}

function validateClaims(claims: WorkosJwtClaims, options: WorkosAuthOptions): WorkosIdentityAuthResult {
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    return { authenticated: false, error: 'Missing WorkOS sub' }
  }

  if (claims.role !== 'authenticated') {
    return { authenticated: false, error: 'Invalid WorkOS role' }
  }

  const role = appRole(claims.user_role)
  if (!role) {
    return { authenticated: false, error: 'Invalid WorkOS user_role' }
  }

  const claimName = workosClaimsName(claims)

  if (!claims.org_id && !options.allowMissingOrgId) {
    return { authenticated: false, error: 'Missing WorkOS org_id' }
  }

  if (!claims.org_id && options.allowMissingOrgId) {
    return {
      authenticated: true,
      identity: {
        workosUserId: claims.sub,
        workosOrgId: null,
        role,
        email: typeof claims.email === 'string' ? claims.email : null,
        firstName: claimName.firstName,
        lastName: claimName.lastName,
        fullName: claimName.fullName,
      },
    }
  }

  if (typeof claims.org_id !== 'string' || claims.org_id.length === 0) {
    return { authenticated: false, error: 'Invalid WorkOS org_id' }
  }

  return {
    authenticated: true,
    identity: {
      workosUserId: claims.sub,
      workosOrgId: claims.org_id,
      role,
      email: typeof claims.email === 'string' ? claims.email : null,
      firstName: claimName.firstName,
      lastName: claimName.lastName,
      fullName: claimName.fullName,
    },
  }
}

function createUserTokenSupabaseClient(token: string): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
}

export async function authenticateWorkosIdentity(
  req: Request,
  options: WorkosAuthOptions = {},
): Promise<WorkosIdentityAuthResult> {
  const token = bearerToken(req)
  if (!token) {
    return { authenticated: false, error: 'Missing Authorization header' }
  }

  let claims: WorkosJwtClaims
  try {
    claims = await verifyWorkosJwt(token)
  } catch {
    return { authenticated: false, error: 'Invalid WorkOS token' }
  }

  return validateClaims(claims, options)
}

export async function authenticateWorkosUser(
  req: Request,
  options: WorkosAuthOptions = {},
): Promise<WorkosAuthResult> {
  const identityAuth = await authenticateWorkosIdentity(req, options)
  if (!identityAuth.authenticated) return identityAuth
  if (!('identity' in identityAuth)) return identityAuth

  const { identity } = identityAuth
  if (!identity.workosOrgId) {
    return { authenticated: false, error: 'Missing WorkOS org_id' }
  }

  const token = bearerToken(req)
  if (!token) {
    return { authenticated: false, error: 'Missing Authorization header' }
  }

  const supabase = createUserTokenSupabaseClient(token)
  const { data, error } = await supabase
    .from('profiles')
    .select('id, org_id, role, email, organisations!inner(workos_org_id)')
    .eq('workos_user_id', identity.workosUserId)
    .eq('organisations.workos_org_id', identity.workosOrgId)
    .eq('membership_status', 'active')
    .is('deactivated_at', null)
    .maybeSingle()

  if (error || !data) {
    return { authenticated: false, error: 'No active WorkOS profile' }
  }

  const role = appRole(data.role)
  if (!role) {
    return { authenticated: false, error: 'Invalid local user role' }
  }

  return {
    authenticated: true,
    context: {
      workosUserId: identity.workosUserId,
      workosOrgId: identity.workosOrgId,
      profileId: data.id,
      orgId: data.org_id,
      role,
      email: data.email ?? null,
    },
  }
}
