import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

const SQL = 'supabase/migrations/20260605172709_window_forward_designation_completion.sql'

test('Designation completion: creates a locked, role-gated completion RPC', () => {
  const sql = read(SQL)

  assert.match(sql, /CREATE OR REPLACE FUNCTION complete_hedge_designation\(/s)
  assert.match(sql, /RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public/s)
  assert.match(sql, /current_user_role\(\) NOT IN \('admin', 'editor'\)/s)
  assert.match(sql, /WHERE id = p_designation_id AND org_id = v_org/s)
  assert.match(sql, /accounting_status IN \('dedesignated', 'disqualified'\)/s)
})

test('Designation completion: requires complete inception documentation and a hedged item', () => {
  const sql = read(SQL)

  assert.match(sql, /NULLIF\(BTRIM\(p_inception_doc\), ''\)/s)
  assert.match(sql, /Inception documentation is required/s)
  assert.match(sql, /EXISTS \([\s\S]*FROM hedged_items[\s\S]*designation_id = p_designation_id[\s\S]*org_id = v_org/s)
  assert.match(sql, /At least one hedged item is required/s)
})

test('Designation completion: designates without weakening grants', () => {
  const sql = read(SQL)

  assert.match(sql, /accounting_status = 'designated'/s)
  assert.match(sql, /inception_doc_status = 'complete'/s)
  assert.match(sql, /designated_at = COALESCE\(designated_at, NOW\(\)\)/s)
  assert.match(sql, /REVOKE ALL ON FUNCTION complete_hedge_designation\(UUID, TEXT, TEXT\)\s+FROM PUBLIC, anon/s)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION complete_hedge_designation\(UUID, TEXT, TEXT\)\s+TO authenticated/s)
})
