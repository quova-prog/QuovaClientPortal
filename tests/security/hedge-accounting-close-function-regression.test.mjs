import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

const EDGE = 'supabase/functions/close-accounting-period/index.ts'

test('Close accounting period Edge Function: requires AAL2 user auth and admin role', () => {
  const ts = read(EDGE)

  assert.match(ts, /authenticateRequest\(req\)/s)
  assert.match(ts, /auth\.isServiceRole/s)
  assert.match(ts, /Service-role calls not permitted/s)
  assert.match(ts, /from\('profiles'\)[\s\S]*select\('org_id, role'\)[\s\S]*eq\('id', auth\.user\.id\)/s)
  assert.match(ts, /profile\?\.role !== 'admin'/s)
  assert.match(ts, /Forbidden: Admin role required/s)
})

test('Close accounting period Edge Function: builds server-side close repository and rejects raw client journal plans', () => {
  const ts = read(EDGE)

  assert.match(ts, /createSupabaseCloseAccountingRepository/s)
  assert.match(ts, /closeAccountingPeriod\(repository, period\)/s)
  assert.match(ts, /inputsByDesignationId/s)
  assert.doesNotMatch(ts, /body\.calls/s)
  assert.doesNotMatch(ts, /for\s*\([^)]*body\.calls/s)
})

test('Close accounting period Edge Function: validates method and period before writes', () => {
  const ts = read(EDGE)

  assert.match(ts, /req\.method !== 'POST'/s)
  assert.match(ts, /\^\[0-9\]\{4\}-\[0-9\]\{2\}\$/s)
  assert.match(ts, /Invalid accounting period/s)
})
