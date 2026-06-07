import type { HedgeAccountingStatus, ProbabilityStatus } from './types'

export type DerivativeAccountingEventType =
  | 'mtm_to_fair_value'
  | 'partial_settlement'
  | 'full_settlement'
  | 'early_close'
  | 'excluded_component_amortization'

export interface DerivativeSettlementInput {
  drawId: string | null
  eventType: Exclude<DerivativeAccountingEventType, 'mtm_to_fair_value' | 'excluded_component_amortization'>
  settledNotionalBase: number
  sourceEventRef?: string
}

export interface DerivativeAccountingInput {
  period: string
  designationId: string
  positionId: string
  previousDerivativeBalanceUsd: number
  currentFairValueUsd: number
  totalDesignatedNotionalBase: number
  previouslySettledNotionalBase: number
  settlements: DerivativeSettlementInput[]
  fairValueMeasurementId?: string
}

export interface DerivativeAccountingEntryDraft {
  period: string
  designationId: string
  positionId: string
  drawId: string | null
  eventType: DerivativeAccountingEventType
  amountUsd: number
  derivativeBalanceAfterUsd: number
  fairValueMeasurementId: string | null
  sourceEventRef: string | null
}

export type AociLedgerEventType =
  | 'defer'
  | 'reclassify'
  | 'ifrs9_ineffective_to_earnings'
  | 'forecast_failed'
  | 'dedesignate'
  | 'cost_of_hedging'

export interface AociReclassificationInput {
  hedgedItemId: string
  affectsEarningsOn: string | null
  aociAmountUsd: number
}

export interface Asc815CashFlowHedgeAociInput {
  period: string
  designationId: string
  previousAociBalanceUsd: number
  derivativeFairValueChangeUsd: number
  accountingStatus: HedgeAccountingStatus
  probabilityStatus: ProbabilityStatus
  reclassifications: AociReclassificationInput[]
}

export interface AociLedgerEntryDraft {
  period: string
  designationId: string
  hedgedItemId: string | null
  eventType: AociLedgerEventType
  bucket: 'aoci_cf' | 'cta'
  amountUsd: number
  balanceAfterUsd: number
  sourceEventRef: string | null
}

function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function isInPeriod(date: string | null, period: string): boolean {
  return date !== null && date.slice(0, 7) === period
}

export function computeDerivativeAccountingEntries(input: DerivativeAccountingInput): DerivativeAccountingEntryDraft[] {
  if (input.totalDesignatedNotionalBase <= 0) {
    throw new Error('Total designated notional must be positive')
  }
  if (input.previouslySettledNotionalBase < 0) {
    throw new Error('Previously settled notional cannot be negative')
  }
  if (input.previouslySettledNotionalBase > input.totalDesignatedNotionalBase) {
    throw new Error('Previously settled notional exceeds total designated notional')
  }

  const entries: DerivativeAccountingEntryDraft[] = []
  let carryingBalance = roundCents(input.previousDerivativeBalanceUsd)
  let settledNotional = input.previouslySettledNotionalBase
  const fairValueMeasurementId = input.fairValueMeasurementId ?? null

  for (const settlement of input.settlements) {
    if (settlement.settledNotionalBase <= 0) {
      throw new Error('Settlement notional must be positive')
    }

    const remainingBeforeSettlement = input.totalDesignatedNotionalBase - settledNotional
    if (settlement.settledNotionalBase > remainingBeforeSettlement) {
      throw new Error('Settlement notional exceeds remaining designated notional')
    }

    const settlesAllResidual = settlement.eventType === 'full_settlement'
      || settlement.eventType === 'early_close'
      || settlement.settledNotionalBase === remainingBeforeSettlement
    const carryingValueReleased = settlesAllResidual
      ? carryingBalance
      : roundCents(carryingBalance * (settlement.settledNotionalBase / remainingBeforeSettlement))
    const amountUsd = roundCents(-carryingValueReleased)
    carryingBalance = roundCents(carryingBalance + amountUsd)
    settledNotional += settlement.settledNotionalBase

    entries.push({
      period: input.period,
      designationId: input.designationId,
      positionId: input.positionId,
      drawId: settlement.drawId,
      eventType: settlement.eventType,
      amountUsd,
      derivativeBalanceAfterUsd: carryingBalance,
      fairValueMeasurementId,
      sourceEventRef: settlement.sourceEventRef ?? (settlement.drawId ? `draw:${settlement.drawId}` : null),
    })
  }

  const mtmAmount = roundCents(input.currentFairValueUsd - carryingBalance)
  carryingBalance = roundCents(input.currentFairValueUsd)
  entries.push({
    period: input.period,
    designationId: input.designationId,
    positionId: input.positionId,
    drawId: null,
    eventType: 'mtm_to_fair_value',
    amountUsd: mtmAmount,
    derivativeBalanceAfterUsd: carryingBalance,
    fairValueMeasurementId,
    sourceEventRef: fairValueMeasurementId ? `fair_value:${fairValueMeasurementId}` : null,
  })

  return entries
}

export function computeAsc815CashFlowHedgeAociEntries(input: Asc815CashFlowHedgeAociInput): AociLedgerEntryDraft[] {
  const entries: AociLedgerEntryDraft[] = []
  let balance = roundCents(input.previousAociBalanceUsd)

  if (input.probabilityStatus === 'probable_not_to_occur') {
    if (balance === 0) return []

    entries.push({
      period: input.period,
      designationId: input.designationId,
      hedgedItemId: null,
      eventType: 'forecast_failed',
      bucket: 'aoci_cf',
      amountUsd: roundCents(-balance),
      balanceAfterUsd: 0,
      sourceEventRef: 'forecast:probable_not_to_occur',
    })
    return entries
  }

  const canDeferNewMovements = input.accountingStatus === 'designated'
    && input.probabilityStatus === 'probable'

  if (canDeferNewMovements && input.derivativeFairValueChangeUsd !== 0) {
    const amountUsd = roundCents(input.derivativeFairValueChangeUsd)
    balance = roundCents(balance + amountUsd)
    entries.push({
      period: input.period,
      designationId: input.designationId,
      hedgedItemId: null,
      eventType: 'defer',
      bucket: 'aoci_cf',
      amountUsd,
      balanceAfterUsd: balance,
      sourceEventRef: 'asc815:cfh:defer',
    })
  }

  for (const item of input.reclassifications) {
    if (!isInPeriod(item.affectsEarningsOn, input.period)) continue

    const amountUsd = roundCents(-item.aociAmountUsd)
    balance = roundCents(balance + amountUsd)
    entries.push({
      period: input.period,
      designationId: input.designationId,
      hedgedItemId: item.hedgedItemId,
      eventType: 'reclassify',
      bucket: 'aoci_cf',
      amountUsd,
      balanceAfterUsd: balance,
      sourceEventRef: `hedged_item:${item.hedgedItemId}:affects_earnings`,
    })
  }

  return entries
}
