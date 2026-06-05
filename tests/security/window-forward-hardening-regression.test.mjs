import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

const SQL = 'supabase/migrations/20260605000001_window_forward_hardening.sql'

test('Hardening migration: expired-window settlement is service-role only', () => {
  const sql = read(SQL)

  assert.match(sql, /CREATE OR REPLACE FUNCTION settle_expired_windows\(\)/s)
  assert.match(sql, /auth\.role\(\) <> 'service_role'/s)
  assert.match(sql, /REVOKE ALL ON FUNCTION settle_expired_windows\(\)[\s\S]*FROM PUBLIC, anon, authenticated/s)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION settle_expired_windows\(\) TO service_role/s)
})

test('Hardening migration: booking is tier-gated and entity-aware', () => {
  const sql = read(SQL)

  assert.match(sql, /CREATE OR REPLACE FUNCTION book_window_forward\([\s\S]*p_entity_id\s+UUID DEFAULT NULL/s)
  assert.match(sql, /SELECT plan INTO v_plan FROM organisations WHERE id = v_org/s)
  assert.match(sql, /v_plan NOT IN \('pro', 'enterprise'\)/s)
  assert.match(sql, /FROM entities WHERE id = p_entity_id AND org_id = v_org AND is_active = TRUE/s)
  assert.match(sql, /INSERT INTO hedge_positions \([\s\S]*org_id, entity_id, created_by/s)
  assert.match(sql, /validate_window_forward\([\s\S]*p_entity_id/s)
})

test('Hardening migration: policy lookup prefers entity policy before org fallback', () => {
  const sql = read(SQL)

  assert.match(sql, /AND \(entity_id = p_entity_id OR entity_id IS NULL\)/s)
  assert.match(sql, /ORDER BY CASE WHEN entity_id = p_entity_id THEN 0 ELSE 1 END/s)
  assert.match(sql, /v_policy\.id IS NULL/s)
})

test('Hardening migration: draw allocations are fully validated before settlement', () => {
  const sql = read(SQL)

  assert.match(sql, /Allocation amount must be positive/s)
  assert.match(sql, /Allocation total % exceeds draw amount %/s)
  assert.match(sql, /Allocated exposure % is not in the caller organization/s)
  assert.match(sql, /Allocated exposure pair % does not match position pair %/s)
  assert.match(sql, /Allocated exposure direction % is incompatible with % hedge/s)
  assert.match(sql, /Allocation % exceeds exposure remaining %/s)
  assert.match(sql, /Derived allocation requires derived_source and derived_ref/s)
})

test('Hardening migration: normal draw RPC cannot bypass window/business-day checks as final', () => {
  const sql = read(SQL)
  const drawBody = sql.split('CREATE OR REPLACE FUNCTION record_window_draw')[1].split('END $$;')[0]

  assert.match(drawBody, /p_draw_date < v_pos\.window_start_date OR p_draw_date > v_pos\.window_end_date/s)
  assert.match(drawBody, /EXTRACT\(DOW FROM p_draw_date\) IN \(0, 6\)/s)
  assert.doesNotMatch(drawBody, /IF NOT p_is_final[\s\S]*outside the window/s)
})

test('Hardening migration: allocated draws reduce exposure residuals atomically', () => {
  const sql = read(SQL)

  assert.match(sql, /v_new_settled := v_exp\.settled_amount \+ v_alloc_amt/s)
  assert.match(sql, /SET settled_amount = v_new_settled/s)
  assert.match(sql, /WHEN v_new_settled >= notional_base THEN 'closed'/s)
  assert.match(sql, /ELSE 'partially_hedged'/s)
})

test('Hardening migration: early close settles only undrawn residual economics', () => {
  const sql = read(SQL)
  const closeBody = sql.split('CREATE OR REPLACE FUNCTION close_window_forward')[1].split('END $$;')[0]

  assert.match(closeBody, /v_remaining := v_pos\.notional_base - v_pos\.drawn_notional/s)
  assert.match(closeBody, /v_settlement := v_remaining \* v_pos\.contracted_rate/s)
  assert.match(closeBody, /spot_rate_at_draw[\s\S]*p_close_rate/s)
  assert.match(closeBody, /is_final_settlement[\s\S]*TRUE/s)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION close_window_forward\(UUID, DATE, NUMERIC, TEXT\)[\s\S]*TO authenticated/s)
})

test('Hardening migration: exposure summary consumes settled_amount residuals', () => {
  const sql = read(SQL)

  assert.match(sql, /CREATE OR REPLACE VIEW v_exposure_summary AS/s)
  assert.match(sql, /GREATEST\(e\.notional_base - COALESCE\(e\.settled_amount, 0\), 0\)/s)
  assert.match(sql, /WHERE e\.status IN \('open', 'partially_hedged'\)/s)
  assert.match(sql, /ALTER VIEW v_exposure_summary SET \(security_invoker = on\)/s)
})

test('Accounting export surfaces window-forward draw ledger separately from journals', () => {
  const tsx = read('src/components/analytics/HedgeAccountingExport.tsx')

  assert.match(tsx, /useWindowDrawLedger/s)
  assert.match(tsx, /const DRAW_CSV_HEADERS/s)
  assert.match(tsx, /Window_Forward_Draws_/s)
  assert.match(tsx, /Window-forward draw economics are available as a separate audit ledger export/s)
  assert.match(tsx, /journal entries remain in the balanced JE export/s)
})
