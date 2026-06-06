export type WorkosAppRole = 'admin' | 'editor' | 'viewer'

export type ValidatedWorkosJwtClaims = {
  issuer: string
  workosUserId: string
  workosOrgId: string | null
  role: WorkosAppRole
  expiresAt: number
}

export type WorkosJwtClaimValidationOptions = {
  issuer: string
  nowSeconds?: number
  allowMissingOrgId?: boolean
}

export class WorkosClaimValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkosClaimValidationError'
  }
}

function decodeBase64UrlJson(value: string): Record<string, unknown> {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
    const decoded = atob(padded)
    const parsed = JSON.parse(decoded)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('payload is not an object')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new WorkosClaimValidationError('Invalid WorkOS JWT payload')
  }
}

function requiredString(claims: Record<string, unknown>, key: string): string {
  const value = claims[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new WorkosClaimValidationError(`Missing WorkOS ${key} claim`)
  }
  return value
}

function appRole(value: unknown): WorkosAppRole {
  if (value === 'admin' || value === 'editor' || value === 'viewer') {
    return value
  }
  throw new WorkosClaimValidationError('Invalid WorkOS user_role claim')
}

/**
 * Parses JWT claims for client-side routing/UX only. This does not verify the
 * token signature; Edge Functions must use JWKS verification before trusting it.
 */
export function parseUnsignedWorkosJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) {
    throw new WorkosClaimValidationError('Invalid WorkOS JWT format')
  }

  return decodeBase64UrlJson(parts[1])
}

export function validateWorkosJwtClaims(
  claims: Record<string, unknown>,
  options: WorkosJwtClaimValidationOptions,
): ValidatedWorkosJwtClaims {
  const issuer = requiredString(claims, 'iss')
  if (issuer !== options.issuer) {
    throw new WorkosClaimValidationError('Invalid WorkOS issuer claim')
  }

  const workosUserId = requiredString(claims, 'sub')
  const jwtRole = requiredString(claims, 'role')
  if (jwtRole !== 'authenticated') {
    throw new WorkosClaimValidationError('WorkOS role claim must be authenticated')
  }

  const role = appRole(claims.user_role)
  const exp = claims.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    throw new WorkosClaimValidationError('Missing WorkOS exp claim')
  }

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (exp <= nowSeconds) {
    throw new WorkosClaimValidationError('WorkOS token is expired')
  }

  const orgClaim = claims.org_id
  if (typeof orgClaim === 'string' && orgClaim.length > 0) {
    return { issuer, workosUserId, workosOrgId: orgClaim, role, expiresAt: exp }
  }

  if (!options.allowMissingOrgId) {
    throw new WorkosClaimValidationError('Missing WorkOS org_id claim')
  }

  return { issuer, workosUserId, workosOrgId: null, role, expiresAt: exp }
}
