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
  const api = readRepoFile('supabase/functions/_shared/workosApi.ts')

  assert.match(fn, /action:\s*'list' \| 'send' \| 'revoke'/s)
  assert.match(fn, /listWorkosInvitations/s)
  assert.match(fn, /sendWorkosInvitation/s)
  assert.match(fn, /revokeWorkosInvitation/s)
  assert.match(fn, /organization_id:\s*auth\.context\.workosOrgId/s)
  assert.match(fn, /role_slug:\s*role/s)
  assert.match(fn, /expires_in_days:\s*7/s)
  assert.match(fn, /inviter_user_id:\s*auth\.context\.workosUserId/s)
  assert.match(fn, /\.filter\(invite => invitationState\(invite\) === 'pending'\)/s)
  assert.match(fn, /catch \(error\)[\s\S]*workos-team-invites action failed/s)
  assert.match(fn, /jsonResponse\(\{ error: actionErrorMessage\(error\) \}, 502, req\)/s)
  assert.match(api, /typeof body\.error === 'string'/s)
  assert.match(api, /typeof body\.error_description === 'string'/s)
})

test('team member hook switches invite transport only in WorkOS mode', () => {
  const hook = readRepoFile('src/hooks/useTeamMembers.ts')

  assert.match(hook, /loadRuntimeWorkosAuthConfig/s)
  assert.match(hook, /const isWorkos = config\.provider === 'workos'/s)
  assert.match(hook, /workos-team-invites/s)
  assert.match(hook, /\.eq\('membership_status', 'active'\)/s)
  assert.match(hook, /\.is\('deactivated_at', null\)/s)
  assert.match(hook, /action:\s*'send'/s)
  assert.match(hook, /action:\s*'list'/s)
  assert.match(hook, /action:\s*'revoke'/s)
  assert.match(hook, /describeFunctionError/s)
  assert.match(hook, /context instanceof Response/s)
  assert.match(hook, /activeMemberEmails/s)
  assert.match(hook, /\.filter\(invite => !activeMemberEmails\.has\(invite\.email\.trim\(\)\.toLowerCase\(\)\)\)/s)
  assert.match(hook, /send-team-invite/s)
  assert.match(hook, /\.from\('invites'\)/s)
})

test('WorkOS team lifecycle updates active memberships through WorkOS before local cache changes', () => {
  const fn = readRepoFile('supabase/functions/workos-team-invites/index.ts')
  const api = readRepoFile('supabase/functions/_shared/workosApi.ts')

  assert.match(fn, /action:\s*'list' \| 'send' \| 'revoke' \| 'update_role' \| 'remove_member'/s)
  assert.match(fn, /listWorkosOrganizationMemberships/s)
  assert.match(fn, /updateWorkosOrganizationMembershipRole/s)
  assert.match(fn, /deactivateWorkosOrganizationMembership/s)
  assert.match(fn, /workos_user_id/s)
  assert.match(fn, /Cannot remove yourself from the organization/s)
  assert.match(fn, /Cannot remove the last admin/s)
  assert.match(fn, /Cannot demote the last admin/s)
  assert.match(fn, /\.not\('workos_user_id', 'is', null\)/s)
  assert.match(fn, /membership_status:\s*'deactivated'/s)
  assert.match(fn, /deactivated_at:\s*new Date\(\)\.toISOString\(\)/s)
  assert.match(api, /\/user_management\/organization_memberships\?\$\{params\.toString\(\)\}/s)
  assert.match(api, /\/user_management\/organization_memberships\/\$\{encodeURIComponent\(membershipId\)\}/s)
  assert.match(api, /\/user_management\/organization_memberships\/\$\{encodeURIComponent\(membershipId\)\}\/deactivate/s)
})

test('team member hook routes role changes and removals through WorkOS in WorkOS mode', () => {
  const hook = readRepoFile('src/hooks/useTeamMembers.ts')

  assert.match(hook, /body:\s*\{\s*action:\s*'update_role',\s*profile_id:\s*targetUserId,\s*role:\s*newRole\s*\}/s)
  assert.match(hook, /body:\s*\{\s*action:\s*'remove_member',\s*profile_id:\s*targetUserId\s*\}/s)
  assert.match(hook, /db\.rpc\('update_member_role'/s)
  assert.match(hook, /db\.rpc\('remove_member'/s)
})

test('WorkOS settings mode does not expose Supabase MFA or org deletion controls', () => {
  const settings = readRepoFile('src/pages/SettingsPage.tsx')

  assert.match(settings, /loadRuntimeWorkosAuthConfig/s)
  assert.match(settings, /const isWorkos = config\.provider === 'workos'/s)
  assert.match(settings, /if \(tab === 'security' && !isWorkos\)/s)
  assert.match(settings, /Authentication is managed by WorkOS/s)
  assert.match(settings, /WorkOS manages MFA, password reset, and active sessions/s)
  assert.match(settings, /isAdmin && !isWorkos/s)
  assert.match(settings, /handleRevokeInvite/s)
  assert.match(settings, /revokingInviteId === inv\.id/s)
})
