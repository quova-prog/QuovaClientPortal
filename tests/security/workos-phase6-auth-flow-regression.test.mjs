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
  assert.match(auth, /authError:\s*AuthDiagnostic \| null/s)
  assert.match(auth, /async function describeFunctionError/s)
  assert.match(auth, /context instanceof Response/s)
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
  const guard = readRepoFile('src/lib/workosRedirectGuard.ts')

  assert.match(login, /loadRuntimeWorkosAuthConfig/s)
  assert.match(login, /config\.provider === 'workos'/s)
  assert.match(login, /beginWorkosAuthRedirect/s)
  assert.match(login, /continueWorkosRedirect/s)
  assert.match(login, /void signIn\([^)]*inviteToken/s)
  assert.match(login, /Redirecting to sign in/s)
  assert.match(signup, /loadRuntimeWorkosAuthConfig/s)
  assert.match(signup, /config\.provider === 'workos'/s)
  assert.match(signup, /beginWorkosAuthRedirect/s)
  assert.match(signup, /continueWorkosRedirect/s)
  assert.match(signup, /void signUp\([^)]*inviteToken/s)
  assert.match(signup, /Redirecting to sign up/s)
  assert.match(guard, /WORKOS_REDIRECT_GUARD_PREFIX/s)
  assert.match(guard, /WORKOS_REDIRECT_GUARD_TTL_MS/s)
  assert.match(guard, /sessionStorage\.setItem/s)
  assert.match(guard, /sessionStorage\.removeItem/s)
})

test('WorkOS invite tokens are detected separately from legacy Supabase UUID invites', () => {
  const helper = readRepoFile('src/lib/workosInvite.ts')
  const acceptInvite = readRepoFile('src/pages/AcceptInvitePage.tsx')
  const signup = readRepoFile('src/pages/SignupPage.tsx')
  const login = readRepoFile('src/pages/LoginPage.tsx')
  const auth = readRepoFile('src/hooks/useAuth.tsx')

  assert.match(helper, /export function readInviteParams/s)
  assert.match(helper, /WORKOS_INVITE_TOKEN_SESSION_KEY/s)
  assert.match(helper, /rememberWorkosInviteToken/s)
  assert.match(helper, /readRememberedWorkosInviteToken/s)
  assert.match(helper, /clearRememberedWorkosInviteToken/s)
  assert.match(helper, /legacyInviteId/s)
  assert.match(helper, /workosInviteToken/s)
  assert.match(helper, /UUID_RE/s)
  assert.match(acceptInvite, /config\.provider === 'workos'/s)
  assert.match(acceptInvite, /const invitationToken = inviteParams\.workosInviteToken/s)
  assert.match(acceptInvite, /rememberWorkosInviteToken\(invitationToken\)/s)
  assert.match(acceptInvite, /acceptInvite\(invitationToken\)/s)
  assert.match(acceptInvite, /legacyInviteId/s)
  assert.match(signup, /readRememberedWorkosInviteToken/s)
  assert.match(signup, /const inviteToken = inviteParams\.workosInviteToken \?\? rememberedInviteToken/s)
  assert.match(login, /readRememberedWorkosInviteToken/s)
  assert.match(login, /const inviteToken = inviteParams\.workosInviteToken \?\? rememberedInviteToken/s)
  assert.match(auth, /clearRememberedWorkosInviteToken\(\)/s)
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

test('WorkOS callback path completes AuthKit redirects without falling through to the app 404', () => {
  const app = readRepoFile('src/App.tsx')
  const callbackRoute = app.match(/function WorkosCallbackRoute\(\) \{[\s\S]*?\n\}\n\nfunction SmartRedirect/)?.[0] ?? ''

  assert.match(app, /function WorkosCallbackRoute/s)
  assert.match(app, /path="\/callback"/s)
  assert.match(callbackRoute, /if \(loading\) return <RouteSpinner \/>/s)
  assert.match(callbackRoute, /if \(workosProvisionRequired\) return <Navigate to="\/provision-org" replace \/>/s)
  assert.match(callbackRoute, /if \(user\) return <Navigate to="\/" replace \/>/s)
  assert.match(callbackRoute, /Sign-in could not be completed/s)
  assert.match(callbackRoute, /Diagnostic: \{diagnostic\}/s)
  assert.match(callbackRoute, /workos_callback_verifier_missing/s)
  assert.match(callbackRoute, /window\.sessionStorage\.removeItem\('workos:code-verifier'\)/s)
  assert.match(callbackRoute, /window\.location\.assign\('\/login\?retry=1'\)/s)
  assert.doesNotMatch(callbackRoute, /return <Navigate to="\/login" replace \/>/s)
})
