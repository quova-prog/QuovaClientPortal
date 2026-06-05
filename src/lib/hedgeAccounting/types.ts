export const FRAMEWORKS = ['asc815', 'ifrs9'] as const
export type HedgeAccountingFramework = typeof FRAMEWORKS[number]

export const DESIGNATION_TYPES = ['cash_flow', 'fair_value', 'net_investment'] as const
export type HedgeDesignationType = typeof DESIGNATION_TYPES[number]

export const ACCOUNTING_STATUSES = ['preparatory', 'designated', 'dedesignated', 'disqualified'] as const
export type HedgeAccountingStatus = typeof ACCOUNTING_STATUSES[number]

export const INCEPTION_DOC_STATUSES = ['complete', 'incomplete', 'missing', 'backfilled'] as const
export type InceptionDocStatus = typeof INCEPTION_DOC_STATUSES[number]

export const PROBABILITY_STATUSES = [
  'probable',
  'no_longer_probable_still_expected',
  'probable_not_to_occur',
] as const
export type ProbabilityStatus = typeof PROBABILITY_STATUSES[number]

export const FAIR_VALUE_SOURCES = ['quova_indicative', 'bank_mtm'] as const
export type FairValueSource = typeof FAIR_VALUE_SOURCES[number]

export const FAIR_VALUE_HIERARCHIES = [
  'level_1',
  'level_2_bank',
  'level_2_indicative',
  'level_3',
] as const
export type FairValueHierarchy = typeof FAIR_VALUE_HIERARCHIES[number]

export const JOURNAL_OUTPUT_MODES = ['draft', 'auditor_approved'] as const
export type JournalOutputMode = typeof JOURNAL_OUTPUT_MODES[number]

export interface AccountingQualificationInput {
  accountingStatus: HedgeAccountingStatus
  inceptionDocStatus: InceptionDocStatus
}

export interface FinalJournalGateInput {
  journalOutputMode: JournalOutputMode
  fairValueSource: FairValueSource
  fairValueHierarchy: FairValueHierarchy
  allDesignationsQualified: boolean
}

export function isAccountingQualifiedDesignation(input: AccountingQualificationInput): boolean {
  return input.accountingStatus === 'designated' && input.inceptionDocStatus === 'complete'
}

export function isFinalJournalAllowed(input: FinalJournalGateInput): boolean {
  const approvedHierarchy = input.fairValueHierarchy === 'level_1'
    || input.fairValueHierarchy === 'level_2_bank'

  return input.journalOutputMode === 'auditor_approved'
    && input.fairValueSource === 'bank_mtm'
    && approvedHierarchy
    && input.allDesignationsQualified
}
