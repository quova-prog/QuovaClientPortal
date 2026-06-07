import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const migrationsDir = path.join(repoRoot, 'supabase/migrations')
const migrationFileName = readdirSync(migrationsDir).find((entry) =>
  entry.endsWith('_workos_phase4_db_rekey_cutover.sql'),
)
assert.ok(migrationFileName, 'expected a tracked WorkOS Phase 4 DB re-key migration')
const sqlPath = path.join(migrationsDir, migrationFileName)
const safeSupportMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260606180329_workos_safe_support_admin_helpers.sql',
)

function sql() {
  return readFileSync(sqlPath, 'utf8')
}

function functionBody(content, functionName) {
  const match = content.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?\\n\\$\\$;`, 's'),
  )
  assert.ok(match, `${functionName} should be defined`)
  return match[0]
}

test('phase4 sql detaches local app identities from auth.users foreign keys', () => {
  const content = sql()

  const authUserConstraints = [
    ['public.profiles', 'profiles_id_fkey'],
    ['public.support_users', 'support_users_id_fkey'],
    ['public.notification_preferences', 'notification_preferences_user_id_fkey'],
    ['public.email_logs', 'email_logs_user_id_fkey'],
    ['public.support_access_grants', 'support_access_grants_user_id_fkey'],
    ['public.ai_usage_logs', 'ai_usage_logs_user_id_fkey'],
    ['public.invites', 'invites_invited_by_fkey'],
    ['public.onboarding_sessions', 'onboarding_sessions_created_by_fkey'],
    ['public.nudges', 'nudges_sent_by_fkey'],
    ['public.commodity_hedges', 'commodity_hedges_created_by_fkey'],
  ]

  for (const [table, constraint] of authUserConstraints) {
    assert.match(
      content,
      new RegExp(`ALTER TABLE IF EXISTS ${table}\\s+DROP CONSTRAINT IF EXISTS ${constraint};`, 's'),
      `${constraint} should be dropped from ${table}`,
    )
  }

  assert.match(content, /ALTER TABLE IF EXISTS public\.profiles\s+ALTER COLUMN id SET DEFAULT gen_random_uuid\(\);/s)
  assert.match(content, /ALTER TABLE IF EXISTS public\.support_users\s+ALTER COLUMN id SET DEFAULT gen_random_uuid\(\);/s)
  assert.match(content, /ADD CONSTRAINT notification_preferences_user_id_fkey\s+FOREIGN KEY \(user_id\) REFERENCES public\.profiles\(id\) ON DELETE CASCADE/s)
  assert.match(content, /ADD CONSTRAINT support_access_grants_user_id_fkey\s+FOREIGN KEY \(user_id\) REFERENCES public\.support_users\(id\) ON DELETE CASCADE/s)
})

test('phase4 sql rekeys canonical customer helpers to WorkOS sub plus selected org_id', () => {
  const content = sql()

  for (const fn of ['current_profile_id', 'current_user_org_id', 'current_user_role']) {
    const body = functionBody(content, fn)
    assert.match(body, /p\.workos_user_id = auth\.jwt\(\)->>'sub'/s)
    assert.match(body, /o\.workos_org_id = auth\.jwt\(\)->>'org_id'/s)
    assert.match(body, /p\.membership_status = 'active'/s)
    assert.match(body, /p\.deactivated_at IS NULL/s)
    assert.doesNotMatch(body, /auth\.uid\(\)/s)
    assert.doesNotMatch(body, /auth\.jwt\(\)->>'aal'/s)
  }
})

test('phase4 sql keeps support access scoped to internal WorkOS org and JIT grants', () => {
  const content = sql()

  for (const fn of [
    'is_support_user',
    'get_support_user_role',
    'has_support_access_to',
    'current_support_bank_id',
    'is_quova_platform_admin',
  ]) {
    const body = functionBody(content, fn)
    assert.match(body, /current_workos_support_user_id\(\)/s)
    assert.doesNotMatch(body, /auth\.uid\(\)/s)
    assert.doesNotMatch(body, /auth\.jwt\(\)->>'aal'/s)
  }

  const supportIdentity = functionBody(content, 'current_workos_support_user_id')
  assert.match(supportIdentity, /su\.workos_user_id = auth\.jwt\(\)->>'sub'/s)
  assert.match(supportIdentity, /auth\.jwt\(\)->>'org_id' = NULLIF\(current_setting\('app\.workos_internal_org_id', TRUE\), ''\)/s)
  assert.doesNotMatch(supportIdentity, /organisations/s)
  assert.doesNotMatch(supportIdentity, /workos_org_id/s)
})

test('phase4 sql replaces direct auth.uid profile and preference policies', () => {
  const content = sql()

  assert.match(content, /CREATE POLICY "profile_select_self" ON public\.profiles[\s\S]*USING \(id = public\.current_profile_id\(\)\)/s)
  assert.match(content, /CREATE POLICY "profile_update_self" ON public\.profiles[\s\S]*USING \(id = public\.current_profile_id\(\)\)[\s\S]*WITH CHECK \([\s\S]*id = public\.current_profile_id\(\)[\s\S]*org_id = public\.current_user_org_id\(\)[\s\S]*role = public\.current_user_role\(\)/s)
  assert.match(content, /CREATE POLICY "notif_prefs_select" ON public\.notification_preferences[\s\S]*USING \(user_id = public\.current_profile_id\(\)\)/s)
  assert.match(content, /CREATE POLICY "notif_prefs_insert" ON public\.notification_preferences[\s\S]*WITH CHECK \([\s\S]*user_id = public\.current_profile_id\(\)[\s\S]*org_id = public\.current_user_org_id\(\)/s)
  assert.match(content, /CREATE POLICY "notif_prefs_update" ON public\.notification_preferences[\s\S]*USING \([\s\S]*user_id = public\.current_profile_id\(\)[\s\S]*org_id = public\.current_user_org_id\(\)[\s\S]*\)[\s\S]*WITH CHECK \([\s\S]*user_id = public\.current_profile_id\(\)[\s\S]*org_id = public\.current_user_org_id\(\)/s)
})

test('phase4 sql rekeys user-bound RPCs away from Supabase Auth UUIDs', () => {
  const content = sql()

  for (const fn of ['write_audit_log', 'check_and_log_ai_usage', 'update_member_role', 'remove_member']) {
    const body = functionBody(content, fn)
    assert.match(body, /current_profile_id\(\)/s, `${fn} should bind to the local WorkOS profile`)
    assert.doesNotMatch(body, /auth\.uid\(\)/s, `${fn} should not use Supabase Auth user IDs`)
  }

  assert.match(content, /DROP FUNCTION IF EXISTS public\.accept_invite\(UUID\);/s)
  assert.match(content, /DROP FUNCTION IF EXISTS public\.onboard_new_user\(TEXT, TEXT\);/s)
})

test('phase4 sql removes Supabase AAL2 assumptions from WorkOS cutover surface', () => {
  const content = sql()

  assert.doesNotMatch(content, /aal2/s)
  assert.doesNotMatch(content, /auth\.jwt\(\)->>'aal'/s)
})

test('safe support admin bridge migration does not cast WorkOS customer subs through auth.uid', () => {
  const content = readFileSync(safeSupportMigrationPath, 'utf8')

  assert.match(content, /CREATE OR REPLACE FUNCTION public\.current_jwt_uuid_sub\(\)/s)
  assert.doesNotMatch(content, /auth\.uid\(\)/s)

  for (const fn of ['current_support_bank_id', 'is_quova_platform_admin']) {
    const body = functionBody(content, fn)
    assert.match(body, /current_workos_support_user_id\(\)/s)
    assert.match(body, /current_jwt_uuid_sub\(\)/s)
  }

  assert.match(content, /auth\.jwt\(\)->>'aal' = 'aal2'/s)
})
