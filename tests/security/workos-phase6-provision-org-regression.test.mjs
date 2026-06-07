import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('only bounded pre-org WorkOS functions can accept missing org_id', () => {
  const fn = readRepoFile('supabase/functions/provision-org/index.ts')
  const acceptInvite = readRepoFile('supabase/functions/accept-workos-invite/index.ts')
  const resolver = readRepoFile('supabase/functions/resolve-workos-organization/index.ts')
  const sync = readRepoFile('supabase/functions/sync-current-user/index.ts')

  assert.match(fn, /authenticateWorkosIdentity\(req,\s*\{\s*allowMissingOrgId:\s*true\s*\}\)/s)
  assert.match(fn, /if \(identity\.workosOrgId\)/s)
  assert.match(fn, /Use sync-current-user for organization-scoped sessions/s)
  assert.match(acceptInvite, /authenticateWorkosIdentity\(req,\s*\{\s*allowMissingOrgId:\s*true\s*\}\)/s)
  assert.match(acceptInvite, /Invitation email does not match signed-in user/s)
  assert.match(resolver, /authenticateWorkosIdentity\(req,\s*\{\s*allowMissingOrgId:\s*true\s*\}\)/s)
  assert.match(resolver, /if \(identity\.workosOrgId\)/s)
  assert.match(resolver, /Use sync-current-user for organization-scoped sessions/s)
  assert.match(resolver, /listWorkosOrganizationMemberships\(\{\s*user_id:\s*identity\.workosUserId,?\s*\}\)/s)
  assert.match(resolver, /No active WorkOS organization memberships/s)
  assert.match(resolver, /Multiple organizations require selection/s)
  assert.match(resolver, /workos_org_id:\s*matchedOrg\.workos_org_id/s)
  assert.doesNotMatch(sync, /allowMissingOrgId:\s*true/s)
})

test('provision-org blocks duplicate profiles and rate-limits repeated provisioning attempts', () => {
  const fn = readRepoFile('supabase/functions/provision-org/index.ts')
  const sql = readRepoFile('docs/workos/phase3-provisioning-schema.sql')

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.workos_provisioning_locks/s)
  assert.match(sql, /ALTER TABLE public\.workos_provisioning_locks ENABLE ROW LEVEL SECURITY/s)
  assert.match(sql, /REVOKE ALL ON public\.workos_provisioning_locks FROM anon, authenticated/s)
  assert.match(fn, /\.from\('profiles'\)[\s\S]*\.eq\('workos_user_id',\s*identity\.workosUserId\)/s)
  assert.match(fn, /\.from\('workos_provisioning_locks'\)/s)
  assert.match(fn, /PROVISION_MAX_ATTEMPTS/s)
  assert.match(fn, /Provisioning rate limit exceeded/s)
  assert.match(fn, /Provisioning already in progress/s)
})

test('provision-org creates WorkOS org, membership, local tenant rows, and returns switch target', () => {
  const fn = readRepoFile('supabase/functions/provision-org/index.ts')
  const api = readRepoFile('supabase/functions/_shared/workosApi.ts')

  assert.match(api, /WORKOS_API_KEY/s)
  assert.match(api, /Authorization': `Bearer \$\{apiKey\}`/s)
  assert.match(fn, /createWorkosOrganization/s)
  assert.match(fn, /createWorkosOrganizationMembership/s)
  assert.match(fn, /const bankId = localOrgId/s)
  assert.match(fn, /\.from\('banks'\)[\s\S]*\.upsert/s)
  assert.match(fn, /\.from\('organisations'\)[\s\S]*\.upsert/s)
  assert.match(fn, /\.from\('organisations'\)[\s\S]*workos_org_id:\s*workosOrg\.id/s)
  assert.match(fn, /\.from\('profiles'\)[\s\S]*workos_user_id:\s*identity\.workosUserId/s)
  assert.match(fn, /workos_org_id:\s*workosOrg\.id/s)
})
