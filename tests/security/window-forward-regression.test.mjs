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
