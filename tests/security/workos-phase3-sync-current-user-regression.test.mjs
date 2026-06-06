import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('sync-current-user verifies a WorkOS user token before service-role writes', () => {
  const fn = readRepoFile('supabase/functions/sync-current-user/index.ts')

  assert.match(fn, /authenticateWorkosIdentity\(req\)/s)
  assert.doesNotMatch(fn, /allowMissingOrgId:\s*true/s)
  assert.match(fn, /createAdminClient\(\)/s)
  assert.match(fn, /if \(!identityAuth\.authenticated\)/s)
})

test('sync-current-user binds the local org by WorkOS org_id', () => {
  const fn = readRepoFile('supabase/functions/sync-current-user/index.ts')

  assert.match(fn, /from\('organisations'\)/s)
  assert.match(fn, /select\('id, name, workos_org_id'\)/s)
  assert.match(fn, /eq\('workos_org_id',\s*identity\.workosOrgId\)/s)
  assert.match(fn, /Organization not provisioned/s)
})

test('sync-current-user rejects cross-org and deactivated local memberships', () => {
  const fn = readRepoFile('supabase/functions/sync-current-user/index.ts')

  assert.match(fn, /eq\('workos_user_id',\s*identity\.workosUserId\)/s)
  assert.match(fn, /neq\('org_id',\s*org\.id\)/s)
  assert.match(fn, /already linked to another organization/s)
  assert.match(fn, /existingProfile\.membership_status !== 'active' \|\| existingProfile\.deactivated_at/s)
  assert.match(fn, /Membership is deactivated/s)
})

test('sync-current-user inserts or refreshes the local profile from WorkOS claims', () => {
  const fn = readRepoFile('supabase/functions/sync-current-user/index.ts')

  assert.match(fn, /crypto\.randomUUID\(\)/s)
  assert.match(fn, /workos_user_id:\s*identity\.workosUserId/s)
  assert.match(fn, /org_id:\s*org\.id/s)
  assert.match(fn, /role:\s*identity\.role/s)
  assert.match(fn, /email:\s*identity\.email/s)
  assert.match(fn, /membership_status:\s*'active'/s)
  assert.match(fn, /return jsonResponse\(\{\s*ok:\s*true/s)
})

test('sync-current-user does not update an unchanged existing profile during login bootstrap', () => {
  const fn = readRepoFile('supabase/functions/sync-current-user/index.ts')

  assert.match(fn, /const nextEmail = identity\.email \?\? existingProfile\.email/s)
  assert.match(fn, /existingProfile\.role === identity\.role && existingProfile\.email === nextEmail/s)
  assert.match(fn, /profile_id:\s*existingProfile\.id/s)
  assert.match(fn, /org_id:\s*existingProfile\.org_id/s)
  assert.match(fn, /email:\s*nextEmail/s)
  assert.match(fn, /const \{ data: updatedProfile, error: updateError \} = await admin/s)
})
