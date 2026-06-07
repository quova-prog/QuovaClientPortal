import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260607013423_workos_profile_sync_service_bootstrap.sql',
)

function sql() {
  return readFileSync(migrationPath, 'utf8')
}

test('WorkOS profile sync bootstrap detaches profile ids from Supabase Auth users', () => {
  const content = sql()

  assert.match(content, /ALTER TABLE IF EXISTS public\.profiles\s+DROP CONSTRAINT IF EXISTS profiles_id_fkey;/s)
  assert.match(content, /ALTER TABLE IF EXISTS public\.profiles\s+ALTER COLUMN id SET DEFAULT gen_random_uuid\(\);/s)
})

test('WorkOS profile sync bootstrap records service-role audit rows as system events', () => {
  const content = sql()

  assert.match(content, /ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'user'/s)
  assert.match(content, /ADD COLUMN IF NOT EXISTS external_actor_id TEXT/s)
  assert.match(content, /CREATE OR REPLACE FUNCTION public\.enforce_audit_log_fields\(\)/s)
  assert.match(content, /COALESCE\(NEW\.actor_type, 'user'\) IN \('system', 'workos_webhook'\)/s)
  assert.match(content, /NEW\.user_id := NULL/s)
  assert.match(content, /CREATE TRIGGER trg_audit_logs_enforce_fields[\s\S]*EXECUTE FUNCTION public\.enforce_audit_log_fields\(\)/s)
  assert.match(content, /CREATE OR REPLACE FUNCTION public\.audit_trigger_func\(\)/s)
  assert.match(content, /IF auth\.uid\(\) IS NULL\s+AND NULLIF\(current_setting\('app\.audit_actor_profile_id', TRUE\), ''\) IS NULL THEN/s)
  assert.match(content, /v_actor_type := 'system'/s)
  assert.match(content, /'service_role:' \|\| v_resource/s)
  assert.match(content, /actor_type,\s+external_actor_id/s)
})
