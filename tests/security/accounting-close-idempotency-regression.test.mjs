import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

const SQL = 'supabase/migrations/20260605173120_accounting_close_idempotency.sql'

test('Accounting close idempotency: append RPCs supersede prior open-period rows', () => {
  const sql = read(SQL)

  for (const fn of [
    'append_fair_value_measurement',
    'append_effectiveness_assessment',
    'append_aoci_ledger_entry',
    'append_derivative_accounting_entry',
  ]) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION ${fn}`, 's'), `missing ${fn}`)
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION ${fn}[\\s\\S]*RETURNING id INTO v_id`, 's'), `${fn} should capture new row id`)
  }

  for (const table of [
    'fair_value_measurements',
    'effectiveness_assessments',
    'aoci_ledger',
    'derivative_accounting_ledger',
  ]) {
    assert.match(sql, new RegExp(`UPDATE ${table}[\\s\\S]*SET superseded_by_id = v_id[\\s\\S]*period = p_period[\\s\\S]*superseded_by_id IS NULL`, 's'), `${table} rows are not superseded`)
  }
})

test('Accounting close idempotency: period close prevents gaps before close or lock', () => {
  const sql = read(SQL)

  assert.match(sql, /CREATE OR REPLACE FUNCTION set_accounting_period_status/s)
  assert.match(sql, /v_previous_period TEXT := TO_CHAR\(\(TO_DATE\(p_period \|\| '-01', 'YYYY-MM-DD'\) - INTERVAL '1 month'\), 'YYYY-MM'\)/s)
  assert.match(sql, /p_status IN \('closed','locked'\)/s)
  assert.match(sql, /EXISTS \([\s\S]*FROM accounting_periods[\s\S]*period < p_period/s)
  assert.match(sql, /NOT EXISTS \([\s\S]*period = v_previous_period[\s\S]*status IN \('closed','locked'\)/s)
  assert.match(sql, /Cannot close accounting period % before previous period % is closed/s)
})
