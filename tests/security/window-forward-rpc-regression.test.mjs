import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

const SQL = 'supabase/migrations/20260604000006_window_forward_rpcs.sql'

test('RPC migration: all functions are SECURITY DEFINER with locked search_path', () => {
  const sql = read(SQL)
  for (const fn of ['fx_quote_to_usd', 'book_window_forward', 'record_window_draw', 'settle_expired_windows']) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION ${fn}`, 's'), `missing function ${fn}`)
  }
  // every function definition pins search_path (SOC2)
  const defs = sql.split('CREATE OR REPLACE FUNCTION').slice(1)
  assert.equal(defs.length, 4, 'expected exactly 4 functions')
  for (const def of defs) {
    assert.match(def, /SECURITY DEFINER\s+SET search_path = public/s)
  }
})

test('RPC migration: draw_rate authority is server-set, never client-supplied', () => {
  const sql = read(SQL)
  // record_window_draw derives draw_rate from the position's contracted_rate
  assert.match(sql, /v_draw_rate\s*:=\s*v_pos\.contracted_rate/s)
  // record_window_draw signature must NOT accept a draw_rate parameter
  const drawFn = sql.split('CREATE OR REPLACE FUNCTION record_window_draw')[1].split('AS \$\$')[0]
  assert.doesNotMatch(drawFn, /p_draw_rate/s)
})

test('RPC migration: economics computed server-side and direction-aware', () => {
  const sql = read(SQL)
  // spot looked up from fx_rates at/before the draw date
  assert.match(sql, /FROM fx_rates[\s\S]*rate_date <= p_draw_date[\s\S]*ORDER BY rate_date DESC/s)
  // settlement amount in quote ccy
  assert.match(sql, /v_settlement\s*:=\s*p_draw_amount \* v_draw_rate/s)
  // direction-aware realized P&L (sell vs buy)
  assert.match(sql, /v_pos\.direction = 'sell'/s)
  // USD conversion via the helper
  assert.match(sql, /fx_quote_to_usd\(/s)
})

test('RPC migration: caller org/role enforced and policy validated', () => {
  const sql = read(SQL)
  assert.match(sql, /current_user_org_id\(\)/s)
  assert.match(sql, /current_user_role\(\) IN \('admin', 'editor'\)/s)
  assert.match(sql, /validate_window_forward\(/s)
})

test('RPC migration: draw bounds + window + business-day enforced', () => {
  const sql = read(SQL)
  // cannot draw more than remaining notional
  assert.match(sql, /exceeds remaining notional/s)
  // draw date inside the window
  assert.match(sql, /outside the window/s)
  // business-day check (no weekend settlement)
  assert.match(sql, /EXTRACT\(DOW FROM p_draw_date\)/s)
})

test('RPC migration: final settlement flagged and forced at window end', () => {
  const sql = read(SQL)
  assert.match(sql, /settle_expired_windows/s)
  assert.match(sql, /window_end_date < CURRENT_DATE/s)
  assert.match(sql, /is_final_settlement/s)
})

test('RPC migration: direct client inserts of window_forward are blocked (RPC only)', () => {
  const sql = read(SQL)
  // the hedge_positions insert policy is tightened to exclude window_forward
  assert.match(sql, /CREATE POLICY "hedge_positions_insert" ON hedge_positions/s)
  assert.match(sql, /instrument_type <> 'window_forward'/s)
})
