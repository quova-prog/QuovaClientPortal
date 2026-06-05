import {
  computeAsc815CashFlowHedgeAociEntries,
  computeDerivativeAccountingEntries,
  type DerivativeSettlementInput,
} from './engine'
import type {
  FairValueHierarchy,
  FairValueSource,
  HedgeAccountingFramework,
  HedgeAccountingStatus,
  HedgeDesignationType,
  ProbabilityStatus,
} from './types'

export type EffectivenessMethod = 'critical_terms' | 'dollar_offset' | 'regression'
export type EffectivenessVerdict = 'effective' | 'ineffective' | 'inconclusive'

export type CloseAccountingRpcName =
  | 'append_fair_value_measurement'
  | 'append_derivative_accounting_entry'
  | 'append_effectiveness_assessment'
  | 'append_aoci_ledger_entry'
  | 'set_accounting_period_status'

export interface CloseAccountingRpcCall {
  fn: CloseAccountingRpcName
  args: Record<string, unknown>
}

export interface CloseFairValueInput {
  fairValueUsd: number
  source: FairValueSource
  fairValueHierarchy: FairValueHierarchy
  valuationProvider?: string | null
  sourceDocumentRef?: string | null
  spot?: number | null
  forwardRate?: number | null
  inputs?: Record<string, unknown>
}

export interface CloseEffectivenessInput {
  method: EffectivenessMethod
  verdict: EffectivenessVerdict
  rationale: string
  actualDerivativeFv?: number | null
  hypotheticalDerivativeFv?: number | null
  dollarOffsetRatio?: number | null
  regressionR2?: number | null
  regressionSlope?: number | null
  ifrs9EconomicRelationship?: boolean | null
  ifrs9HedgeRatio?: string | null
  creditRiskDominates?: boolean | null
}

export interface CloseReclassificationInput {
  hedgedItemId: string
  affectsEarningsOn: string | null
  aociAmountUsd: number
}

export interface CloseDesignationInput {
  designationId: string
  positionId: string
  designationType: HedgeDesignationType
  framework: HedgeAccountingFramework
  accountingStatus: HedgeAccountingStatus
  probabilityStatus: ProbabilityStatus
  previousDerivativeBalanceUsd: number
  currentFairValueUsd: number
  totalDesignatedNotionalBase: number
  previouslySettledNotionalBase: number
  previousAociBalanceUsd: number
  settlements: DerivativeSettlementInput[]
  fairValue: CloseFairValueInput
  effectiveness: CloseEffectivenessInput
  reclassifications: CloseReclassificationInput[]
}

export interface CloseAccountingPeriodInput {
  period: string
  designations: CloseDesignationInput[]
}

export interface CloseAccountingPeriodPlan {
  period: string
  calls: CloseAccountingRpcCall[]
}

function assertSupportedDesignation(input: CloseDesignationInput): void {
  if (input.framework !== 'asc815' || input.designationType !== 'cash_flow') {
    throw new Error('closeAccountingPeriod currently only supports ASC 815 cash-flow hedge designations')
  }
}

function buildFairValueCall(period: string, input: CloseDesignationInput): CloseAccountingRpcCall {
  return {
    fn: 'append_fair_value_measurement',
    args: {
      p_designation_id: input.designationId,
      p_period: period,
      p_fair_value_usd: input.fairValue.fairValueUsd,
      p_source: input.fairValue.source,
      p_fair_value_hierarchy: input.fairValue.fairValueHierarchy,
      p_valuation_provider: input.fairValue.valuationProvider ?? null,
      p_source_document_ref: input.fairValue.sourceDocumentRef ?? null,
      p_spot: input.fairValue.spot ?? null,
      p_forward_rate: input.fairValue.forwardRate ?? null,
      p_inputs: input.fairValue.inputs ?? {},
    },
  }
}

function buildEffectivenessCall(period: string, input: CloseDesignationInput): CloseAccountingRpcCall {
  return {
    fn: 'append_effectiveness_assessment',
    args: {
      p_designation_id: input.designationId,
      p_period: period,
      p_framework: input.framework,
      p_method: input.effectiveness.method,
      p_verdict: input.effectiveness.verdict,
      p_rationale: input.effectiveness.rationale,
      p_actual_derivative_fv: input.effectiveness.actualDerivativeFv ?? null,
      p_hypothetical_derivative_fv: input.effectiveness.hypotheticalDerivativeFv ?? null,
      p_dollar_offset_ratio: input.effectiveness.dollarOffsetRatio ?? null,
      p_regression_r2: input.effectiveness.regressionR2 ?? null,
      p_regression_slope: input.effectiveness.regressionSlope ?? null,
      p_ifrs9_economic_relationship: input.effectiveness.ifrs9EconomicRelationship ?? null,
      p_ifrs9_hedge_ratio: input.effectiveness.ifrs9HedgeRatio ?? null,
      p_credit_risk_dominates: input.effectiveness.creditRiskDominates ?? null,
    },
  }
}

export function buildCloseAccountingPeriodPlan(input: CloseAccountingPeriodInput): CloseAccountingPeriodPlan {
  const calls: CloseAccountingRpcCall[] = []

  for (const designation of input.designations) {
    assertSupportedDesignation(designation)

    calls.push(buildFairValueCall(input.period, designation))

    const derivativeEntries = computeDerivativeAccountingEntries({
      period: input.period,
      designationId: designation.designationId,
      positionId: designation.positionId,
      previousDerivativeBalanceUsd: designation.previousDerivativeBalanceUsd,
      currentFairValueUsd: designation.currentFairValueUsd,
      totalDesignatedNotionalBase: designation.totalDesignatedNotionalBase,
      previouslySettledNotionalBase: designation.previouslySettledNotionalBase,
      settlements: designation.settlements,
    })
    for (const entry of derivativeEntries) {
      calls.push({
        fn: 'append_derivative_accounting_entry',
        args: {
          p_designation_id: entry.designationId,
          p_position_id: entry.positionId,
          p_draw_id: entry.drawId,
          p_period: entry.period,
          p_event_type: entry.eventType,
          p_amount_usd: entry.amountUsd,
          p_derivative_balance_after_usd: entry.derivativeBalanceAfterUsd,
          p_fair_value_measurement_id: entry.fairValueMeasurementId,
          p_source_event_ref: entry.sourceEventRef,
        },
      })
    }

    calls.push(buildEffectivenessCall(input.period, designation))

    const aociEntries = computeAsc815CashFlowHedgeAociEntries({
      period: input.period,
      designationId: designation.designationId,
      previousAociBalanceUsd: designation.previousAociBalanceUsd,
      derivativeFairValueChangeUsd: designation.currentFairValueUsd - designation.previousDerivativeBalanceUsd,
      accountingStatus: designation.accountingStatus,
      probabilityStatus: designation.probabilityStatus,
      reclassifications: designation.reclassifications,
    })
    for (const entry of aociEntries) {
      calls.push({
        fn: 'append_aoci_ledger_entry',
        args: {
          p_designation_id: entry.designationId,
          p_hedged_item_id: entry.hedgedItemId,
          p_period: entry.period,
          p_event_type: entry.eventType,
          p_bucket: entry.bucket,
          p_amount_usd: entry.amountUsd,
          p_balance_after_usd: entry.balanceAfterUsd,
          p_source_event_ref: entry.sourceEventRef,
        },
      })
    }
  }

  calls.push({
    fn: 'set_accounting_period_status',
    args: {
      p_period: input.period,
      p_status: 'closed',
    },
  })

  return {
    period: input.period,
    calls,
  }
}
