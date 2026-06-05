import type {
  CloseAccountingPeriodInput,
  CloseEffectivenessInput,
  CloseFairValueInput,
  CloseReclassificationInput,
} from './closePeriod'
import type { CloseAccountingRepository } from './closeRunner'
import type {
  HedgeAccountingFramework,
  HedgeAccountingStatus,
  HedgeDesignationType,
  ProbabilityStatus,
} from './types'

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

export interface CloseAccountingSupabaseClient {
  from<T = unknown[]>(table: string): QueryLike<T>
  rpc(fn: string, args: Record<string, unknown>): Promise<SupabaseResponse<unknown>>
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

export interface CreateSupabaseCloseAccountingRepositoryOptions {
  db: CloseAccountingSupabaseClient
  orgId: string
  inputsByDesignationId: Record<string, CloseDesignationPeriodInput>
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

export function createSupabaseCloseAccountingRepository(
  options: CreateSupabaseCloseAccountingRepositoryOptions,
): CloseAccountingRepository {
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

      if (designations.length === 0) {
        return { period, designations: [] }
      }

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
              eventType: row.is_final_settlement ? 'full_settlement' : 'partial_settlement',
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
