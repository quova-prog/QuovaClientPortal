import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('WorkOS mode exposes provisioning state and keeps Supabase mode as the default', () => {
  const auth = readRepoFile('src/hooks/useAuth.tsx')

  assert.match(auth, /provider:\s*AuthProviderKind/s)
  assert.match(auth, /workosProvisionRequired:\s*boolean/s)
  assert.match(auth, /provisionOrg:\s*\(orgName: string\)/s)
  assert.match(auth, /acceptInvite:\s*\(inviteToken: string\)/s)
  assert.match(auth, /provider:\s*'supabase'/s)
  assert.match(auth, /provider:\s*'workos'/s)
  assert.match(auth, /organizationId:\s*authKitOrganizationId/s)
  assert.match(auth, /switchToOrganization:\s*authKitSwitchToOrganization/s)
})

test('WorkOS login and signup pages redirect through AuthKit instead of rendering password forms', () => {
  const login = readRepoFile('src/pages/LoginPage.tsx')
  const signup = readRepoFile('src/pages/SignupPage.tsx')

  assert.match(login, /loadRuntimeWorkosAuthConfig/s)
  assert.match(login, /config\.provider === 'workos'/s)
  assert.match(login, /void signIn\([^)]*inviteToken/s)
  assert.match(login, /Redirecting to sign in/s)
  assert.match(signup, /loadRuntimeWorkosAuthConfig/s)
  assert.match(signup, /config\.provider === 'workos'/s)
  assert.match(signup, /void signUp\([^)]*inviteToken/s)
  assert.match(signup, /Redirecting to sign up/s)
})

test('WorkOS invite tokens are detected separately from legacy Supabase UUID invites', () => {
  const helper = readRepoFile('src/lib/workosInvite.ts')
  const acceptInvite = readRepoFile('src/pages/AcceptInvitePage.tsx')

  assert.match(helper, /export function readInviteParams/s)
  assert.match(helper, /legacyInviteId/s)
  assert.match(helper, /workosInviteToken/s)
  assert.match(helper, /UUID_RE/s)
  assert.match(acceptInvite, /config\.provider === 'workos'/s)
  assert.match(acceptInvite, /const invitationToken = inviteParams\.workosInviteToken/s)
  assert.match(acceptInvite, /acceptInvite\(invitationToken\)/s)
  assert.match(acceptInvite, /legacyInviteId/s)
})

test('Protected routes send signed-in WorkOS users without org_id to provisioning', () => {
  const app = readRepoFile('src/App.tsx')
  const provisionPage = readRepoFile('src/pages/WorkosProvisionPage.tsx')

  assert.match(app, /workosProvisionRequired/s)
  assert.match(app, /<Navigate to="\/provision-org"/s)
  assert.match(app, /path="\/provision-org"/s)
  assert.match(provisionPage, /provisionOrg\(orgName\)/s)
  assert.match(provisionPage, /workosProvisionRequired/s)
})
