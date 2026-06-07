import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('WorkOS Edge helper verifies tokens cryptographically and checks issuer', () => {
  const helper = readRepoFile('supabase/functions/_shared/workosAuth.ts')

  assert.match(helper, /from 'https:\/\/esm\.sh\/jose@/s)
  assert.match(helper, /createRemoteJWKSet/s)
  assert.match(helper, /jwtVerify/s)
  assert.match(helper, /WORKOS_CLIENT_ID/s)
  assert.match(helper, /https:\/\/api\.workos\.com\/user_management\/\$\{clientId\}/s)
  assert.match(helper, /issuer:\s*expectedIssuer/s)
})

test('WorkOS Edge helper requires org_id except for explicit pre-org auth', () => {
  const helper = readRepoFile('supabase/functions/_shared/workosAuth.ts')

  assert.match(helper, /allowMissingOrgId\?:\s*boolean/s)
  assert.match(helper, /if \(!claims\.org_id && !options\.allowMissingOrgId\)/s)
  assert.match(helper, /Missing WorkOS org_id/s)
  assert.match(helper, /authenticated:\s*true,\s*identity:\s*\{/s)
  assert.match(helper, /workosOrgId:\s*null/s)
})

test('WorkOS Edge helper resolves active local profile by WorkOS sub and org_id', () => {
  const helper = readRepoFile('supabase/functions/_shared/workosAuth.ts')

  assert.match(helper, /from\('profiles'\)/s)
  assert.match(helper, /organisations!inner/s)
  assert.match(helper, /eq\('workos_user_id',\s*identity\.workosUserId\)/s)
  assert.match(helper, /eq\('organisations\.workos_org_id',\s*identity\.workosOrgId\)/s)
  assert.match(helper, /eq\('membership_status',\s*'active'\)/s)
  assert.match(helper, /is\('deactivated_at',\s*null\)/s)
})

test('WorkOS Edge helper returns app auth context without mixing service-role auth', () => {
  const helper = readRepoFile('supabase/functions/_shared/workosAuth.ts')

  assert.match(helper, /export type WorkosVerifiedIdentity/s)
  assert.match(helper, /export async function authenticateWorkosIdentity\(/s)
  assert.match(helper, /const identityAuth = await authenticateWorkosIdentity\(req, options\)/s)
  assert.match(helper, /export type WorkosUserAuthContext/s)
  assert.match(helper, /profileId:\s*string/s)
  assert.match(helper, /orgId:\s*string/s)
  assert.match(helper, /workosUserId:\s*string/s)
  assert.match(helper, /role:\s*'admin' \| 'editor' \| 'viewer'/s)
  assert.doesNotMatch(helper, /SUPABASE_SERVICE_ROLE_KEY/s)
  assert.doesNotMatch(helper, /authenticateServiceRole/s)
})

test('WorkOS Edge helper preserves user name claims for local profile bootstrap', () => {
  const helper = readRepoFile('supabase/functions/_shared/workosAuth.ts')

  assert.match(helper, /firstName:\s*string \| null/s)
  assert.match(helper, /lastName:\s*string \| null/s)
  assert.match(helper, /fullName:\s*string \| null/s)
  assert.match(helper, /first_name\?:\s*unknown/s)
  assert.match(helper, /firstName\?:\s*unknown/s)
  assert.match(helper, /last_name\?:\s*unknown/s)
  assert.match(helper, /lastName\?:\s*unknown/s)
  assert.match(helper, /name\?:\s*unknown/s)
  assert.match(helper, /workosClaimsName\(claims\)/s)
  assert.match(helper, /fullName:\s*claimName\.fullName/s)
})
