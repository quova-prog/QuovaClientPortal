import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HEDGE_ACCOUNTING_ACCOUNT_MAP,
  generateLedgerJournalLines,
  type LedgerJournalInput,
} from './journal'

function baseInput(overrides: Partial<LedgerJournalInput> = {}): LedgerJournalInput {
  return {
    period: '2026-06',
    journalDate: '2026-06-30',
    entityName: 'Consolidated',
    accountMap: DEFAULT_HEDGE_ACCOUNTING_ACCOUNT_MAP,
    derivativeRows: [],
    aociRows: [],
    metadataByDesignationId: {
      'designation-1': {
        hedgeType: 'cash_flow',
        positionId: 'position-1',
        referenceNumber: 'WF-100',
        currencyPair: 'EUR/USD',
        instrumentType: 'window_forward',
        counterparty: 'Bank A',
        maturityDate: '2026-09-30',
        notionalBase: 1_000_000,
        contractedRate: 1.1,
      },
    },
    ...overrides,
  }
}

describe('generateLedgerJournalLines', () => {
  it('renders balanced MTM and AOCI deferral lines from ledger movement amounts', () => {
    const lines = generateLedgerJournalLines(baseInput({
      derivativeRows: [{
        id: 'dal-1',
        designationId: 'designation-1',
        positionId: 'position-1',
        drawId: null,
        period: '2026-06',
        eventType: 'mtm_to_fair_value',
        amountUsd: 6_000,
        derivativeBalanceAfterUsd: 18_000,
        sourceEventRef: 'fair_value:fv-1',
      }],
      aociRows: [{
        id: 'aoci-1',
        designationId: 'designation-1',
        hedgedItemId: null,
        period: '2026-06',
        eventType: 'defer',
        bucket: 'aoci_cf',
        amountUsd: 6_000,
        balanceAfterUsd: 8_000,
        sourceEventRef: 'asc815:cfh:defer',
      }],
    }))

    expect(lines).toHaveLength(2)
    expect(lines.map((line) => ({
      entryType: line.entryType,
      accountCode: line.accountCode,
      debitUsd: line.debitUsd,
      creditUsd: line.creditUsd,
      fairValueUsd: line.fairValueUsd,
    }))).toEqual([
      {
        entryType: 'MTM_Adjustment',
        accountCode: '[DERIVATIVE_ASSET]',
        debitUsd: 6_000,
        creditUsd: 0,
        fairValueUsd: 18_000,
      },
      {
        entryType: 'MTM_Adjustment',
        accountCode: '[AOCI_CF_RESERVE]',
        debitUsd: 0,
        creditUsd: 6_000,
        fairValueUsd: 8_000,
      },
    ])
    expect(lines[0].memo).toContain('fair_value:fv-1')
  })

  it('reclassifies AOCI only from reclassification ledger rows', () => {
    const lines = generateLedgerJournalLines(baseInput({
      aociRows: [{
        id: 'aoci-reclass-1',
        designationId: 'designation-1',
        hedgedItemId: 'item-1',
        period: '2026-06',
        eventType: 'reclassify',
        bucket: 'aoci_cf',
        amountUsd: -3_000,
        balanceAfterUsd: 5_000,
        sourceEventRef: 'hedged_item:item-1:affects_earnings',
      }],
    }))

    expect(lines).toHaveLength(2)
    expect(lines.map((line) => ({
      entryType: line.entryType,
      accountCode: line.accountCode,
      debitUsd: line.debitUsd,
      creditUsd: line.creditUsd,
    }))).toEqual([
      {
        entryType: 'OCI_Reclassification',
        accountCode: '[AOCI_CF_RESERVE]',
        debitUsd: 3_000,
        creditUsd: 0,
      },
      {
        entryType: 'OCI_Reclassification',
        accountCode: '[RECLASSIFICATION_TARGET]',
        debitUsd: 0,
        creditUsd: 3_000,
      },
    ])
    expect(lines[0].asc815Note).toMatch(/hedged item affects earnings/i)
  })

  it('clears derivative carrying value on settlement rows without using economic draw P&L', () => {
    const lines = generateLedgerJournalLines(baseInput({
      derivativeRows: [{
        id: 'dal-settle-1',
        designationId: 'designation-1',
        positionId: 'position-1',
        drawId: 'draw-1',
        period: '2026-06',
        eventType: 'partial_settlement',
        amountUsd: -4_500,
        derivativeBalanceAfterUsd: 13_500,
        sourceEventRef: 'draw:draw-1',
      }],
    }))

    expect(lines).toHaveLength(2)
    expect(lines.map((line) => ({
      entryType: line.entryType,
      accountCode: line.accountCode,
      debitUsd: line.debitUsd,
      creditUsd: line.creditUsd,
    }))).toEqual([
      {
        entryType: 'Settlement',
        accountCode: '[SETTLEMENT_ACCOUNT]',
        debitUsd: 4_500,
        creditUsd: 0,
      },
      {
        entryType: 'Settlement',
        accountCode: '[DERIVATIVE_ASSET]',
        debitUsd: 0,
        creditUsd: 4_500,
      },
    ])
    expect(lines[0].memo).toContain('draw:draw-1')
  })
})
