import { describe, expect, it } from 'vitest'
import {
  computeAsc815CashFlowHedgeAociEntries,
  computeDerivativeAccountingEntries,
} from './engine'

describe('computeDerivativeAccountingEntries', () => {
  it('marks derivative to fair value and releases carrying value pro rata for partial window-forward draws', () => {
    const entries = computeDerivativeAccountingEntries({
      period: '2026-06',
      designationId: 'designation-1',
      positionId: 'position-1',
      previousDerivativeBalanceUsd: 12_000,
      currentFairValueUsd: 18_000,
      totalDesignatedNotionalBase: 1_000_000,
      previouslySettledNotionalBase: 0,
      settlements: [{
        drawId: 'draw-1',
        eventType: 'partial_settlement',
        settledNotionalBase: 250_000,
        sourceEventRef: 'draw:draw-1',
      }],
      fairValueMeasurementId: 'fv-1',
    })

    expect(entries).toEqual([
      {
        period: '2026-06',
        designationId: 'designation-1',
        positionId: 'position-1',
        drawId: null,
        eventType: 'mtm_to_fair_value',
        amountUsd: 6_000,
        derivativeBalanceAfterUsd: 18_000,
        fairValueMeasurementId: 'fv-1',
        sourceEventRef: 'fair_value:fv-1',
      },
      {
        period: '2026-06',
        designationId: 'designation-1',
        positionId: 'position-1',
        drawId: 'draw-1',
        eventType: 'partial_settlement',
        amountUsd: -4_500,
        derivativeBalanceAfterUsd: 13_500,
        fairValueMeasurementId: 'fv-1',
        sourceEventRef: 'draw:draw-1',
      },
    ])
  })

  it('fully clears the remaining derivative carrying balance on a full settlement', () => {
    const entries = computeDerivativeAccountingEntries({
      period: '2026-06',
      designationId: 'designation-1',
      positionId: 'position-1',
      previousDerivativeBalanceUsd: -3_000,
      currentFairValueUsd: -5_000,
      totalDesignatedNotionalBase: 500_000,
      previouslySettledNotionalBase: 300_000,
      settlements: [{
        drawId: 'draw-final',
        eventType: 'full_settlement',
        settledNotionalBase: 200_000,
      }],
      fairValueMeasurementId: 'fv-2',
    })

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      eventType: 'mtm_to_fair_value',
      amountUsd: -2_000,
      derivativeBalanceAfterUsd: -5_000,
    })
    expect(entries[1]).toMatchObject({
      eventType: 'full_settlement',
      amountUsd: 5_000,
      derivativeBalanceAfterUsd: 0,
    })
  })

  it('rejects settlement notional that exceeds the designated residual', () => {
    expect(() => computeDerivativeAccountingEntries({
      period: '2026-06',
      designationId: 'designation-1',
      positionId: 'position-1',
      previousDerivativeBalanceUsd: 0,
      currentFairValueUsd: 10_000,
      totalDesignatedNotionalBase: 1_000_000,
      previouslySettledNotionalBase: 900_000,
      settlements: [{
        drawId: 'draw-too-large',
        eventType: 'partial_settlement',
        settledNotionalBase: 150_000,
      }],
    })).toThrow(/exceeds remaining designated notional/i)
  })
})

describe('computeAsc815CashFlowHedgeAociEntries', () => {
  it('defers qualifying ASC 815 cash-flow hedge changes to AOCI without ineffectiveness P&L', () => {
    const entries = computeAsc815CashFlowHedgeAociEntries({
      period: '2026-06',
      designationId: 'designation-1',
      previousAociBalanceUsd: 2_000,
      derivativeFairValueChangeUsd: 6_000,
      accountingStatus: 'designated',
      probabilityStatus: 'probable',
      reclassifications: [],
    })

    expect(entries).toEqual([{
      period: '2026-06',
      designationId: 'designation-1',
      hedgedItemId: null,
      eventType: 'defer',
      bucket: 'aoci_cf',
      amountUsd: 6_000,
      balanceAfterUsd: 8_000,
      sourceEventRef: 'asc815:cfh:defer',
    }])
    expect(entries.map((entry) => entry.eventType)).not.toContain('ifrs9_ineffective_to_earnings')
  })

  it('does not reclassify AOCI on a lifecycle draw unless the hedged item affects earnings', () => {
    const entries = computeAsc815CashFlowHedgeAociEntries({
      period: '2026-06',
      designationId: 'designation-1',
      previousAociBalanceUsd: 8_000,
      derivativeFairValueChangeUsd: 0,
      accountingStatus: 'designated',
      probabilityStatus: 'probable',
      reclassifications: [{
        hedgedItemId: 'item-1',
        affectsEarningsOn: null,
        aociAmountUsd: 3_000,
      }],
    })

    expect(entries).toEqual([])
  })

  it('reclassifies only hedged items whose earnings date falls in the close period', () => {
    const entries = computeAsc815CashFlowHedgeAociEntries({
      period: '2026-06',
      designationId: 'designation-1',
      previousAociBalanceUsd: 8_000,
      derivativeFairValueChangeUsd: 0,
      accountingStatus: 'designated',
      probabilityStatus: 'probable',
      reclassifications: [{
        hedgedItemId: 'item-1',
        affectsEarningsOn: '2026-06-15',
        aociAmountUsd: 3_000,
      }, {
        hedgedItemId: 'item-2',
        affectsEarningsOn: '2026-07-01',
        aociAmountUsd: 1_000,
      }],
    })

    expect(entries).toEqual([{
      period: '2026-06',
      designationId: 'designation-1',
      hedgedItemId: 'item-1',
      eventType: 'reclassify',
      bucket: 'aoci_cf',
      amountUsd: -3_000,
      balanceAfterUsd: 5_000,
      sourceEventRef: 'hedged_item:item-1:affects_earnings',
    }])
  })

  it('holds existing AOCI but stops new deferrals when the forecast is no longer probable but still expected', () => {
    const entries = computeAsc815CashFlowHedgeAociEntries({
      period: '2026-06',
      designationId: 'designation-1',
      previousAociBalanceUsd: 8_000,
      derivativeFairValueChangeUsd: 2_000,
      accountingStatus: 'designated',
      probabilityStatus: 'no_longer_probable_still_expected',
      reclassifications: [],
    })

    expect(entries).toEqual([])
  })

  it('releases existing AOCI immediately when the forecast is probable not to occur', () => {
    const entries = computeAsc815CashFlowHedgeAociEntries({
      period: '2026-06',
      designationId: 'designation-1',
      previousAociBalanceUsd: 8_000,
      derivativeFairValueChangeUsd: 2_000,
      accountingStatus: 'designated',
      probabilityStatus: 'probable_not_to_occur',
      reclassifications: [],
    })

    expect(entries).toEqual([{
      period: '2026-06',
      designationId: 'designation-1',
      hedgedItemId: null,
      eventType: 'forecast_failed',
      bucket: 'aoci_cf',
      amountUsd: -8_000,
      balanceAfterUsd: 0,
      sourceEventRef: 'forecast:probable_not_to_occur',
    }])
  })
})
