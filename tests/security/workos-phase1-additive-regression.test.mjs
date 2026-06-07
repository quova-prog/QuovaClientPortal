import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const migrationsDir = path.join(process.cwd(), 'supabase/migrations')
const migrationFileName = readdirSync(migrationsDir).find((entry) =>
  entry.endsWith('_workos_phase1_additive_schema.sql'),
)
assert.ok(migrationFileName, 'expected a tracked WorkOS Phase 1 additive migration')
const sqlPath = path.join(migrationsDir, migrationFileName)

function sql() {
  return readFileSync(sqlPath, 'utf8')
}

function functionBody(content, functionName) {
  const match = content.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\(\\)[\\s\\S]*?\\$\\$;`, 's'))
  assert.ok(match, `${functionName} should be defined`)
  return match[0]
}

test('phase1 sql adds WorkOS bridge columns without forcing cutover', () => {
  const content = sql()

  assert.match(content, /ALTER TABLE public\.organisations\s+ADD COLUMN IF NOT EXISTS workos_org_id TEXT;/s)
  assert.match(content, /ALTER TABLE public\.profiles\s+ADD COLUMN IF NOT EXISTS workos_user_id TEXT;/s)
  assert.match(content, /ALTER TABLE public\.profiles\s+ADD COLUMN IF NOT EXISTS membership_status TEXT NOT NULL DEFAULT 'active';/s)
  assert.match(content, /ALTER TABLE public\.profiles\s+ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;/s)
  assert.match(content, /ALTER TABLE public\.support_users\s+ADD COLUMN IF NOT EXISTS workos_user_id TEXT;/s)
  assert.match(content, /CREATE UNIQUE INDEX IF NOT EXISTS idx_organisations_workos_org_id_unique/s)
  assert.match(content, /CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_workos_user_org_unique\s+ON public\.profiles\(workos_user_id, org_id\)/s)
  assert.doesNotMatch(content, /CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_workos_user_id_unique\s+ON public\.profiles\(workos_user_id\)/s)
  assert.doesNotMatch(content, /CREATE OR REPLACE FUNCTION current_user_org_id\(\)/s)
  assert.doesNotMatch(content, /DROP POLICY/s)
})

test('phase1 sql adds customer WorkOS helpers bound to both sub and org_id', () => {
  const content = sql()

  for (const fn of ['current_workos_profile_id', 'current_workos_org_id', 'current_workos_user_role']) {
    assert.match(content, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(\\)`, 's'))
  }
  assert.match(content, /p\.workos_user_id = auth\.jwt\(\)->>'sub'/s)
  assert.match(content, /o\.workos_org_id = auth\.jwt\(\)->>'org_id'/s)
  assert.match(content, /p\.membership_status = 'active'/s)
  assert.match(content, /p\.deactivated_at IS NULL/s)
})

test('phase1 sql keeps support identity separate from customer org matching', () => {
  const content = sql()
  const supportHelper = functionBody(content, 'current_workos_support_user_id')

  assert.match(content, /CREATE OR REPLACE FUNCTION public\.current_workos_support_user_id\(\)/s)
  assert.match(supportHelper, /su\.workos_user_id = auth\.jwt\(\)->>'sub'/s)
  assert.match(supportHelper, /su\.is_active = TRUE/s)
  assert.match(supportHelper, /auth\.jwt\(\)->>'org_id' = NULLIF\(current_setting\('app\.workos_internal_org_id', TRUE\), ''\)/s)
  assert.doesNotMatch(supportHelper, /organisations/s)
  assert.doesNotMatch(supportHelper, /workos_org_id/s)
})

test('phase1 sql adds trusted audit actor groundwork for service-role writes', () => {
  const content = sql()

  assert.match(content, /ALTER TABLE public\.audit_logs\s+ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'user';/s)
  assert.match(content, /ALTER TABLE public\.audit_logs\s+ADD COLUMN IF NOT EXISTS external_actor_id TEXT;/s)
  assert.match(content, /CREATE OR REPLACE FUNCTION public\.write_audit_log_as_actor\(/s)
  assert.match(content, /GRANT EXECUTE ON FUNCTION public\.write_audit_log_as_actor\(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB\)\s+TO service_role;/s)
  assert.match(content, /NULLIF\(current_setting\('app\.audit_actor_profile_id', TRUE\), ''\)/s)
  assert.match(content, /COALESCE\(NEW\.actor_type, 'user'\) IN \('system', 'workos_webhook'\)/s)
  assert.match(content, /NEW\.actor_type := 'user';/s)
  assert.match(content, /NEW\.external_actor_id := NULL;/s)
})
