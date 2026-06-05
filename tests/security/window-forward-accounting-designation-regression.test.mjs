import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

const SQL = 'supabase/migrations/20260605000003_window_forward_accounting_designation.sql'

test('Window-forward accounting designation migration: booking creates a preparatory designation after position insert', () => {
  const sql = read(SQL)
  const bookingBody = sql.split('CREATE OR REPLACE FUNCTION book_window_forward')[1].split('END $$;')[0]

  assert.match(bookingBody, /INSERT INTO hedge_positions \([\s\S]*\)\s+RETURNING id INTO v_id/s)
  assert.match(bookingBody, /PERFORM record_designation\(\s*v_id,\s*p_hedge_type,\s*'fx_spot'/s)
  assert.match(bookingBody, /CASE WHEN p_notes IS NULL THEN 'missing' ELSE 'incomplete' END/s)
  assert.doesNotMatch(bookingBody, /accounting_status\s*=\s*'designated'/s)

  const positionInsertIndex = bookingBody.indexOf('RETURNING id INTO v_id')
  const designationIndex = bookingBody.indexOf('PERFORM record_designation')
  assert.ok(designationIndex > positionInsertIndex, 'designation should be recorded after position id is available')
})

test('Window-forward accounting designation migration: booking keeps hardening invariants and execute grant', () => {
  const sql = read(SQL)

  assert.match(sql, /CREATE OR REPLACE FUNCTION book_window_forward\([\s\S]*p_entity_id\s+UUID DEFAULT NULL/s)
  assert.match(sql, /SELECT plan INTO v_plan FROM organisations WHERE id = v_org/s)
  assert.match(sql, /v_plan NOT IN \('pro', 'enterprise'\)/s)
  assert.match(sql, /FROM entities WHERE id = p_entity_id AND org_id = v_org AND is_active = TRUE/s)
  assert.match(sql, /validate_window_forward\([\s\S]*p_entity_id/s)
  assert.match(sql, /instrument_type, pricing_method,[\s\S]*currency_pair/s)
  assert.match(sql, /REVOKE ALL ON FUNCTION book_window_forward\([\s\S]*TEXT, TEXT, NUMERIC, DATE, DATE, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, UUID[\s\S]*\) FROM PUBLIC, anon/s)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION book_window_forward\([\s\S]*TEXT, TEXT, NUMERIC, DATE, DATE, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, UUID[\s\S]*\) TO authenticated/s)
})

test('Window-forward accounting designation migration: backfills existing positions as preparatory designations', () => {
  const sql = read(SQL)

  assert.match(sql, /INSERT INTO org_accounting_config \(org_id\)[\s\S]*SELECT DISTINCT hp\.org_id[\s\S]*FROM hedge_positions hp[\s\S]*ON CONFLICT \(org_id\) DO NOTHING/s)
  assert.match(sql, /INSERT INTO hedge_designations \([\s\S]*org_id, position_id, designation_type, framework, accounting_status,[\s\S]*inception_doc_status, hedged_risk, method,[\s\S]*assessment_method, inception_doc, probability_status[\s\S]*\)/s)
  assert.match(sql, /SELECT hp\.org_id, hp\.id, hp\.hedge_type, cfg\.framework, 'preparatory'/s)
  assert.match(sql, /'backfilled', 'fx_spot', cfg\.designation_method/s)
  assert.match(sql, /LEFT JOIN hedge_designations existing[\s\S]*existing\.position_id = hp\.id/s)
  assert.match(sql, /WHERE existing\.id IS NULL/s)
})
