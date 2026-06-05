import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

test('Migration A: hedge_positions allows window_forward and adds window columns', () => {
  const sql = read('supabase/migrations/20260604000001_window_forward_positions.sql')

  // instrument_type CHECK now includes window_forward
  assert.match(sql, /instrument_type IN \(\s*'forward',\s*'window_forward',\s*'swap',\s*'option',\s*'spot'\s*\)/s)

  // new columns, added idempotently
  assert.match(sql, /ADD COLUMN IF NOT EXISTS window_start_date\s+DATE/s)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS window_end_date\s+DATE/s)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS pricing_method\s+TEXT/s)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS drawn_notional\s+NUMERIC\(20,2\) NOT NULL DEFAULT 0/s)

  // consistency CHECK: window fields present iff window_forward, with valid pricing_method
  assert.match(sql, /window_dates_consistent/s)
  assert.match(sql, /pricing_method\s+IN \('fixed_worst_rate','pro_rata_points'\)/s)

  // drawn_notional bounded to [0, notional_base]
  assert.match(sql, /drawn_notional >= 0 AND drawn_notional <= notional_base/s)
})

test('Migration B: draws table stores write-once economics with invariant triggers + RLS', () => {
  const sql = read('supabase/migrations/20260604000002_window_forward_draws.sql')

  // table + write-once economic columns
  assert.match(sql, /CREATE TABLE IF NOT EXISTS hedge_position_draws/s)
  for (const col of [
    'spot_rate_at_draw', 'settlement_quote', 'realized_pnl_quote',
    'realized_pnl_usd', 'is_final_settlement', 'draw_seq',
  ]) {
    assert.match(sql, new RegExp(col, 's'), `missing column ${col}`)
  }

  // unique draw sequence per position
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_draw_seq\s+ON hedge_position_draws\(position_id, draw_seq\)/s)

  // org-match trigger: draw.org_id must equal parent position org
  assert.match(sql, /enforce_draw_org_matches_position/s)
  assert.match(sql, /does not match position org/s)
  assert.match(sql, /BEFORE INSERT OR UPDATE ON hedge_position_draws/s)

  // recalc trigger locks the parent row (FOR UPDATE) and auto-closes when fully drawn
  assert.match(sql, /recalc_drawn_notional/s)
  assert.match(sql, /FROM hedge_positions WHERE id = v_pos FOR UPDATE/s)
  assert.match(sql, /WHEN v_total >= v_notional THEN 'closed'/s)

  // mandatory audit trigger
  assert.match(sql, /trg_audit_hedge_position_draws[\s\S]*audit_trigger_func\(\)/s)

  // RLS: select scoped to org; direct writes blocked (RPC is the only write path)
  assert.match(sql, /ALTER TABLE hedge_position_draws ENABLE ROW LEVEL SECURITY/s)
  assert.match(sql, /FOR SELECT USING \(org_id = current_user_org_id\(\)\)/s)
  assert.match(sql, /FOR INSERT TO authenticated WITH CHECK \(false\)/s)
  assert.match(sql, /FOR UPDATE TO authenticated USING \(false\)/s)
  assert.match(sql, /FOR DELETE TO authenticated USING \(false\)/s)
})

test('Migration C: draw→exposure allocation linkage + settled_amount on fx_exposures', () => {
  const sql = read('supabase/migrations/20260604000003_draw_exposure_allocations.sql')

  // fx_exposures gains a bounded settled_amount
  assert.match(sql, /ALTER TABLE fx_exposures[\s\S]*ADD COLUMN IF NOT EXISTS settled_amount\s+NUMERIC\(20,2\) NOT NULL DEFAULT 0/s)
  assert.match(sql, /settled_amount >= 0 AND settled_amount <= notional_base/s)

  // allocation table with exactly-one-target invariant
  assert.match(sql, /CREATE TABLE IF NOT EXISTS draw_exposure_allocations/s)
  assert.match(sql, /one_target CHECK/s)
  assert.match(sql, /exposure_id IS NOT NULL AND derived_source IS NULL/s)
  assert.match(sql, /exposure_id IS NULL AND derived_source IS NOT NULL/s)

  // audit + RLS (read-only to clients; RPC is the write path)
  assert.match(sql, /trg_audit_draw_exposure_allocations[\s\S]*audit_trigger_func\(\)/s)
  assert.match(sql, /ALTER TABLE draw_exposure_allocations ENABLE ROW LEVEL SECURITY/s)
  assert.match(sql, /FOR SELECT USING \(org_id = current_user_org_id\(\)\)/s)
  assert.match(sql, /FOR INSERT TO authenticated WITH CHECK \(false\)/s)
})

test('Migration D: policy window controls (idempotent) + hedge_policies audit coverage', () => {
  const sql = read('supabase/migrations/20260604000004_window_forward_policy.sql')

  // new policy columns added idempotently (allowed_instruments already exists from v2)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS window_forward_pairs\s+TEXT\[\] NOT NULL DEFAULT '\{\}'::TEXT\[\]/s)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS max_window_days\s+INTEGER NOT NULL DEFAULT 90/s)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS max_draws_per_window\s+INTEGER NOT NULL DEFAULT 8/s)

  // bounded
  assert.match(sql, /max_window_days > 0 AND max_window_days <= 365/s)
  assert.match(sql, /max_draws_per_window > 0 AND max_draws_per_window <= 50/s)

  // careful backfill: NULL allowed_instruments → classic four, NEVER auto-enable window_forward
  assert.match(sql, /SET allowed_instruments = ARRAY\['forward','swap','option','spot'\]::TEXT\[\]\s*WHERE allowed_instruments IS NULL/s)
  assert.doesNotMatch(sql, /allowed_instruments[\s\S]*'window_forward'/s)

  // hedge_policies now audit-covered (compliance-sensitive allowlist)
  assert.match(sql, /trg_audit_hedge_policies[\s\S]*audit_trigger_func\(\)/s)
})

test('Migration E: validate_window_forward enforces policy invariants server-side', () => {
  const sql = read('supabase/migrations/20260604000005_window_forward_validation.sql')

  assert.match(sql, /CREATE OR REPLACE FUNCTION validate_window_forward/s)
  // SECURITY DEFINER with locked search_path (SOC2 requirement)
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = public/s)

  // each policy gate raises rather than silently passing
  assert.match(sql, /Policy does not allow window forwards/s)
  assert.match(sql, /not eligible for window forwards under policy/s)
  assert.match(sql, /exceeds policy max/s)
  assert.match(sql, /Max draws per window/s)

  // uses array membership against the policy controls from Migration D
  assert.match(sql, /'window_forward' = ANY\(/s)
  assert.match(sql, /= ANY\(COALESCE\(v_policy\.window_forward_pairs/s)
})
