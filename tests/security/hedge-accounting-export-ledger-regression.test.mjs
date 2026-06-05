import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

const COMPONENT = 'src/components/analytics/HedgeAccountingExport.tsx'

test('Hedge accounting export builds journal entries from accounting ledgers', () => {
  const tsx = read(COMPONENT)
  const componentBody = tsx.split('export function HedgeAccountingExport()')[1]

  assert.match(tsx, /useHedgeAccountingLedgers/s)
  assert.match(tsx, /generateLedgerJournalLines/s)
  assert.match(componentBody, /useHedgeAccountingLedgers\(periodKey\)/s)
  assert.match(componentBody, /generateLedgerJournalLines\(\{/s)
  assert.match(componentBody, /derivativeRows/s)
  assert.match(componentBody, /aociRows/s)
  assert.match(componentBody, /metadataByDesignationId/s)
  assert.doesNotMatch(componentBody, /generateMtmEntries\(/s)
  assert.doesNotMatch(componentBody, /generateSettlementEntries\(/s)
  assert.doesNotMatch(componentBody, /generateReclassEntries\(/s)
  assert.match(componentBody, /useWindowDrawLedger/s)
})
