type HedgeAccountingFramework = 'asc815' | 'ifrs9'
type HedgeDesignationType = 'cash_flow' | 'fair_value' | 'net_investment'
type HedgeAccountingStatus = 'preparatory' | 'designated' | 'dedesignated' | 'disqualified'
type ProbabilityStatus = 'probable' | 'no_longer_probable_still_expected' | 'probable_not_to_occur'
type FairValueSource = 'quova_indicative' | 'bank_mtm'
type FairValueHierarchy = 'level_1' | 'level_2_bank' | 'level_2_indicative' | 'level_3'
type EffectivenessMethod = 'critical_terms' | 'dollar_offset' | 'regression'
type EffectivenessVerdict = 'effective' | 'ineffective' | 'inconclusive'

type DerivativeAccountingEventType =
  | 'mtm_to_fair_value'
  | 'partial_settlement'
  | 'full_settlement'
  | 'early_close'
  | 'excluded_component_amortization'

type AociLedgerEventType =
  | 'defer'
  | 'reclassify'
  | 'ifrs9_ineffective_to_earnings'
  | 'forecast_failed'
  | 'dedesignate'
  | 'cost_of_hedging'

type CloseAccountingRpcName =
  | 'append_fair_value_measurement'
  | 'append_derivative_accounting_entry'
  | 'append_effectiveness_assessment'
  | 'append_aoci_ledger_entry'
  | 'set_accounting_period_status'

interface SupabaseError {
  message?: string
}

interface SupabaseResponse<T> {
  data: T | null
  error: SupabaseError | null
}

interface QueryLike<T> extends PromiseLike<SupabaseResponse<T>> {
  select(...args: unknown[]): QueryLike<T>
  eq(...args: unknown[]): QueryLike<T>
  lt(...args: unknown[]): QueryLike<T>
  in(...args: unknown[]): QueryLike<T>
  order(...args: unknown[]): QueryLike<T>
}

interface CloseAccountingSupabaseClient {
  from<T = unknown[]>(table: string): QueryLike<T>
  rpc(fn: string, args: Record<string, unknown>): Promise<SupabaseResponse<unknown>>
}

interface CloseFairValueInput {
  fairValueUsd: number
  source: FairValueSource
  fairValueHierarchy: FairValueHierarchy
  valuationProvider?: string | null
  sourceDocumentRef?: string | null
  spot?: number | null
  forwardRate?: number | null
  inputs?: Record<string, unknown>
}

interface CloseEffectivenessInput {
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

interface CloseReclassificationInput {
  hedgedItemId: string
  affectsEarningsOn: string | null
  aociAmountUsd: number
}

interface DerivativeSettlementInput {
  drawId: string | null
  eventType: 'partial_settlement' | 'full_settlement' | 'early_close'
  settledNotionalBase: number
  sourceEventRef?: string
}

interface CloseDesignationInput {
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

interface CloseAccountingPeriodInput {
  period: string
  designations: CloseDesignationInput[]
}

interface CloseAccountingRpcCall {
  fn: CloseAccountingRpcName
  args: Record<string, unknown>
}

interface CloseAccountingRepository {
  loadCloseInput(period: string): Promise<CloseAccountingPeriodInput>
  rpc(fn: CloseAccountingRpcName, args: Record<string, unknown>): Promise<unknown>
}

interface RawPositionRow {
  id: string
  notional_base: number | string | null
}

interface RawDesignationRow {
  id: string
  position_id: string
  designation_type: string
  framework: string
  accounting_status: string
  probability_status: string
  assessment_method: string | null
  hedge_positions: RawPositionRow | RawPositionRow[] | null
}

interface RawDerivativeLedgerRow {
  designation_id: string
  derivative_balance_after_usd: number | string | null
  period: string
  created_at: string
}

interface RawAociLedgerRow {
  designation_id: string
  balance_after_usd: number | string | null
  period: string
  created_at: string
}

interface RawDrawRow {
  id: string
  position_id: string
  draw_date: string
  draw_amount: number | string | null
  is_final_settlement: boolean | null
}

export interface CloseDesignationPeriodInput {
  fairValue: CloseFairValueInput
  effectiveness: CloseEffectivenessInput
  reclassifications?: CloseReclassificationInput[]
}

export interface CloseAccountingPeriodResult {
  period: string
  callCount: number
}

function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function numeric(value: number | string | null | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return 0
}

function firstPosition(row: RawDesignationRow): RawPositionRow | null {
  if (Array.isArray(row.hedge_positions)) return row.hedge_positions[0] ?? null
  return row.hedge_positions
}

function assertPeriod(period: string): void {
  if (!/^[0-9]{4}-[0-9]{2}$/.test(period)) {
    throw new Error(`Invalid accounting period ${period}`)
  }
}

function periodBounds(period: string): { start: string; nextStart: string } {
  assertPeriod(period)
  const [yearText, monthText] = period.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  if (month < 1 || month > 12) throw new Error(`Invalid accounting period ${period}`)

  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return {
    start: `${period}-01`,
    nextStart: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
  }
}

function latestByPeriod<T extends { designation_id: string; period: string; created_at: string }>(
  rows: T[],
): Map<string, T> {
  const sorted = [...rows].sort((a, b) => {
    if (a.period !== b.period) return b.period.localeCompare(a.period)
    return b.created_at.localeCompare(a.created_at)
  })
  const latest = new Map<string, T>()
  for (const row of sorted) {
    if (!latest.has(row.designation_id)) latest.set(row.designation_id, row)
  }
  return latest
}

function groupDrawsByPosition(rows: RawDrawRow[]): Map<string, RawDrawRow[]> {
  const byPosition = new Map<string, RawDrawRow[]>()
  for (const row of rows) {
    const existing = byPosition.get(row.position_id) ?? []
    existing.push(row)
    byPosition.set(row.position_id, existing)
  }
  return byPosition
}

async function expectRows<T>(query: PromiseLike<SupabaseResponse<T[]>>, context: string): Promise<T[]> {
  const { data, error } = await query
  if (error) throw new Error(`${context}: ${error.message ?? 'Supabase query failed'}`)
  return data ?? []
}

function isInPeriod(date: string | null, period: string): boolean {
  return date !== null && date.slice(0, 7) === period
}

function computeDerivativeAccountingEntries(input: {
  period: string
  designationId: string
  positionId: string
  previousDerivativeBalanceUsd: number
  currentFairValueUsd: number
  totalDesignatedNotionalBase: number
  previouslySettledNotionalBase: number
  settlements: DerivativeSettlementInput[]
  fairValueMeasurementId?: string
}): Array<{
  period: string
  designationId: string
  positionId: string
  drawId: string | null
  eventType: DerivativeAccountingEventType
  amountUsd: number
  derivativeBalanceAfterUsd: number
  fairValueMeasurementId: string | null
  sourceEventRef: string | null
}> {
  if (input.totalDesignatedNotionalBase <= 0) {
    throw new Error('Total designated notional must be positive')
  }
  if (input.previouslySettledNotionalBase < 0) {
    throw new Error('Previously settled notional cannot be negative')
  }
  if (input.previouslySettledNotionalBase > input.totalDesignatedNotionalBase) {
    throw new Error('Previously settled notional exceeds total designated notional')
  }

  const entries = []
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
    eventType: 'mtm_to_fair_value' as const,
    amountUsd: mtmAmount,
    derivativeBalanceAfterUsd: carryingBalance,
    fairValueMeasurementId,
    sourceEventRef: fairValueMeasurementId ? `fair_value:${fairValueMeasurementId}` : null,
  })

  return entries
}

function computeAsc815CashFlowHedgeAociEntries(input: {
  period: string
  designationId: string
  previousAociBalanceUsd: number
  derivativeFairValueChangeUsd: number
  accountingStatus: HedgeAccountingStatus
  probabilityStatus: ProbabilityStatus
  reclassifications: CloseReclassificationInput[]
}): Array<{
  period: string
  designationId: string
  hedgedItemId: string | null
  eventType: AociLedgerEventType
  bucket: 'aoci_cf' | 'cta'
  amountUsd: number
  balanceAfterUsd: number
  sourceEventRef: string | null
}> {
  const entries = []
  let balance = roundCents(input.previousAociBalanceUsd)

  if (input.probabilityStatus === 'probable_not_to_occur') {
    if (balance === 0) return []

    entries.push({
      period: input.period,
      designationId: input.designationId,
      hedgedItemId: null,
      eventType: 'forecast_failed' as const,
      bucket: 'aoci_cf' as const,
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
      eventType: 'defer' as const,
      bucket: 'aoci_cf' as const,
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
      eventType: 'reclassify' as const,
      bucket: 'aoci_cf' as const,
      amountUsd,
      balanceAfterUsd: balance,
      sourceEventRef: `hedged_item:${item.hedgedItemId}:affects_earnings`,
    })
  }

  return entries
}

function buildCloseAccountingPeriodPlan(input: CloseAccountingPeriodInput): { period: string; calls: CloseAccountingRpcCall[] } {
  const calls: CloseAccountingRpcCall[] = []

  for (const designation of input.designations) {
    if (designation.framework !== 'asc815' || designation.designationType !== 'cash_flow') {
      throw new Error('closeAccountingPeriod currently only supports ASC 815 cash-flow hedge designations')
    }

    calls.push({
      fn: 'append_fair_value_measurement',
      args: {
        p_designation_id: designation.designationId,
        p_period: input.period,
        p_fair_value_usd: designation.fairValue.fairValueUsd,
        p_source: designation.fairValue.source,
        p_fair_value_hierarchy: designation.fairValue.fairValueHierarchy,
        p_valuation_provider: designation.fairValue.valuationProvider ?? null,
        p_source_document_ref: designation.fairValue.sourceDocumentRef ?? null,
        p_spot: designation.fairValue.spot ?? null,
        p_forward_rate: designation.fairValue.forwardRate ?? null,
        p_inputs: designation.fairValue.inputs ?? {},
      },
    })

    for (const entry of computeDerivativeAccountingEntries({
      period: input.period,
      designationId: designation.designationId,
      positionId: designation.positionId,
      previousDerivativeBalanceUsd: designation.previousDerivativeBalanceUsd,
      currentFairValueUsd: designation.currentFairValueUsd,
      totalDesignatedNotionalBase: designation.totalDesignatedNotionalBase,
      previouslySettledNotionalBase: designation.previouslySettledNotionalBase,
      settlements: designation.settlements,
    })) {
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

    calls.push({
      fn: 'append_effectiveness_assessment',
      args: {
        p_designation_id: designation.designationId,
        p_period: input.period,
        p_framework: designation.framework,
        p_method: designation.effectiveness.method,
        p_verdict: designation.effectiveness.verdict,
        p_rationale: designation.effectiveness.rationale,
        p_actual_derivative_fv: designation.effectiveness.actualDerivativeFv ?? null,
        p_hypothetical_derivative_fv: designation.effectiveness.hypotheticalDerivativeFv ?? null,
        p_dollar_offset_ratio: designation.effectiveness.dollarOffsetRatio ?? null,
        p_regression_r2: designation.effectiveness.regressionR2 ?? null,
        p_regression_slope: designation.effectiveness.regressionSlope ?? null,
        p_ifrs9_economic_relationship: designation.effectiveness.ifrs9EconomicRelationship ?? null,
        p_ifrs9_hedge_ratio: designation.effectiveness.ifrs9HedgeRatio ?? null,
        p_credit_risk_dominates: designation.effectiveness.creditRiskDominates ?? null,
      },
    })

    for (const entry of computeAsc815CashFlowHedgeAociEntries({
      period: input.period,
      designationId: designation.designationId,
      previousAociBalanceUsd: designation.previousAociBalanceUsd,
      derivativeFairValueChangeUsd: designation.currentFairValueUsd - designation.previousDerivativeBalanceUsd,
      accountingStatus: designation.accountingStatus,
      probabilityStatus: designation.probabilityStatus,
      reclassifications: designation.reclassifications,
    })) {
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

  return { period: input.period, calls }
}

function asDesignationType(value: string): HedgeDesignationType {
  if (value !== 'cash_flow') throw new Error(`Unsupported designation type ${value}`)
  return value
}

function asFramework(value: string): HedgeAccountingFramework {
  if (value !== 'asc815') throw new Error(`Unsupported hedge accounting framework ${value}`)
  return value
}

function asAccountingStatus(value: string): HedgeAccountingStatus {
  if (value !== 'designated') throw new Error(`Unsupported accounting status ${value}`)
  return value
}

function asProbabilityStatus(value: string): ProbabilityStatus {
  if (
    value !== 'probable'
    && value !== 'no_longer_probable_still_expected'
    && value !== 'probable_not_to_occur'
  ) {
    throw new Error(`Unsupported probability status ${value}`)
  }
  return value
}

export function createSupabaseCloseAccountingRepository(options: {
  db: CloseAccountingSupabaseClient
  orgId: string
  inputsByDesignationId: Record<string, CloseDesignationPeriodInput>
}): CloseAccountingRepository {
  const { db, orgId, inputsByDesignationId } = options

  return {
    async loadCloseInput(period: string): Promise<CloseAccountingPeriodInput> {
      const { start, nextStart } = periodBounds(period)
      const designations = await expectRows<RawDesignationRow>(
        db
          .from<RawDesignationRow[]>('hedge_designations')
          .select(`
            id,
            position_id,
            designation_type,
            framework,
            accounting_status,
            probability_status,
            assessment_method,
            hedge_positions (
              id,
              notional_base
            )
          `)
          .eq('org_id', orgId)
          .eq('accounting_status', 'designated')
          .eq('designation_type', 'cash_flow')
          .eq('framework', 'asc815')
          .order('created_at', { ascending: true }),
        'load hedge designations',
      )

      if (designations.length === 0) return { period, designations: [] }

      const designationIds = designations.map((row) => row.id)
      const positionIds = designations.map((row) => row.position_id)
      const [derivativeRows, aociRows, drawRows] = await Promise.all([
        expectRows<RawDerivativeLedgerRow>(
          db
            .from<RawDerivativeLedgerRow[]>('derivative_accounting_ledger')
            .select('designation_id, derivative_balance_after_usd, period, created_at')
            .eq('org_id', orgId)
            .lt('period', period)
            .in('designation_id', designationIds)
            .order('period', { ascending: false })
            .order('created_at', { ascending: false }),
          'load derivative accounting balances',
        ),
        expectRows<RawAociLedgerRow>(
          db
            .from<RawAociLedgerRow[]>('aoci_ledger')
            .select('designation_id, balance_after_usd, period, created_at')
            .eq('org_id', orgId)
            .lt('period', period)
            .in('designation_id', designationIds)
            .order('period', { ascending: false })
            .order('created_at', { ascending: false }),
          'load AOCI balances',
        ),
        expectRows<RawDrawRow>(
          db
            .from<RawDrawRow[]>('hedge_position_draws')
            .select('id, position_id, draw_date, draw_amount, is_final_settlement')
            .eq('org_id', orgId)
            .lt('draw_date', nextStart)
            .in('position_id', positionIds)
            .order('draw_date', { ascending: true })
            .order('created_at', { ascending: true }),
          'load window-forward draws',
        ),
      ])

      const latestDerivative = latestByPeriod(derivativeRows)
      const latestAoci = latestByPeriod(aociRows)
      const drawsByPosition = groupDrawsByPosition(drawRows)

      return {
        period,
        designations: designations.map((designation) => {
          const supplied = inputsByDesignationId[designation.id]
          if (!supplied?.fairValue) {
            throw new Error(`Close input missing fair value for designation ${designation.id}`)
          }
          if (!supplied.effectiveness) {
            throw new Error(`Close input missing effectiveness assessment for designation ${designation.id}`)
          }

          const position = firstPosition(designation)
          const positionDraws = drawsByPosition.get(designation.position_id) ?? []
          const priorDraws = positionDraws.filter((row) => row.draw_date < start)
          const currentDraws = positionDraws.filter((row) => row.draw_date >= start)

          return {
            designationId: designation.id,
            positionId: designation.position_id,
            designationType: asDesignationType(designation.designation_type),
            framework: asFramework(designation.framework),
            accountingStatus: asAccountingStatus(designation.accounting_status),
            probabilityStatus: asProbabilityStatus(designation.probability_status),
            previousDerivativeBalanceUsd: numeric(
              latestDerivative.get(designation.id)?.derivative_balance_after_usd,
            ),
            currentFairValueUsd: supplied.fairValue.fairValueUsd,
            totalDesignatedNotionalBase: numeric(position?.notional_base),
            previouslySettledNotionalBase: priorDraws.reduce(
              (total, row) => total + numeric(row.draw_amount),
              0,
            ),
            previousAociBalanceUsd: numeric(latestAoci.get(designation.id)?.balance_after_usd),
            settlements: currentDraws.map((row) => ({
              drawId: row.id,
              eventType: row.is_final_settlement ? 'full_settlement' as const : 'partial_settlement' as const,
              settledNotionalBase: numeric(row.draw_amount),
              sourceEventRef: `draw:${row.id}`,
            })),
            fairValue: supplied.fairValue,
            effectiveness: supplied.effectiveness,
            reclassifications: supplied.reclassifications ?? [],
          }
        }),
      }
    },

    async rpc(fn, args): Promise<unknown> {
      const { data, error } = await db.rpc(fn, args)
      if (error) throw new Error(error.message ?? `${fn} failed`)
      return data
    },
  }
}

export async function closeAccountingPeriod(
  repository: CloseAccountingRepository,
  period: string,
): Promise<CloseAccountingPeriodResult> {
  const closeInput = await repository.loadCloseInput(period)
  if (closeInput.period !== period) {
    throw new Error(`Loaded close input period ${closeInput.period} does not match requested period ${period}`)
  }

  const plan = buildCloseAccountingPeriodPlan(closeInput)
  const fairValueMeasurementIds = new Map<string, string>()

  for (const call of plan.calls) {
    const args = { ...call.args }
    if (call.fn === 'append_derivative_accounting_entry') {
      const designationId = String(args.p_designation_id ?? '')
      const fairValueMeasurementId = fairValueMeasurementIds.get(designationId)
      if (!args.p_fair_value_measurement_id && fairValueMeasurementId) {
        args.p_fair_value_measurement_id = fairValueMeasurementId
        args.p_source_event_ref ??= `fair_value:${fairValueMeasurementId}`
      }
    }

    try {
      const result = await repository.rpc(call.fn, args)
      if (call.fn === 'append_fair_value_measurement' && typeof result === 'string') {
        const designationId = String(args.p_designation_id ?? '')
        if (designationId) fairValueMeasurementIds.set(designationId, result)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${call.fn} failed: ${message}`)
    }
  }

  return { period: plan.period, callCount: plan.calls.length }
}
