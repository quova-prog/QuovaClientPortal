import { describe, it, expect } from 'vitest'
import { effectiveHedgedNotional, windowForwardMtm } from './windowForward'
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

describe('windowForwardMtm', () => {
  // EUR/USD: USD is the quote ccy so MTM is already in USD (toUsd passthrough).
  const rates = { 'EUR/USD': 1.10, 'USD/CAD': 1.36, 'GBP/USD': 1.27 }

  function wf(overrides: Partial<HedgePosition>): HedgePosition {
    return pos({
      instrument_type: 'window_forward', pricing_method: 'fixed_worst_rate',
      currency_pair: 'EUR/USD', base_currency: 'EUR', quote_currency: 'USD',
      direction: 'sell', notional_base: 1_000_000, contracted_rate: 1.09,
      window_start_date: '2026-05-01', window_end_date: '2026-06-30',
      ...overrides,
    })
  }

  it('fully-undrawn window MTM equals the equivalent vanilla forward MTM', () => {
    // sell 1m EUR at 1.09, current 1.10 → loss of (1.09-1.10)*1m = -10,000 USD
    const m = windowForwardMtm(wf({ drawn_notional: 0 }), [], rates)
    expect(m.remaining).toBe(1_000_000)
    expect(m.floatingMtmUsd).toBeCloseTo(-10_000, 6)
    expect(m.realizedUsd).toBe(0)
  })

  it('fully-drawn window has zero floating MTM and surfaces stored realized P&L', () => {
    const m = windowForwardMtm(
      wf({ drawn_notional: 1_000_000 }),
      [{ realized_pnl_usd: 4200 }, { realized_pnl_usd: -1500 }],
      rates,
    )
    expect(m.remaining).toBe(0)
    expect(m.floatingMtmUsd).toBe(0)
    expect(m.realizedUsd).toBeCloseTo(2700, 6)
  })

  it('partial draw reduces floating MTM proportionally to remaining notional', () => {
    const m = windowForwardMtm(wf({ drawn_notional: 600_000 }), [{ realized_pnl_usd: 0 }], rates)
    expect(m.remaining).toBe(400_000)
    // (1.09-1.10)*400k = -4,000 USD
    expect(m.floatingMtmUsd).toBeCloseTo(-4000, 6)
  })

  it('buy direction flips the sign', () => {
    const m = windowForwardMtm(wf({ direction: 'buy', drawn_notional: 0 }), [], rates)
    // buy 1m EUR at 1.09, current 1.10 → gain of (1.10-1.09)*1m = +10,000 USD
    expect(m.floatingMtmUsd).toBeCloseTo(10_000, 6)
  })

  it('converts a non-USD quote currency to USD (USD/CAD: quote CAD)', () => {
    // sell 1m USD vs CAD at 1.35, current 1.36 → (1.35-1.36)*1m = -10,000 CAD
    // CAD→USD via USD/CAD=1.36 (inverse) → -10,000 / 1.36 ≈ -7,352.94 USD
    const p = wf({
      currency_pair: 'USD/CAD', base_currency: 'USD', quote_currency: 'CAD',
      contracted_rate: 1.35, direction: 'sell', drawn_notional: 0,
    })
    const m = windowForwardMtm(p, [], rates)
    expect(m.floatingMtmUsd).toBeCloseTo(-10_000 / 1.36, 4)
  })
})
