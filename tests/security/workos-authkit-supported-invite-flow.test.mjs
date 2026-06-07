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

test('WorkOS invite handling uses default AuthKit invitation flow without token replay', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'))
  const auth = readRepoFile('src/hooks/useAuth.tsx')
  const acceptPage = readRepoFile('src/pages/AcceptInvitePage.tsx')

  assert.notEqual(packageJson.scripts?.postinstall, 'node scripts/patch-authkit-invitation-token.mjs')
  assert.equal(existsSync(repoPath('scripts/patch-authkit-invitation-token.mjs')), false)
  assert.match(acceptPage, /WorkOS invitations must be accepted from the AuthKit invitation email/s)
  assert.doesNotMatch(acceptPage, /rememberWorkosInviteToken|acceptInvite\(invitationToken\)/s)
  assert.doesNotMatch(auth, /readRememberedWorkosInviteToken/s)
  assert.doesNotMatch(auth, /functions\.invoke\('accept-workos-invite'/s)
  assert.doesNotMatch(auth, /authKitSignIn\(\{[\s\S]*invitationToken:/s)
  assert.doesNotMatch(auth, /authKitSignUp\(\{[\s\S]*invitationToken:/s)
})
