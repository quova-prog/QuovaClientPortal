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
