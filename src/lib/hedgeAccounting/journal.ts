import type {
  AociLedgerEventType,
  DerivativeAccountingEventType,
} from './engine'

export interface HedgeAccountingAccountCode {
  code: string
  name: string
}

export interface HedgeAccountingAccountMap {
  derivative_asset: HedgeAccountingAccountCode
  derivative_liability: HedgeAccountingAccountCode
  aoci_cf_reserve: HedgeAccountingAccountCode
  unrealized_gl: HedgeAccountingAccountCode
  realized_gl: HedgeAccountingAccountCode
  settlement_account: HedgeAccountingAccountCode
  reclassification_target: HedgeAccountingAccountCode
}

export const DEFAULT_HEDGE_ACCOUNTING_ACCOUNT_MAP: HedgeAccountingAccountMap = {
  derivative_asset: { code: '', name: 'Derivative Financial Assets - Current' },
  derivative_liability: { code: '', name: 'Derivative Financial Liabilities - Current' },
  aoci_cf_reserve: { code: '', name: 'AOCI - Cash Flow Hedge Reserve' },
  unrealized_gl: { code: '', name: 'Unrealized Gain/Loss on Hedge Instruments' },
  realized_gl: { code: '', name: 'Realized Gain/Loss on FX Hedges' },
  settlement_account: { code: '', name: 'FX Settlement Receivable / Payable' },
  reclassification_target: { code: '', name: 'Revenue / COGS' },
}

export type LedgerJournalEntryType =
  | 'MTM_Adjustment'
  | 'Settlement'
  | 'OCI_Reclassification'
  | 'Forecast_Failure'

export interface LedgerJournalLine {
  reference: string
  journalDate: string
  entryType: LedgerJournalEntryType
  hedgeType: string
  positionId: string
  currencyPair: string
  instrumentType: string
  counterparty: string
  maturityDate: string
  accountCode: string
  accountName: string
  debitUsd: number
  creditUsd: number
  notionalBase: number
  contractedRate: number
  spotRate: number
  fairValueUsd: number
  memo: string
  entity: string
  period: string
  asc815Note: string
}

export interface DerivativeAccountingLedgerRow {
  id: string
  designationId: string
  positionId: string
  drawId: string | null
  period: string
  eventType: DerivativeAccountingEventType
  amountUsd: number
  derivativeBalanceAfterUsd: number
  sourceEventRef: string | null
}

export interface AociLedgerRow {
  id: string
  designationId: string
  hedgedItemId: string | null
  period: string
  eventType: AociLedgerEventType
  bucket: 'aoci_cf' | 'cta'
  amountUsd: number
  balanceAfterUsd: number
  sourceEventRef: string | null
}

export interface LedgerJournalMetadata {
  hedgeType: string
  positionId: string
  referenceNumber?: string | null
  currencyPair?: string | null
  instrumentType?: string | null
  counterparty?: string | null
  maturityDate?: string | null
  notionalBase?: number | null
  contractedRate?: number | null
  spotRate?: number | null
}

export interface LedgerJournalInput {
  period: string
  journalDate: string
  entityName: string
  accountMap: HedgeAccountingAccountMap
  derivativeRows: DerivativeAccountingLedgerRow[]
  aociRows: AociLedgerRow[]
  metadataByDesignationId: Record<string, LedgerJournalMetadata>
}

function fallbackAccount(account: HedgeAccountingAccountCode, fallbackCode: string): HedgeAccountingAccountCode {
  return {
    code: account.code || fallbackCode,
    name: account.name,
  }
}

function debit(amountUsd: number): { debitUsd: number; creditUsd: number } {
  return { debitUsd: Math.abs(amountUsd), creditUsd: 0 }
}

function credit(amountUsd: number): { debitUsd: number; creditUsd: number } {
  return { debitUsd: 0, creditUsd: Math.abs(amountUsd) }
}

function reference(prefix: string, period: string, designationId: string): string {
  return `${prefix}-${period}-${designationId.slice(0, 8).toUpperCase()}`
}

function metadata(input: LedgerJournalInput, designationId: string): LedgerJournalMetadata {
  return input.metadataByDesignationId[designationId] ?? {
    hedgeType: 'cash_flow',
    positionId: designationId,
  }
}

function baseLine(
  input: LedgerJournalInput,
  designationId: string,
  entryType: LedgerJournalEntryType,
): Omit<LedgerJournalLine, 'accountCode' | 'accountName' | 'debitUsd' | 'creditUsd' | 'fairValueUsd' | 'memo' | 'asc815Note' | 'reference'> {
  const meta = metadata(input, designationId)
  return {
    journalDate: input.journalDate,
    entryType,
    hedgeType: meta.hedgeType.toUpperCase(),
    positionId: meta.referenceNumber ?? meta.positionId,
    currencyPair: meta.currencyPair ?? '',
    instrumentType: meta.instrumentType ?? '',
    counterparty: meta.counterparty ?? '',
    maturityDate: meta.maturityDate ?? '',
    notionalBase: meta.notionalBase ?? 0,
    contractedRate: meta.contractedRate ?? 0,
    spotRate: meta.spotRate ?? 0,
    entity: input.entityName,
    period: input.period,
  }
}

function line(
  input: LedgerJournalInput,
  designationId: string,
  entryType: LedgerJournalEntryType,
  account: HedgeAccountingAccountCode,
  amounts: { debitUsd: number; creditUsd: number },
  fairValueUsd: number,
  memo: string,
  asc815Note: string,
  refPrefix: string,
): LedgerJournalLine {
  return {
    ...baseLine(input, designationId, entryType),
    reference: reference(refPrefix, input.period, designationId),
    accountCode: account.code,
    accountName: account.name,
    debitUsd: amounts.debitUsd,
    creditUsd: amounts.creditUsd,
    fairValueUsd,
    memo,
    asc815Note,
  }
}

function derivativeMtmLine(input: LedgerJournalInput, row: DerivativeAccountingLedgerRow): LedgerJournalLine {
  const account = row.amountUsd >= 0
    ? fallbackAccount(input.accountMap.derivative_asset, '[DERIVATIVE_ASSET]')
    : fallbackAccount(input.accountMap.derivative_liability, '[DERIVATIVE_LIABILITY]')
  return line(
    input,
    row.designationId,
    'MTM_Adjustment',
    account,
    row.amountUsd >= 0 ? debit(row.amountUsd) : credit(row.amountUsd),
    row.derivativeBalanceAfterUsd,
    `Derivative carrying-value movement from ${row.sourceEventRef ?? row.id}`,
    'ASC 815: derivative recorded at fair value from accounting ledger movement',
    'HEDGE-MTM',
  )
}

function settlementLines(input: LedgerJournalInput, row: DerivativeAccountingLedgerRow): LedgerJournalLine[] {
  const settlementAccount = fallbackAccount(input.accountMap.settlement_account, '[SETTLEMENT_ACCOUNT]')
  const derivativeAsset = fallbackAccount(input.accountMap.derivative_asset, '[DERIVATIVE_ASSET]')
  const derivativeLiability = fallbackAccount(input.accountMap.derivative_liability, '[DERIVATIVE_LIABILITY]')
  const memo = `Derivative carrying value cleared from ${row.sourceEventRef ?? row.id}`

  if (row.amountUsd < 0) {
    return [
      line(input, row.designationId, 'Settlement', settlementAccount, debit(row.amountUsd), row.derivativeBalanceAfterUsd, memo, 'ASC 815: clear derivative asset on settlement', 'HEDGE-SETL'),
      line(input, row.designationId, 'Settlement', derivativeAsset, credit(row.amountUsd), row.derivativeBalanceAfterUsd, memo, 'ASC 815: clear derivative asset on settlement', 'HEDGE-SETL'),
    ]
  }

  return [
    line(input, row.designationId, 'Settlement', derivativeLiability, debit(row.amountUsd), row.derivativeBalanceAfterUsd, memo, 'ASC 815: clear derivative liability on settlement', 'HEDGE-SETL'),
    line(input, row.designationId, 'Settlement', settlementAccount, credit(row.amountUsd), row.derivativeBalanceAfterUsd, memo, 'ASC 815: clear derivative liability on settlement', 'HEDGE-SETL'),
  ]
}

function aociDeferLine(input: LedgerJournalInput, row: AociLedgerRow): LedgerJournalLine {
  const account = fallbackAccount(input.accountMap.aoci_cf_reserve, '[AOCI_CF_RESERVE]')
  return line(
    input,
    row.designationId,
    'MTM_Adjustment',
    account,
    row.amountUsd >= 0 ? credit(row.amountUsd) : debit(row.amountUsd),
    row.balanceAfterUsd,
    `AOCI reserve movement from ${row.sourceEventRef ?? row.id}`,
    'ASC 815-30: effective cash-flow hedge movement recorded in AOCI',
    'HEDGE-MTM',
  )
}

function aociReleaseLines(
  input: LedgerJournalInput,
  row: AociLedgerRow,
  entryType: 'OCI_Reclassification' | 'Forecast_Failure',
  target: HedgeAccountingAccountCode,
  note: string,
): LedgerJournalLine[] {
  const aociAccount = fallbackAccount(input.accountMap.aoci_cf_reserve, '[AOCI_CF_RESERVE]')
  const memo = `AOCI release from ${row.sourceEventRef ?? row.id}`
  const refPrefix = entryType === 'OCI_Reclassification' ? 'HEDGE-RECLASS' : 'HEDGE-FAILED'

  if (row.amountUsd < 0) {
    return [
      line(input, row.designationId, entryType, aociAccount, debit(row.amountUsd), row.balanceAfterUsd, memo, note, refPrefix),
      line(input, row.designationId, entryType, target, credit(row.amountUsd), row.balanceAfterUsd, memo, note, refPrefix),
    ]
  }

  return [
    line(input, row.designationId, entryType, target, debit(row.amountUsd), row.balanceAfterUsd, memo, note, refPrefix),
    line(input, row.designationId, entryType, aociAccount, credit(row.amountUsd), row.balanceAfterUsd, memo, note, refPrefix),
  ]
}

export function generateLedgerJournalLines(input: LedgerJournalInput): LedgerJournalLine[] {
  const lines: LedgerJournalLine[] = []

  for (const row of input.derivativeRows) {
    if (row.period !== input.period) continue

    if (row.eventType === 'mtm_to_fair_value') {
      lines.push(derivativeMtmLine(input, row))
    } else if (
      row.eventType === 'partial_settlement'
      || row.eventType === 'full_settlement'
      || row.eventType === 'early_close'
    ) {
      lines.push(...settlementLines(input, row))
    }
  }

  for (const row of input.aociRows) {
    if (row.period !== input.period) continue

    if (row.eventType === 'defer') {
      lines.push(aociDeferLine(input, row))
    } else if (row.eventType === 'reclassify') {
      lines.push(...aociReleaseLines(
        input,
        row,
        'OCI_Reclassification',
        fallbackAccount(input.accountMap.reclassification_target, '[RECLASSIFICATION_TARGET]'),
        'ASC 815-30: reclassify AOCI when the hedged item affects earnings',
      ))
    } else if (row.eventType === 'forecast_failed') {
      lines.push(...aociReleaseLines(
        input,
        row,
        'Forecast_Failure',
        fallbackAccount(input.accountMap.realized_gl, '[REALIZED_GL]'),
        'ASC 815-30: release AOCI to earnings when the forecast transaction is probable not to occur',
      ))
    }
  }

  return lines
}
