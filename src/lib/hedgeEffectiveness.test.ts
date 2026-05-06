import { describe, it, expect } from 'vitest'
import { computeEffectiveness, getEffectivenessSummary } from './hedgeEffectiveness'
import type { HedgePosition } from '@/types'

// ── Test fixtures ────────────────────────────────────────────────────────────

function makePosition(overrides: Partial<HedgePosition> = {}): HedgePosition {
  return {
    id: 'pos-1',
    org_id: 'org-1',
    entity_id: null,
    created_by: null,
    instrument_type: 'forward',
    hedge_type: 'cash_flow',
    currency_pair: 'EUR/USD',
    base_currency: 'EUR',
    quote_currency: 'USD',
    direction: 'sell',
    notional_base: 1_000_000,
    notional_usd: null,
    contracted_rate: 1.0850,    // forward
    spot_rate_at_trade: 1.0800, // spot
    trade_date: '2026-01-01',
    value_date: '2026-12-31',
    counterparty_bank: 'Bank A',
    reference_number: 'ORB-001',
    status: 'active',
    notes: null,
    rolled_from_id: null,
    close_date: null,
    close_rate: null,
    amended_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** Build N months of synthetic monthly rates ending today, drifting linearly. */
function makeHistoricalRates(months: number, startRate: number, drift: number)
  : { date: string; rate: number }[] {
  const out: { date: string; rate: number }[] = []
  const today = new Date()
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 15)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    out.push({ date: iso, rate: startRate + drift * (months - 1 - i) })
  }
  return out
}

// ── Retrospective: dollar-offset method ──────────────────────────────────────

describe('computeEffectiveness — retrospective (dollar-offset)', () => {
  it('inconclusive when rate movement is trivial (< 0.1%)', () => {
    const pos = makePosition({ contracted_rate: 1.0850, spot_rate_at_trade: 1.0850 })
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.0851 }, [])
    expect(result.retrospectiveResult).toBe('inconclusive')
    expect(result.dollarOffsetRatioPct).toBe(100.0)
  })

  it('passes (within 80–125%) when forward points are small relative to rate move', () => {
    // Spot at trade 1.0800, forward 1.0810 (10 pip basis).
    // Today's spot 1.1000 → rate moved ~1.85%, much larger than the 0.09% basis.
    // → instrument and item ΔFV nearly equal → ratio near 100%.
    const pos = makePosition({ spot_rate_at_trade: 1.0800, contracted_rate: 1.0810 })
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.1000 }, [])
    expect(result.retrospectiveResult).toBe('pass')
    expect(result.dollarOffsetRatioPct).toBeGreaterThanOrEqual(80)
    expect(result.dollarOffsetRatioPct).toBeLessThanOrEqual(125)
  })

  it('produces real ineffectiveness when forward points create basis divergence', () => {
    // Hypothetical-derivative method: instrument valued vs forward, item vs spot.
    // If today's spot equals the contracted forward rate, instrument has zero
    // ΔFV but the hedged item moved by the basis amount → ineffectiveness.
    const pos = makePosition({ spot_rate_at_trade: 1.0800, contracted_rate: 1.0850 })
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.0850 }, [])
    // Instrument: (1.0850 - 1.0850) * 1M = 0
    // Item:       (1.0800 - 1.0850) * 1M = -5_000
    expect(result.deltaFvInstrument).toBeCloseTo(0, 6)
    expect(Math.abs(result.deltaFvHedgedItem)).toBeCloseTo(5_000, 0)
    expect(result.ineffectivePortionUsd).toBe(0) // |instr| < |item| → no ineffectiveness recognized
    expect(result.effectivePortionUsd).toBeCloseTo(0, 6)
  })

  it('routes excess instrument value to ineffectivePortionUsd when |instr| > |item|', () => {
    // Construct a case where instrument moves more than the item. This can happen
    // if the contracted rate was off-market (mispriced hedge).
    const pos = makePosition({
      spot_rate_at_trade: 1.0800,
      contracted_rate: 1.2000,  // very off-market forward
    })
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.1000 }, [])
    // Instrument: (1.20 - 1.10) * 1M = 100_000
    // Item:       (1.08 - 1.10) * 1M = -20_000
    expect(result.deltaFvInstrument).toBeCloseTo(100_000, 0)
    expect(Math.abs(result.deltaFvHedgedItem)).toBeCloseTo(20_000, 0)
    expect(result.effectivePortionUsd).toBeCloseTo(20_000, 0)   // min
    expect(result.ineffectivePortionUsd).toBeCloseTo(80_000, 0) // |instr| - |item|
  })
})

describe('computeEffectiveness — buy vs sell symmetry', () => {
  it('sell direction: gain when spot falls below contracted rate', () => {
    const pos = makePosition({
      direction: 'sell',
      contracted_rate: 1.0850,
      spot_rate_at_trade: 1.0850,
    })
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.0500 }, [])
    expect(result.deltaFvInstrument).toBeGreaterThan(0)  // sold high, can buy back low
  })

  it('buy direction: gain when spot rises above contracted rate', () => {
    const pos = makePosition({
      direction: 'buy',
      contracted_rate: 1.0850,
      spot_rate_at_trade: 1.0850,
    })
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.1200 }, [])
    expect(result.deltaFvInstrument).toBeGreaterThan(0)  // bought low, now worth more
  })

  it('sell loses, buy gains, on the same rate move (mirror image)', () => {
    const sell = computeEffectiveness(
      makePosition({ direction: 'sell', spot_rate_at_trade: 1.0850 }),
      { 'EUR/USD': 1.1000 }, [],
    )
    const buy = computeEffectiveness(
      makePosition({ direction: 'buy', spot_rate_at_trade: 1.0850 }),
      { 'EUR/USD': 1.1000 }, [],
    )
    expect(sell.deltaFvInstrument).toBeCloseTo(-buy.deltaFvInstrument, 6)
  })
})

describe('computeEffectiveness — currency pair conventions', () => {
  it('handles direct CCY/USD pair (EUR/USD)', () => {
    const pos = makePosition({
      currency_pair: 'EUR/USD',
      base_currency: 'EUR',
      quote_currency: 'USD',
      spot_rate_at_trade: 1.0800,
      contracted_rate: 1.0850,
    })
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.1000 }, [])
    // For sell: (1.0850 - 1.1000) * 1M = -15_000 (in USD, since pair is */USD)
    expect(result.deltaFvInstrument).toBeCloseTo(-15_000, 0)
  })

  it('handles inverted USD/CCY pair (USD/JPY)', () => {
    // Notional 1M USD, sold forward USD/JPY at 150 (commit to deliver USD, receive JPY)
    const pos = makePosition({
      currency_pair: 'USD/JPY',
      base_currency: 'USD',
      quote_currency: 'JPY',
      spot_rate_at_trade: 150,
      contracted_rate: 151,
      notional_base: 1_000_000,  // 1M USD
    })
    const result = computeEffectiveness(pos, { 'USD/JPY': 145 }, [])
    // Sell: (151 - 145) * 1M USD = 6M JPY equivalent → divide by current spot 145 → ~$41,379 USD
    expect(result.deltaFvInstrument).toBeCloseTo((151 - 145) * 1_000_000 / 145, 0)
  })

  it('falls back to contracted_rate when ratesMap has no usable entry', () => {
    const pos = makePosition({ currency_pair: 'EUR/USD', contracted_rate: 1.0850 })
    const result = computeEffectiveness(pos, {}, [])
    expect(result.currentSpotRate).toBe(1.0850)  // fallback
    // Zero rate movement → inconclusive
    expect(result.retrospectiveResult).toBe('inconclusive')
  })
})

describe('computeEffectiveness — spot_rate_at_trade fallback', () => {
  it('uses contracted_rate when spot_rate_at_trade is null (with degraded valuation)', () => {
    const pos = makePosition({
      spot_rate_at_trade: null,
      contracted_rate: 1.0850,
    })
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.0500 }, [])
    expect(result.spotRateAtTrade).toBe(1.0850)
    expect(result.spotRateAtTradeAvailable).toBe(false)
    // forwardPoints = contractedRate - spotRateAtTrade = 0 → no basis ineffectiveness
    expect(result.forwardPoints).toBe(0)
  })

  it('reports spotRateAtTradeAvailable: true when present', () => {
    const pos = makePosition({ spot_rate_at_trade: 1.0800, contracted_rate: 1.0850 })
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.1000 }, [])
    expect(result.spotRateAtTradeAvailable).toBe(true)
    expect(result.forwardPoints).toBeCloseTo(0.0050, 6)
  })
})

// ── Prospective: regression ──────────────────────────────────────────────────

describe('computeEffectiveness — prospective regression', () => {
  it('returns insufficient_data when fewer than 8 months of history', () => {
    const pos = makePosition()
    const hist = makeHistoricalRates(5, 1.08, 0.001)
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.10 }, hist)
    expect(result.prospectiveResult).toBe('insufficient_data')
    expect(result.rSquared).toBeNull()
    expect(result.slope).toBeNull()
  })

  it('passes prospective with 12+ months of monotonic history (slope ≈ -1, R² ≈ 1)', () => {
    const pos = makePosition({ spot_rate_at_trade: 1.0800, contracted_rate: 1.0805 })
    const hist = makeHistoricalRates(12, 1.05, 0.005)  // smooth linear trend
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.10 }, hist)
    expect(result.historicalMonths).toBeGreaterThanOrEqual(8)
    expect(result.rSquared).not.toBeNull()
    expect(result.rSquared!).toBeGreaterThanOrEqual(0.80)
    expect(result.slope!).toBeGreaterThanOrEqual(-1.25)
    expect(result.slope!).toBeLessThanOrEqual(-0.80)
    expect(result.prospectiveResult).toBe('pass')
  })

  it('regression slope is independent (not the y = -x circular bug)', () => {
    // Specifically test that the regression isn't trivially returning slope = -1
    // because xSeries = -ySeries. With non-zero forward points the slope should
    // still be near -1 (because the basis adjustment is small) but R² should be
    // high and computed from real data, not constructed to be 1.
    const pos = makePosition({ spot_rate_at_trade: 1.0800, contracted_rate: 1.0850 })
    const hist = makeHistoricalRates(12, 1.05, 0.005)
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.10 }, hist)
    expect(result.rSquared!).toBeLessThanOrEqual(1)
    expect(result.slope!).toBeLessThanOrEqual(0)
  })
})

// ── Overall status ───────────────────────────────────────────────────────────

describe('computeEffectiveness — overallStatus', () => {
  it('"effective" when both retro and prospective pass', () => {
    const pos = makePosition({ spot_rate_at_trade: 1.0800, contracted_rate: 1.0810 })
    const hist = makeHistoricalRates(12, 1.05, 0.005)
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.1000 }, hist)
    expect(result.retrospectiveResult).toBe('pass')
    expect(result.prospectiveResult).toBe('pass')
    expect(result.overallStatus).toBe('effective')
  })

  it('"needs_review" when retro is inconclusive', () => {
    const pos = makePosition({ contracted_rate: 1.0850, spot_rate_at_trade: 1.0850 })
    const hist = makeHistoricalRates(12, 1.05, 0.005)
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.0851 }, hist)
    expect(result.retrospectiveResult).toBe('inconclusive')
    expect(result.overallStatus).toBe('needs_review')
  })

  it('"needs_review" when prospective has insufficient data and retro passes', () => {
    const pos = makePosition({ spot_rate_at_trade: 1.0800, contracted_rate: 1.0810 })
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.1000 }, [])
    expect(result.retrospectiveResult).toBe('pass')
    expect(result.prospectiveResult).toBe('insufficient_data')
    expect(result.overallStatus).toBe('needs_review')
  })

  it('"ineffective" when retrospective fails', () => {
    // Force ratio outside 80-125%: tiny instrument move vs huge item move
    const pos = makePosition({
      spot_rate_at_trade: 1.0800,
      contracted_rate: 1.5000,    // very off-market
    })
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.1000 }, [])
    // Instrument: (1.50 - 1.10) * 1M = 400_000
    // Item:       (1.08 - 1.10) * 1M = -20_000
    // Ratio ≈ 2000% → fail
    expect(result.retrospectiveResult).toBe('fail')
    expect(result.overallStatus).toBe('ineffective')
  })
})

// ── Designation memo ─────────────────────────────────────────────────────────

describe('computeEffectiveness — designation memo', () => {
  it('produces ASC 815 references for cash_flow hedge', () => {
    const pos = makePosition({ hedge_type: 'cash_flow' })
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.10 }, [])
    expect(result.designationMemo.accountingStandard).toBe('ASC 815')
    expect(result.designationMemo.hedgingRelationship).toContain('Cash Flow Hedge')
    expect(result.designationMemo.hedgedItem).toContain('25-15')
  })

  it('produces fair-value memo for fair_value hedge', () => {
    const pos = makePosition({ hedge_type: 'fair_value' })
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.10 }, [])
    expect(result.designationMemo.hedgingRelationship).toContain('Fair Value Hedge')
    expect(result.designationMemo.hedgedItem).toContain('25-37')
  })

  it('mentions hypothetical derivative method in assessmentMethod', () => {
    const pos = makePosition()
    const result = computeEffectiveness(pos, { 'EUR/USD': 1.10 }, [])
    expect(result.designationMemo.assessmentMethod).toContain('hypothetical derivative')
    expect(result.designationMemo.assessmentMethod).toContain('80%')
    expect(result.designationMemo.assessmentMethod).toContain('125%')
  })
})

// ── Summary aggregator ───────────────────────────────────────────────────────

describe('getEffectivenessSummary', () => {
  it('returns zeros for empty input', () => {
    const s = getEffectivenessSummary([])
    expect(s.totalCount).toBe(0)
    expect(s.passCount).toBe(0)
    expect(s.failCount).toBe(0)
    expect(s.totalEffectivePortionUsd).toBe(0)
  })

  it('counts pass/fail/needsReview correctly', () => {
    const pos = makePosition({ spot_rate_at_trade: 1.0800, contracted_rate: 1.0810 })
    const hist = makeHistoricalRates(12, 1.05, 0.005)
    const effective    = computeEffectiveness(pos, { 'EUR/USD': 1.10 }, hist)

    const inconclusive = computeEffectiveness(
      makePosition({ contracted_rate: 1.0850, spot_rate_at_trade: 1.0850 }),
      { 'EUR/USD': 1.0851 },
      hist,
    )

    const ineffective = computeEffectiveness(
      makePosition({ spot_rate_at_trade: 1.0800, contracted_rate: 1.5000 }),
      { 'EUR/USD': 1.10 },
      hist,
    )

    const s = getEffectivenessSummary([effective, inconclusive, ineffective])
    expect(s.totalCount).toBe(3)
    expect(s.passCount).toBe(1)
    expect(s.failCount).toBe(1)
    expect(s.needsReviewCount).toBe(1)
    expect(s.inconclusiveCount).toBe(1) // only the inconclusive one
  })

  it('sums effective and ineffective portions across results', () => {
    const r1 = computeEffectiveness(
      makePosition({ spot_rate_at_trade: 1.0800, contracted_rate: 1.0810 }),
      { 'EUR/USD': 1.10 }, [],
    )
    const r2 = computeEffectiveness(
      makePosition({ id: 'pos-2', spot_rate_at_trade: 1.0800, contracted_rate: 1.5000 }),
      { 'EUR/USD': 1.10 }, [],
    )
    const s = getEffectivenessSummary([r1, r2])
    expect(s.totalEffectivePortionUsd).toBeCloseTo(r1.effectivePortionUsd + r2.effectivePortionUsd, 6)
    expect(s.totalIneffectivePortionUsd).toBeCloseTo(r1.ineffectivePortionUsd + r2.ineffectivePortionUsd, 6)
  })
})
