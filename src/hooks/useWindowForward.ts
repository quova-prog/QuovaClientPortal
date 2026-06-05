import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'

// Window-forward data layer (Phase 2). Booking and draws both go through
// SECURITY DEFINER RPCs — the client never inserts window_forward rows or
// draws directly (RLS blocks it), and never supplies draw_rate or P&L
// (the server computes them).

export interface WindowDraw {
  id: string
  position_id: string
  draw_seq: number
  draw_date: string
  draw_amount: number
  draw_rate: number
  spot_rate_at_draw: number
  settlement_quote: number
  realized_pnl_quote: number
  realized_pnl_usd: number
  is_final_settlement: boolean
  bank_confirmation: string | null
  reference_number: string | null
  notes: string | null
  created_at: string
}

export interface DrawAllocationInput {
  exposure_id?: string
  derived_source?: string
  derived_ref?: string
  allocated_amount: number
}

export interface RecordDrawInput {
  drawDate: string
  drawAmount: number
  bankConfirmation?: string
  referenceNumber?: string
  notes?: string
  allocations?: DrawAllocationInput[]
}

export interface DrawEconomics {
  draw_id: string
  draw_seq: number
  draw_rate: number
  spot_rate_at_draw: number
  settlement_quote: number
  realized_pnl_quote: number
  realized_pnl_usd: number
  remaining_after: number
}

export interface BookWindowForwardInput {
  currencyPair: string
  direction: 'buy' | 'sell'
  notionalBase: number
  windowStart: string
  windowEnd: string
  contractedRate: number
  tradeDate: string
  counterpartyBank?: string
  referenceNumber?: string
  hedgeType?: string
  notes?: string
}

/** Booking path for window forwards — calls book_window_forward(). */
export function useWindowForwardBooking() {
  const { db } = useAuth()

  const bookWindowForward = useCallback(
    async (input: BookWindowForwardInput): Promise<{ positionId?: string; error?: string }> => {
      const { data, error } = await db.rpc('book_window_forward', {
        p_currency_pair: input.currencyPair,
        p_direction: input.direction,
        p_notional_base: input.notionalBase,
        p_window_start: input.windowStart,
        p_window_end: input.windowEnd,
        p_contracted_rate: input.contractedRate,
        p_trade_date: input.tradeDate,
        p_counterparty_bank: input.counterpartyBank ?? null,
        p_reference_number: input.referenceNumber ?? null,
        p_hedge_type: input.hedgeType ?? 'cash_flow',
        p_notes: input.notes ?? null,
      })
      if (error) return { error: error.message }
      return { positionId: data as unknown as string }
    },
    [db],
  )

  return { bookWindowForward }
}

/** Draw ledger + record-a-draw for a single window-forward position. */
export function useWindowDraws(positionId: string | null) {
  const { db } = useAuth()
  const [draws, setDraws] = useState<WindowDraw[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!positionId) { setDraws([]); setLoading(false); return }
    setLoading(true)
    const { data } = await db
      .from('hedge_position_draws')
      .select('*')
      .eq('position_id', positionId)
      .order('draw_seq', { ascending: true })
    setDraws((data ?? []) as unknown as WindowDraw[])
    setLoading(false)
  }, [db, positionId])

  useEffect(() => { refresh() }, [refresh])

  const recordDraw = useCallback(
    async (input: RecordDrawInput): Promise<{ economics?: DrawEconomics; error?: string }> => {
      if (!positionId) return { error: 'No position selected' }
      const { data, error } = await db.rpc('record_window_draw', {
        p_position_id: positionId,
        p_draw_date: input.drawDate,
        p_draw_amount: input.drawAmount,
        p_bank_confirmation: input.bankConfirmation ?? null,
        p_reference_number: input.referenceNumber ?? null,
        p_notes: input.notes ?? null,
        p_allocations: input.allocations ?? null,
        p_is_final: false,
      })
      if (error) return { error: error.message }
      await refresh()
      return { economics: data as unknown as DrawEconomics }
    },
    [db, positionId, refresh],
  )

  return { draws, loading, refresh, recordDraw }
}
