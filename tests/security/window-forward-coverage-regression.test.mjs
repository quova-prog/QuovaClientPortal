import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

const SQL = 'supabase/migrations/20260604000007_window_forward_coverage.sql'

test('Coverage view: window-forward effective notional uses undrawn residual, floored', () => {
  const sql = read(SQL)
  assert.match(sql, /CREATE OR REPLACE VIEW v_hedge_coverage/s)
  // effective notional CASE: window forwards contribute (notional_base - drawn_notional), floored at 0
  assert.match(sql, /instrument_type = 'window_forward'/s)
  assert.match(sql, /GREATEST\(\s*notional_base - drawn_notional\s*,\s*0\s*\)/s)
  // non-window instruments still contribute full notional_base
  assert.match(sql, /ELSE notional_base END/s)
})

test('Coverage view: security_invoker re-asserted (RLS applies to caller)', () => {
  const sql = read(SQL)
  assert.match(sql, /ALTER VIEW v_hedge_coverage SET \(security_invoker = on\)/s)
})

test('Coverage view: still keyed on active positions by org + pair', () => {
  const sql = read(SQL)
  assert.match(sql, /WHERE status = 'active'/s)
  assert.match(sql, /GROUP BY org_id, currency_pair/s)
})
