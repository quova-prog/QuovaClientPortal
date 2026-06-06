import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('WorkOS team invites are admin-only and use organization-scoped WorkOS identity', () => {
  const fn = readRepoFile('supabase/functions/workos-team-invites/index.ts')

  assert.match(fn, /authenticateWorkosUser\(req\)/s)
  assert.match(fn, /auth\.context\.role !== 'admin'/s)
  assert.match(fn, /Forbidden: Admin access required/s)
  assert.match(fn, /workosOrgId/s)
  assert.match(fn, /workosUserId/s)
})

test('WorkOS team invites list, send, and revoke through the WorkOS Invitation API', () => {
  const fn = readRepoFile('supabase/functions/workos-team-invites/index.ts')

  assert.match(fn, /action:\s*'list' \| 'send' \| 'revoke'/s)
  assert.match(fn, /listWorkosInvitations/s)
  assert.match(fn, /sendWorkosInvitation/s)
  assert.match(fn, /revokeWorkosInvitation/s)
  assert.match(fn, /organization_id:\s*auth\.context\.workosOrgId/s)
  assert.match(fn, /role_slug:\s*role/s)
  assert.match(fn, /expires_in_days:\s*7/s)
  assert.match(fn, /inviter_user_id:\s*auth\.context\.workosUserId/s)
})

test('team member hook switches invite transport only in WorkOS mode', () => {
  const hook = readRepoFile('src/hooks/useTeamMembers.ts')

  assert.match(hook, /loadRuntimeWorkosAuthConfig/s)
  assert.match(hook, /const isWorkos = config\.provider === 'workos'/s)
  assert.match(hook, /workos-team-invites/s)
  assert.match(hook, /action:\s*'send'/s)
  assert.match(hook, /action:\s*'list'/s)
  assert.match(hook, /action:\s*'revoke'/s)
  assert.match(hook, /send-team-invite/s)
  assert.match(hook, /\.from\('invites'\)/s)
})
