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
  assert.match(helper, /eq\('workos_user_id',\s*claims\.sub\)/s)
  assert.match(helper, /eq\('organisations\.workos_org_id',\s*claims\.org_id\)/s)
  assert.match(helper, /eq\('membership_status',\s*'active'\)/s)
  assert.match(helper, /is\('deactivated_at',\s*null\)/s)
})

test('WorkOS Edge helper returns app auth context without mixing service-role auth', () => {
  const helper = readRepoFile('supabase/functions/_shared/workosAuth.ts')

  assert.match(helper, /export type WorkosUserAuthContext/s)
  assert.match(helper, /profileId:\s*string/s)
  assert.match(helper, /orgId:\s*string/s)
  assert.match(helper, /workosUserId:\s*string/s)
  assert.match(helper, /role:\s*'admin' \| 'editor' \| 'viewer'/s)
  assert.doesNotMatch(helper, /SUPABASE_SERVICE_ROLE_KEY/s)
  assert.doesNotMatch(helper, /authenticateServiceRole/s)
})
