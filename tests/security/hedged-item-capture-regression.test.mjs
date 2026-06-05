import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

const SQL = 'supabase/migrations/20260605172821_hedged_item_capture.sql'

test('Hedged item capture: creates role-gated, org-scoped RPC', () => {
  const sql = read(SQL)

  assert.match(sql, /CREATE OR REPLACE FUNCTION record_hedged_item\(/s)
  assert.match(sql, /RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public/s)
  assert.match(sql, /current_user_role\(\) NOT IN \('admin', 'editor'\)/s)
  assert.match(sql, /FROM hedge_designations[\s\S]*WHERE id = p_designation_id AND org_id = v_org/s)
  assert.match(sql, /accounting_status IN \('dedesignated', 'disqualified'\)/s)
})

test('Hedged item capture: validates target shape, exposure ownership, and forecast amount', () => {
  const sql = read(SQL)

  assert.match(sql, /p_forecast_amount <= 0/s)
  assert.match(sql, /Forecast amount must be positive/s)
  assert.match(sql, /p_exposure_id IS NOT NULL[\s\S]*p_derived_source IS NOT NULL OR p_derived_ref IS NOT NULL/s)
  assert.match(sql, /Exactly one hedged item target is required/s)
  assert.match(sql, /FROM fx_exposures[\s\S]*WHERE id = p_exposure_id AND org_id = v_org/s)
  assert.match(sql, /Exposure % not found in caller organization/s)
})

test('Hedged item capture: inserts complete accounting evidence and grants only authenticated execution', () => {
  const sql = read(SQL)

  assert.match(sql, /INSERT INTO hedged_items \(/s)
  assert.match(sql, /org_id, designation_id, exposure_id,[\s\S]*derived_source, derived_ref,[\s\S]*forecast_window_start, forecast_window_end,[\s\S]*forecast_amount,[\s\S]*affects_earnings_on,[\s\S]*earnings_event_source,[\s\S]*lifecycle_settlement_date,[\s\S]*created_by/s)
  assert.match(sql, /auth\.uid\(\)/s)
  assert.match(sql, /RETURNING id INTO v_id/s)
  assert.match(sql, /REVOKE ALL ON FUNCTION record_hedged_item\([\s\S]*\)\s+FROM PUBLIC, anon/s)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION record_hedged_item\([\s\S]*\)\s+TO authenticated/s)
})
