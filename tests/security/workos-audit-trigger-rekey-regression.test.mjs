import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260607020319_workos_rekey_audit_triggers.sql',
)

function sql() {
  return readFileSync(migrationPath, 'utf8')
}

function functionBody(content, functionName) {
  const match = content.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?\\n\\$\\$;`, 's'),
  )
  assert.ok(match, `${functionName} should be defined`)
  return match[0]
}

test('WorkOS audit field enforcement resolves actor through local profile identity', () => {
  const content = sql()
  const body = functionBody(content, 'enforce_audit_log_fields')

  assert.match(content, /CREATE OR REPLACE FUNCTION public\.current_jwt_uuid_sub\(\)/s)
  assert.match(body, /public\.current_profile_id\(\)/s)
  assert.match(body, /public\.current_jwt_uuid_sub\(\)/s)
  assert.match(body, /NULLIF\(current_setting\('app\.audit_actor_profile_id', TRUE\), ''\)::UUID/s)
  assert.doesNotMatch(body, /auth\.uid\(\)/s)
  assert.match(body, /FROM public\.profiles p\s+WHERE p\.id = v_actor_profile_id/s)
  assert.match(body, /FROM auth\.users au\s+WHERE au\.id = v_actor_profile_id/s)
})

test('WorkOS audit trigger classifies no-actor service writes without auth.uid', () => {
  const content = sql()
  const body = functionBody(content, 'audit_trigger_func')

  assert.match(body, /public\.current_profile_id\(\)/s)
  assert.match(body, /public\.current_jwt_uuid_sub\(\)/s)
  assert.doesNotMatch(body, /auth\.uid\(\)/s)
  assert.match(body, /v_actor_profile_id IS NULL/s)
  assert.match(body, /v_actor_type := 'system'/s)
  assert.match(body, /external_actor_id/s)
  assert.match(body, /actor_type/s)
})
