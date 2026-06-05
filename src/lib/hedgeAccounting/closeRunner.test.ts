import { describe, expect, it } from 'vitest'
import {
  closeAccountingPeriod,
  type CloseAccountingRepository,
} from './closeRunner'
import type { CloseAccountingPeriodInput } from './closePeriod'

function closeInput(): CloseAccountingPeriodInput {
  return {
    period: '2026-06',
    designations: [{
      designationId: 'designation-1',
      positionId: 'position-1',
      designationType: 'cash_flow',
      framework: 'asc815',
      accountingStatus: 'designated',
      probabilityStatus: 'probable',
      previousDerivativeBalanceUsd: 12_000,
      currentFairValueUsd: 18_000,
      totalDesignatedNotionalBase: 1_000_000,
      previouslySettledNotionalBase: 0,
      previousAociBalanceUsd: 2_000,
      settlements: [{
        drawId: 'draw-1',
        eventType: 'partial_settlement',
        settledNotionalBase: 250_000,
      }],
      fairValue: {
        fairValueUsd: 18_000,
        source: 'quova_indicative',
        fairValueHierarchy: 'level_2_indicative',
      },
      effectiveness: {
        method: 'dollar_offset',
        verdict: 'effective',
        rationale: 'ASC 815 dollar-offset assessment passed.',
      },
      reclassifications: [],
    }],
  }
}

describe('closeAccountingPeriod', () => {
  it('loads inputs and executes generated RPC calls in order', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    const repo: CloseAccountingRepository = {
      loadCloseInput: async (period) => {
        expect(period).toBe('2026-06')
        return closeInput()
      },
      rpc: async (fn, args) => {
        calls.push({ fn, args })
        if (fn === 'append_fair_value_measurement') return 'fair-value-1'
      },
    }

    const result = await closeAccountingPeriod(repo, '2026-06')

    expect(result).toEqual({
      period: '2026-06',
      callCount: 6,
    })
    expect(calls.map((call) => call.fn)).toEqual([
      'append_fair_value_measurement',
      'append_derivative_accounting_entry',
      'append_derivative_accounting_entry',
      'append_effectiveness_assessment',
      'append_aoci_ledger_entry',
      'set_accounting_period_status',
    ])
    expect(calls[calls.length - 1]?.args).toEqual({
      p_period: '2026-06',
      p_status: 'closed',
    })
  })

  it('threads fair-value measurement ids into derivative ledger writes', async () => {
    const derivativeCalls: Record<string, unknown>[] = []
    const repo: CloseAccountingRepository = {
      loadCloseInput: async () => closeInput(),
      rpc: async (fn, args) => {
        if (fn === 'append_fair_value_measurement') return 'fair-value-1'
        if (fn === 'append_derivative_accounting_entry') {
          derivativeCalls.push(args)
        }
      },
    }

    await closeAccountingPeriod(repo, '2026-06')

    expect(derivativeCalls).toHaveLength(2)
    expect(derivativeCalls.map((args) => args.p_fair_value_measurement_id)).toEqual([
      'fair-value-1',
      'fair-value-1',
    ])
  })

  it('rejects mismatched repository periods before writing RPC calls', async () => {
    const calls: string[] = []
    const repo: CloseAccountingRepository = {
      loadCloseInput: async () => ({
        ...closeInput(),
        period: '2026-07',
      }),
      rpc: async (fn) => {
        calls.push(fn)
      },
    }

    await expect(closeAccountingPeriod(repo, '2026-06')).rejects.toThrow(/loaded close input period/i)
    expect(calls).toEqual([])
  })

  it('annotates RPC failures with the failed function name and stops', async () => {
    const calls: string[] = []
    const repo: CloseAccountingRepository = {
      loadCloseInput: async () => closeInput(),
      rpc: async (fn) => {
        calls.push(fn)
        if (fn === 'append_derivative_accounting_entry') {
          throw new Error('period is locked')
        }
      },
    }

    await expect(closeAccountingPeriod(repo, '2026-06')).rejects.toThrow(
      /append_derivative_accounting_entry failed: period is locked/i,
    )
    expect(calls).toEqual([
      'append_fair_value_measurement',
      'append_derivative_accounting_entry',
    ])
  })
})
