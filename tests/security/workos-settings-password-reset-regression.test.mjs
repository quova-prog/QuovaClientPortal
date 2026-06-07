import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('WorkOS config carries the hosted password reset URL for account settings', () => {
  const config = readRepoFile('src/lib/workosConfig.ts')

  assert.match(config, /passwordResetUrl:\s*string \| null/s)
  assert.match(config, /VITE_WORKOS_PASSWORD_RESET_URL/s)
  assert.match(config, /validateAppUrl\(rawPasswordResetUrl,\s*'VITE_WORKOS_PASSWORD_RESET_URL'\)/s)
})

test('Settings profile security button starts the correct password reset flow', () => {
  const settings = readRepoFile('src/pages/SettingsPage.tsx')

  assert.match(settings, /function handleChangePassword\(\)/s)
  assert.match(settings, /const resetUrl = config\.workos\.passwordResetUrl/s)
  assert.match(settings, /window\.location\.assign\(resetUrl\)/s)
  assert.match(settings, /window\.location\.assign\('\/forgot-password'\)/s)
  assert.match(settings, /onClick=\{handleChangePassword\}/s)
  assert.doesNotMatch(settings, /<button className="btn btn-ghost btn-sm">Change Password/s)
})
