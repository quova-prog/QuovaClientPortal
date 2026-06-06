#!/usr/bin/env node
import assert from 'node:assert/strict'

function requiredEnv(name) {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required`)
  }
  return value.trim()
}

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

function decodeJwt(token) {
  const parts = token.split('.')
  assert.equal(parts.length, 3, 'token must have three JWT parts')
  return {
    header: decodeJwtPart(parts[0]),
    payload: decodeJwtPart(parts[1]),
  }
}

const token = requiredEnv('WORKOS_PHASE0_ACCESS_TOKEN')
const clientId = requiredEnv('WORKOS_CLIENT_ID')
const expectedIssuer = `https://api.workos.com/user_management/${clientId}`
const expectedOrgId = process.env.WORKOS_PHASE0_EXPECTED_ORG_ID?.trim()

const { header, payload } = decodeJwt(token)
const now = Math.floor(Date.now() / 1000)

assert.equal(payload.iss, expectedIssuer, 'issuer must match WorkOS user-management issuer')
assert.equal(payload.role, 'authenticated', 'role must be the Supabase postgres role')
assert.equal(typeof payload.sub, 'string', 'sub must be a string')
assert.ok(payload.sub.startsWith('user_'), 'sub must look like a WorkOS user id')
assert.equal(typeof payload.org_id, 'string', 'normal app token must include org_id')
assert.ok(payload.org_id.startsWith('org_'), 'org_id must look like a WorkOS org id')
assert.equal(typeof payload.user_role, 'string', 'token must include user_role')
assert.ok(['admin', 'editor', 'viewer'].includes(payload.user_role), 'user_role must match Quova role enum')
assert.equal(typeof payload.sid, 'string', 'token must include sid')
assert.equal(typeof payload.exp, 'number', 'token must include numeric exp')
assert.ok(payload.exp > now, 'token must not be expired')

if (expectedOrgId) {
  assert.equal(payload.org_id, expectedOrgId, 'org_id must match expected staging org')
}

console.log(JSON.stringify({
  header_alg: header.alg,
  iss: payload.iss,
  sub: payload.sub,
  org_id: payload.org_id,
  role: payload.role,
  user_role: payload.user_role,
  sid: payload.sid,
  exp: payload.exp,
}, null, 2))
