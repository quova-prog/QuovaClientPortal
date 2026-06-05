import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

const HOOK = 'src/hooks/useHedgeAccounting.ts'

test('Hedge accounting ledger hook reads accounting ledgers by org and period', () => {
  const ts = read(HOOK)

  assert.match(ts, /useHedgeAccountingLedgers\(period: string, entityId\?: string \| null\)/s)
  assert.match(ts, /from\('derivative_accounting_ledger'\)[\s\S]*\.eq\('org_id', orgId\)[\s\S]*\.eq\('period', period\)/s)
  assert.match(ts, /from\('aoci_ledger'\)[\s\S]*\.eq\('org_id', orgId\)[\s\S]*\.eq\('period', period\)/s)
  assert.match(ts, /from\('hedge_designations'\)[\s\S]*hedge_positions[\s\S]*entity_id/s)
  assert.match(ts, /allowedDesignationIds/s)
  assert.match(ts, /position\?\.entity_id === entityId/s)
  assert.match(ts, /metadataByDesignationId/s)
  assert.doesNotMatch(ts, /from\('hedge_position_draws'\)/s)
})
