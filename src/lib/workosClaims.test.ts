import { describe, expect, it } from 'vitest'
import {
  parseUnsignedWorkosJwtPayload,
  validateWorkosJwtClaims,
  WorkosClaimValidationError,
} from './workosClaims'

const ISSUER = 'https://api.workos.com/user_management/client_123'
const NOW = 1_780_000_000

function unsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')

  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`
}

function baseClaims(overrides: Record<string, unknown> = {}) {
  return {
    role: 'authenticated',
    user_role: 'admin',
    iss: ISSUER,
    sub: 'user_123',
    org_id: 'org_123',
    exp: NOW + 300,
    ...overrides,
  }
}

describe('unsigned WorkOS JWT parsing', () => {
  it('parses a JWT payload for client-side UX only', () => {
    const payload = parseUnsignedWorkosJwtPayload(unsignedJwt(baseClaims()))

    expect(payload.sub).toBe('user_123')
    expect(payload.org_id).toBe('org_123')
  })

  it('rejects malformed JWTs', () => {
    expect(() => parseUnsignedWorkosJwtPayload('not-a-jwt')).toThrow(WorkosClaimValidationError)
  })
})

describe('WorkOS claim validation', () => {
  it('requires normal customer tokens to include sub, authenticated role, app role, and org_id', () => {
    const claims = validateWorkosJwtClaims(baseClaims(), {
      issuer: ISSUER,
      nowSeconds: NOW,
    })

    expect(claims).toEqual({
      issuer: ISSUER,
      workosUserId: 'user_123',
      workosOrgId: 'org_123',
      role: 'admin',
      expiresAt: NOW + 300,
    })
  })

  it('rejects normal customer tokens without org_id', () => {
    expect(() =>
      validateWorkosJwtClaims(baseClaims({ org_id: undefined }), {
        issuer: ISSUER,
        nowSeconds: NOW,
      }),
    ).toThrow(/org_id/)
  })

  it('allows missing org_id only for the provision-org pre-org path', () => {
    const claims = validateWorkosJwtClaims(baseClaims({ org_id: undefined }), {
      issuer: ISSUER,
      nowSeconds: NOW,
      allowMissingOrgId: true,
    })

    expect(claims.workosUserId).toBe('user_123')
    expect(claims.workosOrgId).toBeNull()
  })

  it('rejects WorkOS membership roles outside the app enum', () => {
    expect(() =>
      validateWorkosJwtClaims(baseClaims({ user_role: 'owner' }), {
        issuer: ISSUER,
        nowSeconds: NOW,
      }),
    ).toThrow(/user_role/)
  })

  it('rejects expired or wrong-issuer tokens', () => {
    expect(() =>
      validateWorkosJwtClaims(baseClaims({ exp: NOW - 1 }), {
        issuer: ISSUER,
        nowSeconds: NOW,
      }),
    ).toThrow(/expired/)

    expect(() =>
      validateWorkosJwtClaims(baseClaims({ iss: 'https://api.workos.com/user_management/client_other' }), {
        issuer: ISSUER,
        nowSeconds: NOW,
      }),
    ).toThrow(/issuer/)
  })
})
