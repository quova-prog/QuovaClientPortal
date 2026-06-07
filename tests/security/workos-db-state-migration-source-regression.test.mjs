import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const migrationsDir = path.join(repoRoot, 'supabase/migrations')

function readMigrationWithSuffix(suffix) {
  const fileName = readdirSync(migrationsDir).find((entry) => entry.endsWith(suffix))
  assert.ok(fileName, `expected a tracked migration ending in ${suffix}`)
  return readFileSync(path.join(migrationsDir, fileName), 'utf8')
}

test('WorkOS dashboard-applied phase SQL is reconciled into tracked migrations', () => {
  const expectedMigrations = [
    {
      suffix: '_workos_phase1_additive_schema.sql',
      marker: /ALTER TABLE public\.organisations\s+ADD COLUMN IF NOT EXISTS workos_org_id TEXT;/s,
    },
    {
      suffix: '_workos_phase3_provisioning_schema.sql',
      marker: /CREATE TABLE IF NOT EXISTS public\.workos_provisioning_locks/s,
    },
    {
      suffix: '_workos_phase4_db_rekey_cutover.sql',
      marker: /CREATE OR REPLACE FUNCTION public\.current_profile_id\(\)/s,
    },
  ]

  for (const { suffix, marker } of expectedMigrations) {
    const migration = readMigrationWithSuffix(suffix)
    assert.match(migration, /Dashboard-applied WorkOS SQL reconciled into migration history/)
    assert.match(migration, marker)
  }
})
