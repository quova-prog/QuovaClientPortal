import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function repoPath(relativePath) {
  return path.join(repoRoot, relativePath)
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

test('WorkOS login and signup pages launch AuthKit once and surface redirect errors', () => {
  const login = readRepoFile('src/pages/LoginPage.tsx')
  const signup = readRepoFile('src/pages/SignupPage.tsx')

  assert.match(login, /loadRuntimeWorkosAuthConfig/s)
  assert.match(login, /config\.provider === 'workos'/s)
  assert.match(login, /const result = await signIn\('', '', inviteToken\)/s)
  assert.match(login, /if \(!cancelled && result\.error\) setError\(result\.error\)/s)
  assert.match(login, /Redirecting to sign in/s)
  assert.doesNotMatch(login, /beginWorkosAuthRedirect|continueWorkosRedirect|workosRedirectPaused/s)
  assert.match(signup, /loadRuntimeWorkosAuthConfig/s)
  assert.match(signup, /config\.provider === 'workos'/s)
  assert.match(signup, /const result = await signUp\('', '', '', '', inviteToken \?\? null\)/s)
  assert.match(signup, /if \(!cancelled && result\.error\) setError\(result\.error\)/s)
  assert.match(signup, /Redirecting to sign up/s)
  assert.doesNotMatch(signup, /beginWorkosAuthRedirect|continueWorkosRedirect|workosRedirectPaused|startWorkosAuthRedirect/s)
  assert.equal(existsSync(repoPath('src/lib/workosRedirectGuard.ts')), false, 'redirect guard should not exist')
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
  assert.match(signup, /const inviteToken = inviteParams\.workosInviteToken/s)
  assert.match(signup, /rememberWorkosInviteToken\(inviteToken\)/s)
  assert.match(signup, /clearRememberedWorkosInviteToken\(\)/s)
  assert.match(signup, /signUp\('', '', '', '', inviteToken \?\? null\)/s)
  assert.doesNotMatch(signup, /readRememberedWorkosInviteToken|workosSignupInviteToken/s)
  assert.doesNotMatch(login, /readRememberedWorkosInviteToken/s)
  assert.match(login, /const inviteToken = inviteParams\.workosInviteToken/s)
  assert.match(login, /rememberWorkosInviteToken\(inviteToken\)/s)
  assert.match(login, /clearRememberedWorkosInviteToken\(\)/s)
  assert.match(auth, /clearRememberedWorkosInviteToken\(\)/s)
  assert.doesNotMatch(auth, /readRememberedWorkosInviteToken/s)
  assert.doesNotMatch(auth, /functions\.invoke\('accept-workos-invite'/s)
  assert.match(auth, /await authKitSignUp\(options\)/s)
  assert.doesNotMatch(auth, /const acceptInvite = useCallback\(async \(inviteToken: string\)[\s\S]*await authKitSignIn\(options\)/s)
})

test('WorkOS auth endpoints preserve hosted authorization sessions before starting new PKCE redirects', () => {
  const helperPath = 'src/lib/workosAuthorizationSession.ts'
  assert.equal(existsSync(repoPath(helperPath)), true, 'authorization-session helper should exist')

  const helper = readRepoFile(helperPath)
  const login = readRepoFile('src/pages/LoginPage.tsx')
  const signup = readRepoFile('src/pages/SignupPage.tsx')

  assert.match(helper, /export function readWorkosAuthorizationSessionId/s)
  assert.match(helper, /authorization_session_id/s)
  assert.match(helper, /WORKOS_AUTHORIZATION_SESSION_ID_RE/s)
  assert.match(helper, /export function buildWorkosAuthorizationSessionUrl/s)
  assert.match(helper, /config\.workos\.apiHostname/s)
  assert.match(helper, /config\.workos\.clientId/s)
  assert.match(helper, /config\.workos\.redirectUri/s)
  assert.match(helper, /response_type/s)

  for (const [name, file] of [['login', login], ['signup', signup]]) {
    assert.match(file, /readWorkosAuthorizationSessionId/s, `${name} should read WorkOS authorization sessions`)
    assert.match(file, /buildWorkosAuthorizationSessionUrl/s, `${name} should build a hosted-session continuation URL`)
    assert.match(file, /window\.location\.assign\(authorizationSessionUrl\)/s, `${name} should return to the hosted session`)

    const sessionIndex = file.indexOf('if (authorizationSessionUrl)')
    const authLaunchIndex = file.indexOf(name === 'login'
      ? "const result = await signIn('', '', inviteToken)"
      : "const result = await signUp('', '', '', '', inviteToken ?? null)")
    assert.ok(sessionIndex >= 0, `${name} should evaluate authorization_session_id`)
    assert.ok(authLaunchIndex >= 0, `${name} should still start a fresh AuthKit redirect`)
    assert.ok(sessionIndex < authLaunchIndex, `${name} must preserve WorkOS sessions before starting a fresh PKCE redirect`)
  }
})

test('WorkOS no-org sessions resolve existing memberships before provisioning', () => {
  const auth = readRepoFile('src/hooks/useAuth.tsx')

  assert.doesNotMatch(auth, /readRememberedWorkosInviteToken/s)
  assert.doesNotMatch(auth, /functions\.invoke\('accept-workos-invite'/s)
  assert.match(auth, /functions\.invoke\('resolve-workos-organization'/s)
  assert.match(auth, /const resolveResult = data as \(ResolveWorkosOrganizationResult & \{ error\?: string \}\) \| null/s)
  assert.match(auth, /if \(resolveResult\?\.ok && resolveResult\.workos_org_id\)/s)
  assert.match(auth, /await authKitSwitchToOrganization\(\{\s*organizationId:\s*resolveResult\.workos_org_id\s*\}\)/s)
  assert.match(auth, /resolveResult\?\.reason !== 'no_membership'/s)
  assert.match(auth, /setWorkosProvisionRequired\(true\)/s)
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
