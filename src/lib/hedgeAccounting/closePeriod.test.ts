import { describe, expect, it } from 'vitest'
import { buildCloseAccountingPeriodPlan } from './closePeriod'

function baseDesignation(overrides: Partial<Parameters<typeof buildCloseAccountingPeriodPlan>[0]['designations'][number]> = {}) {
  return {
    designationId: 'designation-1',
    positionId: 'position-1',
    designationType: 'cash_flow' as const,
    framework: 'asc815' as const,
    accountingStatus: 'designated' as const,
    probabilityStatus: 'probable' as const,
    previousDerivativeBalanceUsd: 12_000,
    currentFairValueUsd: 18_000,
    totalDesignatedNotionalBase: 1_000_000,
    previouslySettledNotionalBase: 0,
    previousAociBalanceUsd: 2_000,
    settlements: [{
      drawId: 'draw-1',
      eventType: 'partial_settlement' as const,
      settledNotionalBase: 250_000,
      sourceEventRef: 'draw:draw-1',
    }],
    fairValue: {
      fairValueUsd: 18_000,
      source: 'quova_indicative' as const,
      fairValueHierarchy: 'level_2_indicative' as const,
      spot: 1.1,
      forwardRate: 1.09,
      inputs: { pricing_method: 'fixed_worst_rate' },
    },
    effectiveness: {
      method: 'dollar_offset' as const,
      verdict: 'effective' as const,
      rationale: 'ASC 815 dollar-offset assessment passed.',
      actualDerivativeFv: 18_000,
      hypotheticalDerivativeFv: 17_250,
      dollarOffsetRatio: 1.0435,
    },
    reclassifications: [{
      hedgedItemId: 'item-1',
      affectsEarningsOn: null,
      aociAmountUsd: 3_000,
    }],
    ...overrides,
  }
}

describe('buildCloseAccountingPeriodPlan', () => {
  it('builds ordered RPC calls for an ASC 815 cash-flow window-forward partial draw close', () => {
    const plan = buildCloseAccountingPeriodPlan({
      period: '2026-06',
      designations: [baseDesignation()],
    })

    expect(plan.calls.map((call) => call.fn)).toEqual([
      'append_fair_value_measurement',
      'append_derivative_accounting_entry',
      'append_derivative_accounting_entry',
      'append_effectiveness_assessment',
      'append_aoci_ledger_entry',
      'set_accounting_period_status',
    ])
    expect(plan.calls[0].args).toMatchObject({
      p_designation_id: 'designation-1',
      p_period: '2026-06',
      p_fair_value_usd: 18_000,
      p_source: 'quova_indicative',
      p_fair_value_hierarchy: 'level_2_indicative',
    })
    expect(plan.calls[1].args).toMatchObject({
      p_draw_id: 'draw-1',
      p_event_type: 'partial_settlement',
      p_amount_usd: -3_000,
      p_derivative_balance_after_usd: 9_000,
    })
    expect(plan.calls[2].args).toMatchObject({
      p_event_type: 'mtm_to_fair_value',
      p_amount_usd: 9_000,
      p_derivative_balance_after_usd: 18_000,
    })
    expect(plan.calls[4].args).toMatchObject({
      p_event_type: 'defer',
      p_amount_usd: 6_000,
      p_balance_after_usd: 8_000,
    })
    expect(plan.calls[5]).toEqual({
      fn: 'set_accounting_period_status',
      args: {
        p_period: '2026-06',
        p_status: 'closed',
      },
    })
  })

  it('only emits AOCI reclass calls for hedged items that affect earnings in the close period', () => {
    const plan = buildCloseAccountingPeriodPlan({
      period: '2026-06',
      designations: [baseDesignation({
        previousDerivativeBalanceUsd: 18_000,
        currentFairValueUsd: 18_000,
        previousAociBalanceUsd: 8_000,
        settlements: [],
        reclassifications: [{
          hedgedItemId: 'item-1',
          affectsEarningsOn: '2026-06-15',
          aociAmountUsd: 3_000,
        }, {
          hedgedItemId: 'item-2',
          affectsEarningsOn: '2026-07-01',
          aociAmountUsd: 1_000,
        }],
      })],
    })

    const aociCalls = plan.calls.filter((call) => call.fn === 'append_aoci_ledger_entry')
    expect(aociCalls).toHaveLength(1)
    expect(aociCalls[0].args).toMatchObject({
      p_hedged_item_id: 'item-1',
      p_event_type: 'reclassify',
      p_amount_usd: -3_000,
      p_balance_after_usd: 5_000,
    })
  })

  it('fails closed for unsupported framework/designation combinations', () => {
    expect(() => buildCloseAccountingPeriodPlan({
      period: '2026-06',
      designations: [baseDesignation({ framework: 'ifrs9' })],
    })).toThrow(/only supports ASC 815 cash-flow/i)

    expect(() => buildCloseAccountingPeriodPlan({
      period: '2026-06',
      designations: [baseDesignation({ designationType: 'fair_value' })],
    })).toThrow(/only supports ASC 815 cash-flow/i)
  })
})
