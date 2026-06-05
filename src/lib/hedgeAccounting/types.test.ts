import { describe, expect, it } from 'vitest'
import {
  ACCOUNTING_STATUSES,
  DESIGNATION_TYPES,
  FAIR_VALUE_HIERARCHIES,
  FAIR_VALUE_SOURCES,
  FRAMEWORKS,
  JOURNAL_OUTPUT_MODES,
  PROBABILITY_STATUSES,
  isAccountingQualifiedDesignation,
  isFinalJournalAllowed,
} from './types'

describe('hedgeAccounting type contracts', () => {
  it('matches the accounting spec enum values', () => {
    expect(FRAMEWORKS).toEqual(['asc815', 'ifrs9'])
    expect(DESIGNATION_TYPES).toEqual(['cash_flow', 'fair_value', 'net_investment'])
    expect(ACCOUNTING_STATUSES).toEqual(['preparatory', 'designated', 'dedesignated', 'disqualified'])
    expect(PROBABILITY_STATUSES).toEqual([
      'probable',
      'no_longer_probable_still_expected',
      'probable_not_to_occur',
    ])
    expect(FAIR_VALUE_SOURCES).toEqual(['quova_indicative', 'bank_mtm'])
    expect(FAIR_VALUE_HIERARCHIES).toEqual(['level_1', 'level_2_bank', 'level_2_indicative', 'level_3'])
    expect(JOURNAL_OUTPUT_MODES).toEqual(['draft', 'auditor_approved'])
  })

  it('only treats complete designated records as accounting-qualified', () => {
    expect(isAccountingQualifiedDesignation({
      accountingStatus: 'designated',
      inceptionDocStatus: 'complete',
    })).toBe(true)

    expect(isAccountingQualifiedDesignation({
      accountingStatus: 'preparatory',
      inceptionDocStatus: 'complete',
    })).toBe(false)

    expect(isAccountingQualifiedDesignation({
      accountingStatus: 'designated',
      inceptionDocStatus: 'backfilled',
    })).toBe(false)
  })

  it('blocks final journals for indicative valuation or preparatory designations', () => {
    expect(isFinalJournalAllowed({
      journalOutputMode: 'auditor_approved',
      fairValueSource: 'bank_mtm',
      fairValueHierarchy: 'level_2_bank',
      allDesignationsQualified: true,
    })).toBe(true)

    expect(isFinalJournalAllowed({
      journalOutputMode: 'draft',
      fairValueSource: 'bank_mtm',
      fairValueHierarchy: 'level_2_bank',
      allDesignationsQualified: true,
    })).toBe(false)

    expect(isFinalJournalAllowed({
      journalOutputMode: 'auditor_approved',
      fairValueSource: 'quova_indicative',
      fairValueHierarchy: 'level_2_indicative',
      allDesignationsQualified: true,
    })).toBe(false)

    expect(isFinalJournalAllowed({
      journalOutputMode: 'auditor_approved',
      fairValueSource: 'bank_mtm',
      fairValueHierarchy: 'level_2_indicative',
      allDesignationsQualified: true,
    })).toBe(false)

    expect(isFinalJournalAllowed({
      journalOutputMode: 'auditor_approved',
      fairValueSource: 'bank_mtm',
      fairValueHierarchy: 'level_2_bank',
      allDesignationsQualified: false,
    })).toBe(false)
  })
})
