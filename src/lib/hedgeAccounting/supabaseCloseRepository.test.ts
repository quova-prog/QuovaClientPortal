import { describe, expect, it } from 'vitest'
import {
  createSupabaseCloseAccountingRepository,
  type CloseAccountingSupabaseClient,
} from './supabaseCloseRepository'

interface MockResponse {
  data: unknown
  error: { message: string } | null
}

class MockQuery {
  filters: { method: string; args: unknown[] }[] = []

  constructor(private response: MockResponse) {}

  select(...args: unknown[]) { this.filters.push({ method: 'select', args }); return this }
  eq(...args: unknown[]) { this.filters.push({ method: 'eq', args }); return this }
  lt(...args: unknown[]) { this.filters.push({ method: 'lt', args }); return this }
  in(...args: unknown[]) { this.filters.push({ method: 'in', args }); return this }
  order(...args: unknown[]) { this.filters.push({ method: 'order', args }); return this }

  then<TResult1 = MockResponse, TResult2 = never>(
    onfulfilled?: ((value: MockResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled, onrejected)
  }
}

class MockDb {
  queries: Record<string, MockQuery[]> = {}
  rpcCalls: { fn: string; args: Record<string, unknown> }[] = []

  constructor(
    private responses: Record<string, MockResponse>,
    private rpcResponse: MockResponse = { data: null, error: null },
  ) {}

  from(table: string) {
    const query = new MockQuery(this.responses[table] ?? { data: [], error: null })
    this.queries[table] ??= []
    this.queries[table].push(query)
    return query
  }

  async rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ fn, args })
    return this.rpcResponse
  }
}

function asClient(db: MockDb): CloseAccountingSupabaseClient {
  return db as unknown as CloseAccountingSupabaseClient
}

function dbWithCloseRows(rpcResponse?: MockResponse) {
  return new MockDb({
    hedge_designations: {
      error: null,
      data: [{
        id: 'designation-1',
        position_id: 'position-1',
        designation_type: 'cash_flow',
        framework: 'asc815',
        accounting_status: 'designated',
        probability_status: 'probable',
        assessment_method: 'dollar_offset',
        hedge_positions: {
          id: 'position-1',
          notional_base: '1000000',
        },
      }],
    },
    derivative_accounting_ledger: {
      error: null,
      data: [{
        designation_id: 'designation-1',
        derivative_balance_after_usd: '12000',
        period: '2026-05',
        created_at: '2026-05-31T23:59:00Z',
      }],
    },
    aoci_ledger: {
      error: null,
      data: [{
        designation_id: 'designation-1',
        balance_after_usd: '2000',
        period: '2026-05',
        created_at: '2026-05-31T23:59:00Z',
      }],
    },
    hedge_position_draws: {
      error: null,
      data: [{
        id: 'prior-draw',
        position_id: 'position-1',
        draw_date: '2026-05-15',
        draw_amount: '100000',
        is_final_settlement: false,
      }, {
        id: 'current-draw',
        position_id: 'position-1',
        draw_date: '2026-06-15',
        draw_amount: '250000',
        is_final_settlement: false,
      }],
    },
  }, rpcResponse)
}

describe('createSupabaseCloseAccountingRepository', () => {
  it('loads close inputs from Supabase rows plus approved close-period inputs', async () => {
    const db = dbWithCloseRows()
    const repo = createSupabaseCloseAccountingRepository({
      db: asClient(db),
      orgId: 'org-1',
      inputsByDesignationId: {
        'designation-1': {
          fairValue: {
            fairValueUsd: 18_000,
            source: 'bank_mtm',
            fairValueHierarchy: 'level_2_bank',
            valuationProvider: 'Bank desk',
          },
          effectiveness: {
            method: 'dollar_offset',
            verdict: 'effective',
            rationale: 'Dollar-offset test passed.',
          },
          reclassifications: [{
            hedgedItemId: 'item-1',
            affectsEarningsOn: '2026-06-20',
            aociAmountUsd: 3_000,
          }],
        },
      },
    })

    const input = await repo.loadCloseInput('2026-06')

    expect(input.period).toBe('2026-06')
    expect(input.designations).toEqual([{
      designationId: 'designation-1',
      positionId: 'position-1',
      designationType: 'cash_flow',
      framework: 'asc815',
      accountingStatus: 'designated',
      probabilityStatus: 'probable',
      previousDerivativeBalanceUsd: 12_000,
      currentFairValueUsd: 18_000,
      totalDesignatedNotionalBase: 1_000_000,
      previouslySettledNotionalBase: 100_000,
      previousAociBalanceUsd: 2_000,
      settlements: [{
        drawId: 'current-draw',
        eventType: 'partial_settlement',
        settledNotionalBase: 250_000,
        sourceEventRef: 'draw:current-draw',
      }],
      fairValue: {
        fairValueUsd: 18_000,
        source: 'bank_mtm',
        fairValueHierarchy: 'level_2_bank',
        valuationProvider: 'Bank desk',
      },
      effectiveness: {
        method: 'dollar_offset',
        verdict: 'effective',
        rationale: 'Dollar-offset test passed.',
      },
      reclassifications: [{
        hedgedItemId: 'item-1',
        affectsEarningsOn: '2026-06-20',
        aociAmountUsd: 3_000,
      }],
    }])
    expect(db.queries.hedge_designations[0].filters).toContainEqual({
      method: 'eq',
      args: ['accounting_status', 'designated'],
    })
  })

  it('fails closed when a designation lacks fair-value or effectiveness input', async () => {
    const repo = createSupabaseCloseAccountingRepository({
      db: asClient(dbWithCloseRows()),
      orgId: 'org-1',
      inputsByDesignationId: {},
    })

    await expect(repo.loadCloseInput('2026-06')).rejects.toThrow(
      /close input missing fair value for designation designation-1/i,
    )
  })

  it('executes allowed accounting RPCs and returns generated ids', async () => {
    const db = dbWithCloseRows({ data: 'fair-value-1', error: null })
    const repo = createSupabaseCloseAccountingRepository({
      db: asClient(db),
      orgId: 'org-1',
      inputsByDesignationId: {},
    })

    await expect(repo.rpc('append_fair_value_measurement', {
      p_designation_id: 'designation-1',
    })).resolves.toBe('fair-value-1')
    expect(db.rpcCalls).toEqual([{
      fn: 'append_fair_value_measurement',
      args: { p_designation_id: 'designation-1' },
    }])
  })

  it('surfaces Supabase RPC failures with the original message', async () => {
    const repo = createSupabaseCloseAccountingRepository({
      db: asClient(dbWithCloseRows({ data: null, error: { message: 'period is locked' } })),
      orgId: 'org-1',
      inputsByDesignationId: {},
    })

    await expect(repo.rpc('set_accounting_period_status', {
      p_period: '2026-06',
      p_status: 'closed',
    })).rejects.toThrow(/period is locked/i)
  })
})
