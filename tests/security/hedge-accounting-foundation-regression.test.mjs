import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

const SQL = 'supabase/migrations/20260605000002_hedge_accounting_foundation.sql'

test('Hedge accounting foundation: creates config, designation, item, period, measurement, and ledger tables', () => {
  const sql = read(SQL)

  for (const table of [
    'org_accounting_config',
    'hedge_designations',
    'hedged_items',
    'accounting_periods',
    'fair_value_measurements',
    'effectiveness_assessments',
    'aoci_ledger',
    'derivative_accounting_ledger',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 's'), `missing table ${table}`)
  }

  assert.match(sql, /journal_output_mode\s+TEXT NOT NULL DEFAULT 'draft'/s)
  assert.match(sql, /fair_value_hierarchy\s+TEXT NOT NULL DEFAULT 'level_2_indicative'/s)
  assert.match(sql, /accounting_status\s+TEXT NOT NULL DEFAULT 'preparatory'/s)
  assert.match(sql, /inception_doc_status\s+TEXT NOT NULL DEFAULT 'missing'/s)
  assert.match(sql, /probability_status\s+TEXT NOT NULL DEFAULT 'probable'/s)
  assert.match(sql, /no_longer_probable_still_expected/s)
  assert.match(sql, /probable_not_to_occur/s)
  assert.match(sql, /affects_earnings_on\s+DATE/s)
  assert.match(sql, /lifecycle_settlement_date\s+DATE/s)
})

test('Hedge accounting foundation: ledger and measurement tables are append-only to clients', () => {
  const sql = read(SQL)

  for (const table of [
    'fair_value_measurements',
    'effectiveness_assessments',
    'aoci_ledger',
    'derivative_accounting_ledger',
  ]) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, 's'), `${table} missing RLS`)
    assert.match(sql, new RegExp(`CREATE POLICY "${table}_select" ON ${table}[\\s\\S]*FOR SELECT USING \\(org_id = current_user_org_id\\(\\)\\)`, 's'), `${table} missing org-scoped select`)
    assert.match(sql, new RegExp(`CREATE POLICY "${table}_insert_blocked" ON ${table}[\\s\\S]*FOR INSERT TO authenticated WITH CHECK \\(false\\)`, 's'), `${table} missing blocked insert`)
    assert.match(sql, new RegExp(`CREATE POLICY "${table}_update_blocked" ON ${table}[\\s\\S]*FOR UPDATE TO authenticated USING \\(false\\)`, 's'), `${table} missing blocked update`)
    assert.match(sql, new RegExp(`CREATE POLICY "${table}_delete_blocked" ON ${table}[\\s\\S]*FOR DELETE TO authenticated USING \\(false\\)`, 's'), `${table} missing blocked delete`)
  }
})

test('Hedge accounting foundation: mutable accounting tables are RLS protected and audit-covered', () => {
  const sql = read(SQL)

  for (const table of [
    'org_accounting_config',
    'hedge_designations',
    'hedged_items',
    'accounting_periods',
  ]) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, 's'), `${table} missing RLS`)
  }

  assert.match(sql, /CREATE POLICY "org_accounting_config_select" ON org_accounting_config[\s\S]*USING \(org_id = current_user_org_id\(\)\)/s)
  assert.match(sql, /CREATE POLICY "org_accounting_config_upsert" ON org_accounting_config[\s\S]*WITH CHECK \(org_id = current_user_org_id\(\) AND current_user_role\(\) IN \('admin', 'editor'\)\)/s)
  assert.match(sql, /CREATE POLICY "hedge_designations_write" ON hedge_designations[\s\S]*WITH CHECK \(org_id = current_user_org_id\(\) AND current_user_role\(\) IN \('admin', 'editor'\)\)/s)
  assert.match(sql, /CREATE POLICY "accounting_periods_write" ON accounting_periods[\s\S]*WITH CHECK \(org_id = current_user_org_id\(\) AND current_user_role\(\) = 'admin'\)/s)

  for (const trigger of [
    'trg_audit_org_accounting_config',
    'trg_audit_hedge_designations',
    'trg_audit_hedged_items',
    'trg_audit_accounting_periods',
  ]) {
    assert.match(sql, new RegExp(`${trigger}[\\s\\S]*audit_trigger_func\\(\\)`, 's'), `missing audit trigger ${trigger}`)
  }
})

test('Hedge accounting foundation: persistence RPCs are security-definer and role gated', () => {
  const sql = read(SQL)

  for (const fn of [
    'record_designation',
    'append_fair_value_measurement',
    'append_effectiveness_assessment',
    'append_aoci_ledger_entry',
    'append_derivative_accounting_entry',
    'set_accounting_period_status',
  ]) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION ${fn}`, 's'), `missing ${fn}`)
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION ${fn}[\\s\\S]*SECURITY DEFINER SET search_path = public`, 's'), `${fn} missing locked security definer`)
  }

  assert.match(sql, /current_user_role\(\) NOT IN \('admin', 'editor'\)/s)
  assert.match(sql, /current_user_role\(\) <> 'admin'/s)
  assert.match(sql, /journal_output_mode <> 'auditor_approved'/s)
  assert.match(sql, /fair_value_source = 'quova_indicative'/s)
  assert.match(sql, /accounting_status <> 'designated'/s)
})
