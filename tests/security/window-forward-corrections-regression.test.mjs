import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')
const migrationFiles = readdirSync(path.join(repoRoot, 'supabase/migrations'))
const correctionMigration = migrationFiles.find((file) => file.endsWith('_window_forward_corrections.sql'))

test('Window forward corrections migration exists', () => {
  assert.ok(correctionMigration, 'expected a tracked migration for window forward corrections')
})

test('Window forward corrections: expiry settlement fails loudly without a reference rate', () => {
  const sql = read(`supabase/migrations/${correctionMigration}`)

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.settle_expired_windows\(\)/s)
  assert.match(sql, /No spot rate for expired window forward/s)
  assert.doesNotMatch(sql, /IF v_spot IS NULL THEN\s+CONTINUE;/s)
})

test('Window forward corrections: draw allocation enforces entity scope', () => {
  const sql = read(`supabase/migrations/${correctionMigration}`)

  assert.match(sql, /Allocated exposure entity does not match position entity/s)
  assert.match(sql, /v_pos\.entity_id IS DISTINCT FROM v_exp\.entity_id/s)
})

test('Window forward corrections: unimplemented pro-rata pricing is disabled', () => {
  const sql = read(`supabase/migrations/${correctionMigration}`)

  assert.match(sql, /DROP CONSTRAINT IF EXISTS window_dates_consistent/s)
  assert.match(sql, /pricing_method\s+=\s*'fixed_worst_rate'/s)
  assert.doesNotMatch(sql, /pro_rata_points/s)
})

test('Hedge entry labels Quova-generated window rates as indicative', () => {
  const tsx = read('src/pages/HedgePage.tsx')

  assert.match(tsx, /Indicative Window Rate/s)
  assert.match(tsx, /Indicative until bank quote confirmation/s)
  assert.match(tsx, /pending bank confirmation/s)
  assert.doesNotMatch(tsx, /bank's worst-rate-in-window quote/s)
})

test('Trade and Hedge dashboards use residual effective notional for window-forward economic offsets', () => {
  const trade = read('src/pages/TradePage.tsx')
  const hedge = read('src/pages/HedgePage.tsx')

  assert.match(trade, /effectiveHedgedNotional\(p\)/s)
  assert.match(trade, /exposureNotional \* \(inceptionSpot - currentSpot\)/s)
  assert.match(trade, /exposureNotional \* \(currentSpot - inceptionSpot\)/s)
  assert.match(hedge, /effectiveHedgedNotional\(p\)/s)
  assert.match(hedge, /effectiveNotional \* \(inceptionSpot - currentSpot\)/s)
  assert.match(hedge, /effectiveNotional \* \(currentSpot - inceptionSpot\)/s)
})
