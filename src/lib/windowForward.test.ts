import { describe, it, expect } from 'vitest'
import { effectiveHedgedNotional } from './windowForward'
import type { HedgePosition } from '@/types'

// effectiveHedgedNotional is the single source of truth for "how much
// notional a hedge currently contributes to coverage". For window
// forwards, only the UNDRAWN residual counts (drawn slices have settled
// the underlying exposure and drop out); every other instrument
// contributes its full notional. This must agree with the SQL view's
// CASE expression — see _quova_transformation_plan window-forwards spec §5.1.

function pos(overrides: Partial<HedgePosition>): HedgePosition {
  return {
    id: 'p1', org_id: 'o1', entity_id: null, created_by: null,
    instrument_type: 'forward', hedge_type: 'cash_flow',
    currency_pair: 'EUR/USD', base_currency: 'EUR', quote_currency: 'USD',
    direction: 'sell', notional_base: 1_000_000, notional_usd: null,
    contracted_rate: 1.09, spot_rate_at_trade: null,
    trade_date: '2026-01-01', value_date: '2026-06-30',
    counterparty_bank: null, reference_number: null, status: 'active',
    notes: null, rolled_from_id: null, close_date: null, close_rate: null,
    amended_at: null, window_start_date: null, window_end_date: null,
    pricing_method: null, drawn_notional: 0,
    created_at: '2026-01-01', updated_at: '2026-01-01',
    ...overrides,
  }
}

describe('effectiveHedgedNotional', () => {
  it('returns full notional for a vanilla forward (drawn_notional ignored)', () => {
    expect(effectiveHedgedNotional(pos({ instrument_type: 'forward' }))).toBe(1_000_000)
  })

  it('returns full notional for swap/option/spot', () => {
    expect(effectiveHedgedNotional(pos({ instrument_type: 'swap' }))).toBe(1_000_000)
    expect(effectiveHedgedNotional(pos({ instrument_type: 'option' }))).toBe(1_000_000)
    expect(effectiveHedgedNotional(pos({ instrument_type: 'spot' }))).toBe(1_000_000)
  })

  it('returns full notional for a fully-undrawn window forward', () => {
    const p = pos({
      instrument_type: 'window_forward', pricing_method: 'fixed_worst_rate',
      window_start_date: '2026-05-01', window_end_date: '2026-06-30',
      drawn_notional: 0,
    })
    expect(effectiveHedgedNotional(p)).toBe(1_000_000)
  })

  it('returns the undrawn residual for a partially-drawn window forward', () => {
    const p = pos({
      instrument_type: 'window_forward', pricing_method: 'fixed_worst_rate',
      window_start_date: '2026-05-01', window_end_date: '2026-06-30',
      drawn_notional: 350_000,
    })
    expect(effectiveHedgedNotional(p)).toBe(650_000)
  })

  it('returns zero for a fully-drawn window forward', () => {
    const p = pos({
      instrument_type: 'window_forward', pricing_method: 'fixed_worst_rate',
      window_start_date: '2026-05-01', window_end_date: '2026-06-30',
      drawn_notional: 1_000_000,
    })
    expect(effectiveHedgedNotional(p)).toBe(0)
  })

  it('never returns negative even if drawn somehow exceeds notional', () => {
    const p = pos({
      instrument_type: 'window_forward', pricing_method: 'fixed_worst_rate',
      drawn_notional: 1_200_000,
    })
    expect(effectiveHedgedNotional(p)).toBe(0)
  })
})
