import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

test('Onboarding: organization_profiles gains instruments_used (idempotent)', () => {
  const sql = read('supabase/migrations/20260604000008_onboarding_instruments_used.sql')
  assert.match(sql, /ALTER TABLE organization_profiles/s)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS instruments_used\s+TEXT\[\]/s)
})
