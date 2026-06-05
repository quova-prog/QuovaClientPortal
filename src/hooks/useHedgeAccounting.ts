import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import type {
  AociLedgerRow,
  DerivativeAccountingLedgerRow,
  LedgerJournalMetadata,
} from '@/lib/hedgeAccounting/journal'
import type {
  AociLedgerEventType,
  DerivativeAccountingEventType,
} from '@/lib/hedgeAccounting/engine'

interface RawDerivativeAccountingLedgerRow {
  id: string
  designation_id: string
  position_id: string
  draw_id: string | null
  period: string
  event_type: DerivativeAccountingEventType
  amount_usd: number | string | null
  derivative_balance_after_usd: number | string | null
  source_event_ref: string | null
}

interface RawAociLedgerRow {
  id: string
  designation_id: string
  hedged_item_id: string | null
  period: string
  event_type: AociLedgerEventType
  bucket: 'aoci_cf' | 'cta'
  amount_usd: number | string | null
  balance_after_usd: number | string | null
  source_event_ref: string | null
}

interface RawHedgePositionMetadata {
  id: string
  reference_number: string | null
  currency_pair: string | null
  instrument_type: string | null
  counterparty_bank: string | null
  value_date: string | null
  notional_base: number | string | null
  contracted_rate: number | string | null
  spot_rate_at_trade: number | string | null
}

interface RawDesignationMetadata {
  id: string
  designation_type: string
  position_id: string
  hedge_positions: RawHedgePositionMetadata | RawHedgePositionMetadata[] | null
}

export interface HedgeAccountingLedgers {
  derivativeRows: DerivativeAccountingLedgerRow[]
  aociRows: AociLedgerRow[]
  metadataByDesignationId: Record<string, LedgerJournalMetadata>
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

function numeric(value: number | string | null | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return 0
}

function firstPosition(
  value: RawHedgePositionMetadata | RawHedgePositionMetadata[] | null,
): RawHedgePositionMetadata | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

function mapDerivativeRow(row: RawDerivativeAccountingLedgerRow): DerivativeAccountingLedgerRow {
  return {
    id: row.id,
    designationId: row.designation_id,
    positionId: row.position_id,
    drawId: row.draw_id,
    period: row.period,
    eventType: row.event_type,
    amountUsd: numeric(row.amount_usd),
    derivativeBalanceAfterUsd: numeric(row.derivative_balance_after_usd),
    sourceEventRef: row.source_event_ref,
  }
}

function mapAociRow(row: RawAociLedgerRow): AociLedgerRow {
  return {
    id: row.id,
    designationId: row.designation_id,
    hedgedItemId: row.hedged_item_id,
    period: row.period,
    eventType: row.event_type,
    bucket: row.bucket,
    amountUsd: numeric(row.amount_usd),
    balanceAfterUsd: numeric(row.balance_after_usd),
    sourceEventRef: row.source_event_ref,
  }
}

function mapDesignationMetadata(row: RawDesignationMetadata): LedgerJournalMetadata {
  const position = firstPosition(row.hedge_positions)
  return {
    hedgeType: row.designation_type,
    positionId: row.position_id,
    referenceNumber: position?.reference_number ?? null,
    currencyPair: position?.currency_pair ?? null,
    instrumentType: position?.instrument_type ?? null,
    counterparty: position?.counterparty_bank ?? null,
    maturityDate: position?.value_date ?? null,
    notionalBase: numeric(position?.notional_base),
    contractedRate: numeric(position?.contracted_rate),
    spotRate: numeric(position?.spot_rate_at_trade),
  }
}

export function useHedgeAccountingLedgers(period: string): HedgeAccountingLedgers {
  const { user, db } = useAuth()
  const [derivativeRows, setDerivativeRows] = useState<DerivativeAccountingLedgerRow[]>([])
  const [aociRows, setAociRows] = useState<AociLedgerRow[]>([])
  const [metadataByDesignationId, setMetadataByDesignationId] = useState<Record<string, LedgerJournalMetadata>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const orgId = user?.profile?.org_id
    if (!orgId || !period) {
      setDerivativeRows([])
      setAociRows([])
      setMetadataByDesignationId({})
      setLoading(false)
      return
    }

    setLoading(true)
    const [derivativeResult, aociResult] = await Promise.all([
      db
        .from('derivative_accounting_ledger')
        .select('*')
        .eq('org_id', orgId)
        .eq('period', period)
        .order('created_at', { ascending: true }),
      db
        .from('aoci_ledger')
        .select('*')
        .eq('org_id', orgId)
        .eq('period', period)
        .order('created_at', { ascending: true }),
    ])

    if (derivativeResult.error || aociResult.error) {
      setError(derivativeResult.error?.message ?? aociResult.error?.message ?? 'Unable to load accounting ledgers')
      setDerivativeRows([])
      setAociRows([])
      setMetadataByDesignationId({})
      setLoading(false)
      return
    }

    const mappedDerivativeRows = ((derivativeResult.data ?? []) as RawDerivativeAccountingLedgerRow[])
      .map(mapDerivativeRow)
    const mappedAociRows = ((aociResult.data ?? []) as RawAociLedgerRow[])
      .map(mapAociRow)
    const designationIds = Array.from(new Set([
      ...mappedDerivativeRows.map((row) => row.designationId),
      ...mappedAociRows.map((row) => row.designationId),
    ]))

    let metadata: Record<string, LedgerJournalMetadata> = {}
    if (designationIds.length > 0) {
      const designationResult = await db
        .from('hedge_designations')
        .select(`
          id,
          designation_type,
          position_id,
          hedge_positions (
            id,
            reference_number,
            currency_pair,
            instrument_type,
            counterparty_bank,
            value_date,
            notional_base,
            contracted_rate,
            spot_rate_at_trade
          )
        `)
        .eq('org_id', orgId)
        .in('id', designationIds)

      if (designationResult.error) {
        setError(designationResult.error.message)
        setDerivativeRows([])
        setAociRows([])
        setMetadataByDesignationId({})
        setLoading(false)
        return
      }

      metadata = Object.fromEntries(
        ((designationResult.data ?? []) as RawDesignationMetadata[])
          .map((row) => [row.id, mapDesignationMetadata(row)] as const),
      )
    }

    setDerivativeRows(mappedDerivativeRows)
    setAociRows(mappedAociRows)
    setMetadataByDesignationId(metadata)
    setError(null)
    setLoading(false)
  }, [db, period, user?.profile?.org_id])

  useEffect(() => { refresh() }, [refresh])

  return {
    derivativeRows,
    aociRows,
    metadataByDesignationId,
    loading,
    error,
    refresh,
  }
}
