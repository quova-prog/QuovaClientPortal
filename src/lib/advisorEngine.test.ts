import { describe, it, expect } from 'vitest'
import { rankStrategies, type RiskMetrics } from './advisorEngine'
import type { HedgePolicy } from '@/types'

// Strategy D (Flex-Timing Window Forwards) is only surfaced when policy
// permits window forwards, and its rank rises with the timing-uncertainty
// share of the exposure base. See window-forwards spec §4.3.

function metrics(overrides: Partial<RiskMetrics> = {}): RiskMetrics {
  return {
    totalExposureUsd: 10_000_000,
    totalHedgedUsd: 5_000_000,
    unhedgedUsd: 5_000_000,
    currentHedgeRatioPct: 50,
    policyMinPct: 70,
    policyMaxPct: 90,
    targetPct: 80,
    hedgeGapUsd: 2_000_000,
    var95Usd: 800_000,
    var99Usd: 1_100_000,
    policyBreached: true,
    estimatedTenorMonths: 6,
    nearestSettlementDays: 30,
    currencyRisks: [],
    primaryPair: 'EUR/USD',
    hasPolicy: true,
    timingUncertaintyShare: 0,
    ...overrides,
  }
}

function policy(allowed: string[]): HedgePolicy {
  return {
    id: 'pol-1', org_id: 'org-1', entity_id: null, name: 'P',
    min_coverage_pct: 70, max_coverage_pct: 90, target_hedge_ratio_pct: 80,
    min_notional_threshold: 0, min_tenor_days: 0, max_tenor_months: null,
    allowed_instruments: allowed, rebalance_frequency: 'quarterly',
    coverage_horizon_months: 6, base_currency: 'USD', active: true,
    window_forward_pairs: ['EUR/USD'], max_window_days: 90, max_draws_per_window: 8,
    created_at: '', updated_at: '',
  }
}

describe('rankStrategies — Strategy D gating', () => {
  it('omits Strategy D when policy does not allow window forwards', () => {
    const s = rankStrategies(metrics({ timingUncertaintyShare: 1 }), policy(['forward', 'option']))
    expect(s.find(x => x.id === 'D')).toBeUndefined()
  })

  it('includes Strategy D when policy allows window forwards', () => {
    const s = rankStrategies(metrics({ timingUncertaintyShare: 0.5 }), policy(['forward', 'window_forward']))
    const d = s.find(x => x.id === 'D')
    expect(d).toBeDefined()
    expect(d!.name).toMatch(/Window Forward/i)
    expect(d!.instruments[0].type).toBe('Window Forward')
  })
})

describe('rankStrategies — Strategy D scoring direction', () => {
  it('ranks Strategy D higher when timing uncertainty is high vs low', () => {
    const allow = policy(['forward', 'window_forward', 'option'])
    const highShare = rankStrategies(metrics({ timingUncertaintyShare: 1 }), allow).find(x => x.id === 'D')!
    const lowShare  = rankStrategies(metrics({ timingUncertaintyShare: 0 }), allow).find(x => x.id === 'D')!
    // Same inputs except the timing share → high-uncertainty D scores higher.
    expect(highShare.overallScore).toBeGreaterThan(lowShare.overallScore)
  })

  it('favors Strategy D to the top when exposure is fully timing-uncertain', () => {
    const s = rankStrategies(metrics({ timingUncertaintyShare: 1 }), policy(['forward', 'window_forward', 'option']))
    // With a full timing-uncertainty boost, D should outrank the vanilla forward (A).
    const dRank = s.findIndex(x => x.id === 'D')
    const aRank = s.findIndex(x => x.id === 'A')
    expect(dRank).toBeLessThan(aRank)
  })
})
