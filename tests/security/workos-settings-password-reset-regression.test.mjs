import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('WorkOS API helper can create a password reset through the supported API', () => {
  const api = readRepoFile('supabase/functions/_shared/workosApi.ts')

  assert.match(api, /export type WorkosPasswordReset/s)
  assert.match(api, /createWorkosPasswordReset/s)
  assert.match(api, /\/user_management\/password_reset/s)
  assert.match(api, /body:\s*JSON\.stringify\(\{\s*email:\s*input\.email\s*\}\)/s)
  assert.match(api, /unwrap<WorkosPasswordReset>\(body,\s*'password_reset'\)/s)
})

test('WorkOS password reset Edge Function creates resets only for the authenticated user', () => {
  const fn = readRepoFile('supabase/functions/workos-password-reset/index.ts')

  assert.match(fn, /authenticateWorkosUser\(req\)/s)
  assert.match(fn, /createWorkosPasswordReset\(\{\s*email\s*\}\)/s)
  assert.match(fn, /password_reset_url:\s*resetUrl/s)
  assert.match(fn, /jsonResponse\(\{\s*ok:\s*true/s)
  assert.doesNotMatch(fn, /req\.json\(\)/s)
  assert.doesNotMatch(fn, /body\.email/s)
})

test('Settings profile security button starts the correct password reset flow', () => {
  const settings = readRepoFile('src/pages/SettingsPage.tsx')

  assert.match(settings, /function handleChangePassword\(\)/s)
  assert.match(settings, /functions\.invoke\('workos-password-reset'/s)
  assert.match(settings, /const resetUrl = data\?\.password_reset_url/s)
  assert.match(settings, /window\.location\.assign\(resetUrl\)/s)
  assert.match(settings, /window\.location\.assign\('\/forgot-password'\)/s)
  assert.match(settings, /onClick=\{handleChangePassword\}/s)
  assert.doesNotMatch(settings, /config\.workos\.passwordResetUrl/s)
  assert.doesNotMatch(settings, /<button className="btn btn-ghost btn-sm">Change Password/s)
})
