import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function expectIncludes(filePath, snippet, message) {
  const content = readRepoFile(filePath)
  assert.match(content, new RegExp(escapeRegExp(snippet), 'm'), message)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('profiles updates stay self-only and cannot change role or org', () => {
  const filePath = 'supabase/migrations/20260331_profile_role_lockdown.sql'
  const content = readRepoFile(filePath)

  assert.match(content, /CREATE POLICY "profile_update_self" ON profiles/s)
  assert.match(content, /USING\s*\(\s*id = auth\.uid\(\)\s*\)/s)
  assert.match(content, /WITH CHECK\s*\(\s*id = auth\.uid\(\)\s*AND org_id = current_user_org_id\(\)\s*AND role = current_user_role\(\)\s*\)/s)
})

test('organisation and entity mutations remain admin-only', () => {
  const filePath = 'supabase/migrations/20260331_org_entity_admin_lockdown.sql'
  const content = readRepoFile(filePath)

  assert.match(content, /CREATE POLICY "org_update_admin" ON organisations/s)
  assert.match(content, /current_user_role\(\) = 'admin'/s)

  for (const policyName of ['entities_insert_admin', 'entities_update_admin', 'entities_delete_admin']) {
    assert.match(content, new RegExp(`CREATE POLICY "${policyName}" ON entities`, 's'))
  }
})

test('hedge policies, upload batches, and bank accounts require admin or editor writes', () => {
  const filePath = 'supabase/migrations/20260331_policy_upload_role_lockdown.sql'
  const content = readRepoFile(filePath)
  const roleGate = /current_user_role\(\) IN \('admin', 'editor'\)/s

  for (const policyName of ['hedge_policies_insert', 'hedge_policies_update', 'upload_batches_insert', 'upload_batches_update', 'bank_accounts_update']) {
    assert.match(content, new RegExp(`CREATE POLICY "${policyName}"`, 's'))
  }

  assert.match(content, roleGate)
  assert.match(content, /CREATE POLICY "bank_accounts_update"[\s\S]*WITH CHECK\s*\(\s*org_id = current_user_org_id\(\)\s*AND current_user_role\(\) IN \('admin', 'editor'\)\s*\)/s)
})

test('organisation creation stays onboarding-only and alerts writes remain admin/editor-only', () => {
  const filePath = 'supabase/migrations/20260331_org_alerts_lockdown.sql'
  const content = readRepoFile(filePath)

  assert.match(content, /CREATE POLICY "org_insert" ON organisations/s)
  assert.match(content, /NOT EXISTS\s*\(\s*SELECT 1\s*FROM profiles\s*WHERE id = auth\.uid\(\)\s*\)/s)
  assert.match(content, /CREATE POLICY "alerts_insert" ON alerts[\s\S]*current_user_role\(\) IN \('admin', 'editor'\)/s)
  assert.match(content, /CREATE POLICY "alerts_update" ON alerts[\s\S]*WITH CHECK[\s\S]*current_user_role\(\) IN \('admin', 'editor'\)/s)
})

test('atomic onboarding function exists with security definer hardening and authenticated execute grant', () => {
  const filePath = 'supabase/migrations/20260331_atomic_signup_onboarding.sql'
  const content = readRepoFile(filePath)

  assert.match(content, /CREATE OR REPLACE FUNCTION onboard_new_user\s*\(\s*p_org_name TEXT,\s*p_full_name TEXT\s*\)/s)
  assert.match(content, /SECURITY DEFINER/s)
  assert.match(content, /SET search_path = public, auth/s)
  assert.match(content, /INSERT INTO organisations/s)
  assert.match(content, /INSERT INTO profiles/s)
  assert.match(content, /INSERT INTO hedge_policies/s)
  assert.match(content, /GRANT EXECUTE ON FUNCTION onboard_new_user\(TEXT, TEXT\) TO authenticated;/s)
})

test('signUp flow uses the onboarding RPC instead of client-side tenant inserts', () => {
  const filePath = 'src/hooks/useAuth.tsx'
  const content = readRepoFile(filePath)

  assert.match(content, /supabase\.rpc\('onboard_new_user',\s*\{\s*p_org_name: orgName,\s*p_full_name: fullName,\s*\}\)/s)
  assert.doesNotMatch(content, /\.from\('organisations'\)\s*\.insert/s)
  assert.doesNotMatch(content, /\.from\('profiles'\)\s*\.insert/s)
  assert.doesNotMatch(content, /\.from\('hedge_policies'\)\s*\.insert/s)
})

test('MFA hook no longer reads auth tokens from localStorage', () => {
  const filePath = 'src/hooks/useMfa.ts'
  const content = readRepoFile(filePath)

  assert.doesNotMatch(content, /localStorage/s)
  assert.match(content, /supabase\.auth\.mfa\./s)
})

test('alert writes are disabled in the client for viewer roles', () => {
  const filePath = 'src/hooks/useAlerts.ts'
  const content = readRepoFile(filePath)

  assert.match(content, /const canWrite = user\?\.profile\?\.role === 'admin' \|\| user\?\.profile\?\.role === 'editor'/s)
  assert.match(content, /async function upsertAlert[\s\S]*?if \(!orgId \|\| !canWrite\) return/s)
  assert.match(content, /async function resolveAlert[\s\S]*?if \(!orgId \|\| !canWrite\) return/s)
  assert.match(content, /async function markRead[\s\S]*?if \(!canWrite\) return/s)
  assert.match(content, /async function markAllRead[\s\S]*?if \(!orgId \|\| !canWrite\) return/s)
  assert.match(content, /async function dismiss[\s\S]*?if \(!canWrite\) return/s)
  assert.match(content, /async function dismissAll[\s\S]*?if \(!orgId \|\| !canWrite\) return/s)
})

test('security test coverage points at the intended migration files', () => {
  expectIncludes('supabase/migrations/20260331_security_definer_search_path.sql', 'SET search_path = public, auth', 'search_path hardening migration should remain present')
  expectIncludes('supabase/migrations/20260331_org_entity_admin_lockdown.sql', 'entities_update_admin', 'entity lockdown migration should remain present')
})

test('idle timeout ignores wake activity after the session has already expired', () => {
  const filePath = 'src/components/ui/IdleTimeout.tsx'
  const content = readRepoFile(filePath)

  assert.match(content, /const elapsed = now - lastActivityRef\.current/s)
  assert.match(content, /if \(elapsed >= IDLE_LIMIT_MS\) return/s)
})
