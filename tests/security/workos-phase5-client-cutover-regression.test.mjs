import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('WorkOS client mode registers AuthKit access tokens with the Supabase client', () => {
  const content = readRepoFile('src/hooks/useAuth.tsx')

  assert.match(content, /useAuth as useAuthKit/s)
  assert.match(content, /setSupabaseAccessTokenProvider/s)
  assert.match(content, /function WorkosAuthProvider/s)
  assert.match(content, /getAccessToken,[\s\S]*user:\s*authKitUser,[\s\S]*\}\s*=\s*useAuthKit\(\)/s)
  assert.match(content, /setSupabaseAccessTokenProvider\(\s*async \(\) => \{/s)
  assert.match(content, /return await getAccessToken\(\)/s)
  assert.match(content, /setDbClient\(supabase as DbClient\)/s)
})

test('WorkOS client mode syncs the verified WorkOS session before reading profile data', () => {
  const content = readRepoFile('src/hooks/useAuth.tsx')

  assert.match(content, /functions\.invoke\('sync-current-user'/s)
  assert.match(content, /Authorization:\s*`Bearer \$\{accessToken\}`/s)
  assert.match(content, /\.from\('profiles'\)[\s\S]*\.select\('\*'\)[\s\S]*\.eq\('id',\s*syncResult\.profile_id\)/s)
  assert.match(content, /\.from\('organisations'\)[\s\S]*\.eq\('id',\s*\(profile as Profile\)\.org_id\)/s)
  assert.match(content, /buildWorkosAuthUser\(authKitUser,\s*syncResult\)/s)
  assert.match(content, /id:\s*\(profile as Profile\)\.id/s)
  assert.match(content, /email:\s*authKitUser\.email/s)
})

test('WorkOS client mode routes sign-in, sign-up, and sign-out through AuthKit', () => {
  const content = readRepoFile('src/hooks/useAuth.tsx')

  assert.match(content, /const signIn = useCallback\(async \(email: string,[\s\S]*authKitSignIn\(\{[\s\S]*loginHint:/s)
  assert.match(content, /const signUp = useCallback\(async \(email: string,[\s\S]*authKitSignUp\(\{[\s\S]*loginHint:/s)
  assert.doesNotMatch(content, /authKitSignIn\(\{[\s\S]*invitationToken:/s)
  assert.doesNotMatch(content, /authKitSignUp\(\{[\s\S]*invitationToken:/s)
  assert.match(content, /const signOut = useCallback\(async \(\) => \{[\s\S]*authKitSignOut/s)
})

test('Supabase auth remains the default provider path until the WorkOS flag is flipped', () => {
  const content = readRepoFile('src/hooks/useAuth.tsx')

  assert.match(content, /loadRuntimeWorkosAuthConfig/s)
  assert.match(content, /if \(config\.provider === 'workos'\) return <WorkosAuthProvider>/s)
  assert.match(content, /return <SupabaseAuthProvider>/s)
  assert.match(content, /function SupabaseAuthProvider/s)
  assert.match(content, /supabase\.auth\.signInWithPassword/s)
  assert.match(content, /supabase\.rpc\('onboard_new_user'/s)
})
