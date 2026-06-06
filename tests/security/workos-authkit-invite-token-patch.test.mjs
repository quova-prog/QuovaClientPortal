import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('postinstall patches AuthKit callback exchange to forward remembered WorkOS invitation tokens', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'))
  const patchScript = readRepoFile('scripts/patch-authkit-invitation-token.mjs')
  const authkitMjs = readRepoFile('node_modules/@workos-inc/authkit-js/dist/index.mjs')
  const authkitCjs = readRepoFile('node_modules/@workos-inc/authkit-js/dist/index.js')

  assert.equal(packageJson.scripts.postinstall, 'node scripts/patch-authkit-invitation-token.mjs')
  assert.match(patchScript, /quova:workos-invitation-token/s)
  assert.match(patchScript, /invitation_token:\s*invitationToken/s)
  assert.match(authkitMjs, /const invitationToken = readQuovaWorkosInvitationToken\(\)/s)
  assert.match(authkitMjs, /invitation_token:\s*invitationToken/s)
  assert.match(authkitCjs, /const invitationToken = readQuovaWorkosInvitationToken\(\)/s)
  assert.match(authkitCjs, /invitation_token:\s*invitationToken/s)
})
