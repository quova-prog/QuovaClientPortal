import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function repoPath(relativePath) {
  return path.join(repoRoot, relativePath)
}

function readRepoFile(relativePath) {
  return readFileSync(repoPath(relativePath), 'utf8')
}

test('accept-workos-invite is a bounded pre-org invitation acceptance endpoint', () => {
  const fnPath = 'supabase/functions/accept-workos-invite/index.ts'
  assert.equal(existsSync(repoPath(fnPath)), true, 'accept-workos-invite function should exist')

  const fn = readRepoFile(fnPath)

  assert.match(fn, /authenticateWorkosIdentity\(req,\s*\{\s*allowMissingOrgId:\s*true\s*\}\)/s)
  assert.match(fn, /if \(identity\.workosOrgId\)[\s\S]*Use sync-current-user for organization-scoped sessions/s)
  assert.match(fn, /cleanInviteToken\(body\.invitation_token\)/s)
  assert.match(fn, /getWorkosUser\(identity\.workosUserId\)/s)
  assert.match(fn, /findWorkosInvitationByToken\(invitationToken\)/s)
  assert.match(fn, /Invitation email does not match signed-in user/s)
  assert.match(fn, /Organization not provisioned/s)
  assert.match(fn, /WorkOS user is already linked to another organization/s)
  assert.match(fn, /Email is already linked to another organization/s)
  assert.match(fn, /acceptWorkosInvitation\(invitation\.id\)/s)
  assert.match(fn, /membership_status:\s*'active'/s)
  assert.match(fn, /workos_org_id:\s*workosOrgId/s)
})

test('WorkOS API helper supports signed-in invitation redemption', () => {
  const api = readRepoFile('supabase/functions/_shared/workosApi.ts')

  assert.match(api, /export async function getWorkosUser\(userId: string\)/s)
  assert.match(api, /\/user_management\/users\/\$\{encodeURIComponent\(userId\)\}/s)
  assert.match(api, /export async function findWorkosInvitationByToken\(token: string\)/s)
  assert.match(api, /\/user_management\/invitations\/by_token\/\$\{encodeURIComponent\(token\)\}/s)
  assert.match(api, /export async function acceptWorkosInvitation\(invitationId: string\)/s)
  assert.match(api, /\/user_management\/invitations\/\$\{encodeURIComponent\(invitationId\)\}\/accept/s)
})
