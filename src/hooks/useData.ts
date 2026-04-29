import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from './useAuth'
import { useAuditLog } from './useAuditLog'
import { useEntity } from '@/context/EntityContext'
import { getCoverageStatus } from '@/lib/utils'
import { fetchLatestRates } from '@/lib/frankfurter'
import type {
  FxExposure, HedgePosition, HedgePolicy, ExposureSummary,
  HedgeCoverage, CoverageWithStatus, DashboardMetrics, UploadBatch,
  BankAccount, BankAccountForm
} from '@/types'

// ── Entity-aware client-side aggregation helpers ───────────────────────────
// Used when an entity is selected and the DB views can't be filtered by entity

function computeExposureSummary(exposures: FxExposure[]): ExposureSummary[] {
  const byPair: Record<string, ExposureSummary> = {}
  for (const exp of exposures) {
    if (!byPair[exp.currency_pair]) {
      byPair[exp.currency_pair] = {
        org_id: exp.org_id, currency_pair: exp.currency_pair,
        base_currency: exp.base_currency, quote_currency: exp.quote_currency,
        total_receivable: 0, total_payable: 0, net_exposure: 0,
        total_usd_equivalent: 0, exposure_count: 0,
        earliest_settlement: exp.settlement_date, latest_settlement: exp.settlement_date,
      }
    }
    const s = byPair[exp.currency_pair]
    if (exp.direction === 'receivable') s.total_receivable += exp.notional_base
    else s.total_payable += exp.notional_base
    s.net_exposure = s.total_receivable - s.total_payable
    s.total_usd_equivalent += (exp.notional_usd ?? exp.notional_base)
    s.exposure_count++
    if (exp.settlement_date < s.earliest_settlement) s.earliest_settlement = exp.settlement_date
    if (exp.settlement_date > s.latest_settlement) s.latest_settlement = exp.settlement_date
  }
  return Object.values(byPair)
}

function computeHedgeCoverage(summary: ExposureSummary[], positions: HedgePosition[]): HedgeCoverage[] {
  // Net hedged = |sell notional − buy notional| per pair (matches v_hedge_coverage view)
  const sellByPair: Record<string, number> = {}
  const buyByPair: Record<string, number> = {}
  for (const p of positions) {
    if (p.direction === 'sell') {
      sellByPair[p.currency_pair] = (sellByPair[p.currency_pair] ?? 0) + p.notional_base
    } else {
      buyByPair[p.currency_pair] = (buyByPair[p.currency_pair] ?? 0) + p.notional_base
    }
  }
  const hedgedByPair: Record<string, number> = {}
  const allPairs = new Set([...Object.keys(sellByPair), ...Object.keys(buyByPair)])
  for (const pair of allPairs) {
    hedgedByPair[pair] = Math.abs((sellByPair[pair] ?? 0) - (buyByPair[pair] ?? 0))
  }
  return summary.map(s => {
    const total_hedged = hedgedByPair[s.currency_pair] ?? 0
    const net = Math.abs(s.net_exposure)
    const coverage_pct = net > 0 ? Math.min((total_hedged / net) * 100, 100) : 0
    return {
      org_id: s.org_id, currency_pair: s.currency_pair,
      base_currency: s.base_currency, quote_currency: s.quote_currency,
      net_exposure: s.net_exposure, total_hedged,
      coverage_pct, unhedged_amount: Math.max(net - total_hedged, 0),
    }
  })
}

// ── Hedge Policy ──────────────────────────────────────────

export function useHedgePolicy() {
  const { user, db } = useAuth()
  const { log } = useAuditLog()
  const { currentEntityId } = useEntity()
  const [policy, setPolicy] = useState<HedgePolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!user?.profile?.org_id) { setLoading(false); return }
    setLoading(true)

    let resolved: HedgePolicy | null = null

    // 1. Try entity-specific policy first
    if (currentEntityId) {
      const { data } = await db
        .from('hedge_policies')
        .select('*')
        .eq('org_id', user.profile.org_id)
        .eq('entity_id', currentEntityId)
        .eq('active', true)
        .maybeSingle()
      resolved = data ?? null
    }

    // 2. Fall back to org-level policy (entity_id IS NULL)
    if (!resolved) {
      const { data } = await db
        .from('hedge_policies')
        .select('*')
        .eq('org_id', user.profile.org_id)
        .is('entity_id', null)
        .eq('active', true)
        .maybeSingle()
      resolved = data ?? null
    }

    setPolicy(resolved)
    setLoading(false)
  }, [user?.profile?.org_id, currentEntityId, db])

  useEffect(() => { load() }, [load])

  const savePolicy = useCallback(async (form: Partial<HedgePolicy>): Promise<{ error: string | null }> => {
    if (!user?.profile?.org_id) return { error: 'Not authenticated' }
    setSaving(true)

    let error: string | null = null

    if (policy?.id) {
      // Update existing record
      const { error: e } = await db
        .from('hedge_policies')
        .update({ ...form, updated_at: new Date().toISOString() })
        .eq('id', policy.id)
      error = e?.message ?? null
    } else {
      // Insert new entity-level or org-level policy
      const { error: e } = await db
        .from('hedge_policies')
        .insert({
          ...form,
          org_id: user.profile.org_id,
          entity_id: currentEntityId ?? null,
          active: true,
        })
      error = e?.message ?? null
    }

    if (!error) {
      await load()
      await log({
        action: policy?.id ? 'update' : 'create',
        resource: 'hedge_policy',
        resource_id: policy?.id,
        summary: policy?.id ? 'Updated hedge policy' : 'Created hedge policy',
        metadata: {
          entity_id: currentEntityId ?? null,
          fields: Object.keys(form),
        },
      })
    }
    setSaving(false)
    return { error }
  }, [user?.profile?.org_id, currentEntityId, policy?.id, load, db, log])

  return { policy, loading, saving, refresh: load, savePolicy }
}

// ── FX Exposures ──────────────────────────────────────────

export function useExposures() {
  const { user, db } = useAuth()
  const { log } = useAuditLog()
  const { currentEntityId } = useEntity()
  const [exposures, setExposures] = useState<FxExposure[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user?.profile?.org_id) return
    setLoading(true)
    let query = db
      .from('fx_exposures')
      .select('*')
      .eq('org_id', user.profile.org_id)
      .eq('status', 'open')
      .order('settlement_date', { ascending: true })
    if (currentEntityId) query = (query as any).eq('entity_id', currentEntityId)
    const { data, error } = await (query as any)
    if (error) setError(error.message)
    else { setError(null); setExposures(data ?? []) }
    setLoading(false)
  }, [user?.profile?.org_id, currentEntityId, db])

  useEffect(() => { load() }, [load])

  async function deleteExposure(id: string) {
    const { error } = await db.from('fx_exposures').delete().eq('id', id)
    if (error) return
    setExposures(prev => prev.filter(e => e.id !== id))
    await log({
      action: 'delete',
      resource: 'fx_exposure',
      resource_id: id,
      summary: `Deleted exposure ${id}`,
    })
  }

  return { exposures, loading, error, refresh: load, deleteExposure }
}

// ── Exposure Summary (view) ────────────────────────────────

export function useExposureSummary() {
  const { user, db } = useAuth()
  const [summary, setSummary] = useState<ExposureSummary[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user?.profile?.org_id) { setLoading(false); return }
    const { data } = await db
      .from('v_exposure_summary')
      .select('*')
      .eq('org_id', user.profile.org_id)
    setSummary(data ?? [])
    setLoading(false)
  }, [user?.profile?.org_id, db])

  useEffect(() => { load() }, [load])
  return { summary, loading, refresh: load }
}

// ── Hedge Positions ───────────────────────────────────────

const DEFAULT_STATUSES = ['active'] as const

export function useHedgePositions(statuses: readonly string[] = DEFAULT_STATUSES) {
  const { user, db } = useAuth()
  const { log } = useAuditLog()
  const { currentEntityId } = useEntity()
  const [positions, setPositions] = useState<HedgePosition[]>([])
  const [loading, setLoading] = useState(true)

  // Serialize statuses so the dependency is a stable string, not an array reference
  const statusesKey = statuses.join(',')

  const load = useCallback(async () => {
    if (!user?.profile?.org_id) return
    setLoading(true)
    let query = db
      .from('hedge_positions')
      .select('*')
      .eq('org_id', user.profile.org_id)
      .in('status', statuses as string[])
      .order('value_date', { ascending: true })
    if (currentEntityId) query = (query as any).eq('entity_id', currentEntityId)
    const { data } = await (query as any)
    setPositions(data ?? [])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.profile?.org_id, currentEntityId, statusesKey])

  useEffect(() => { load() }, [load])

  async function addPosition(form: Omit<HedgePosition, 'id' | 'org_id' | 'created_by' | 'created_at' | 'updated_at'>) {
    if (!user?.profile) return { error: 'Not authenticated' }
    const { data, error } = await db
      .from('hedge_positions')
      .insert({ ...form, org_id: user.profile.org_id, created_by: user.id })
      .select()
      .single()
    if (!error && data) setPositions(prev => [...prev, data])
    if (!error && data) {
      await log({
        action: 'create',
        resource: 'hedge_position',
        resource_id: data.id,
        summary: `Created ${data.instrument_type} hedge position ${data.currency_pair}`,
        metadata: {
          currency_pair: data.currency_pair,
          notional_base: data.notional_base,
          base_currency: data.base_currency,
          entity_id: data.entity_id ?? null,
        },
      })
    }
    return { error: error?.message ?? null }
  }

  async function deletePosition(id: string) {
    const { error } = await db.from('hedge_positions').update({ status: 'cancelled' }).eq('id', id)
    if (error) return
    setPositions(prev => prev.filter(p => p.id !== id))
    await log({
      action: 'update',
      resource: 'hedge_position',
      resource_id: id,
      summary: `Cancelled hedge position ${id}`,
      metadata: { status: 'cancelled' },
    })
  }

  // ── Roll Position ──────────────────────────────────────────
  // Marks old position as 'rolled', creates a new linked position
  async function rollPosition(
    oldPosition: HedgePosition,
    rollForm: {
      value_date: string
      notional_base: number
      contracted_rate: number
      spot_rate_at_trade: number | null
      counterparty_bank: string | null
      notes: string | null
    },
  ): Promise<{ error: string | null; newPosition?: HedgePosition }> {
    if (!user?.profile) return { error: 'Not authenticated' }

    // Step 1: Mark old position as rolled
    const { error: updateErr } = await db
      .from('hedge_positions')
      .update({ status: 'rolled' })
      .eq('id', oldPosition.id)
    if (updateErr) return { error: updateErr.message }

    // Step 2: Insert new position linked to the old one
    const today = new Date().toISOString().split('T')[0]
    const ref = oldPosition.reference_number
      ? `${oldPosition.reference_number}-R`
      : `ORB-${Date.now().toString(36).toUpperCase().slice(-8)}`

    const { data, error: insertErr } = await db
      .from('hedge_positions')
      .insert({
        org_id: user.profile.org_id,
        created_by: user.id,
        entity_id: oldPosition.entity_id,
        instrument_type: oldPosition.instrument_type,
        hedge_type: oldPosition.hedge_type,
        currency_pair: oldPosition.currency_pair,
        base_currency: oldPosition.base_currency,
        quote_currency: oldPosition.quote_currency,
        direction: oldPosition.direction,
        notional_base: rollForm.notional_base,
        notional_usd: null,
        contracted_rate: rollForm.contracted_rate,
        spot_rate_at_trade: rollForm.spot_rate_at_trade,
        trade_date: today,
        value_date: rollForm.value_date,
        counterparty_bank: rollForm.counterparty_bank,
        reference_number: ref,
        status: 'active',
        notes: rollForm.notes,
        rolled_from_id: oldPosition.id,
      })
      .select()
      .single()

    if (insertErr || !data) {
      // Revert old position back to active on failure
      await db.from('hedge_positions').update({ status: 'active' }).eq('id', oldPosition.id)
      return { error: insertErr?.message ?? 'Failed to create rolled position' }
    }

    // Optimistic state: remove old (no longer active), add new
    setPositions(prev => [...prev.filter(p => p.id !== oldPosition.id), data])

    await log({
      action: 'update',
      resource: 'hedge_position',
      resource_id: oldPosition.id,
      summary: `Rolled ${oldPosition.currency_pair} from ${oldPosition.value_date} to ${rollForm.value_date}`,
      metadata: {
        old_value_date: oldPosition.value_date,
        new_value_date: rollForm.value_date,
        new_position_id: data.id,
        old_notional: oldPosition.notional_base,
        new_notional: rollForm.notional_base,
      },
    })

    return { error: null, newPosition: data }
  }

  // ── Amend Position ─────────────────────────────────────────
  // In-place update of editable fields with audit trail
  async function amendPosition(
    positionId: string,
    amendForm: {
      notional_base?: number
      contracted_rate?: number
      value_date?: string
      counterparty_bank?: string
      notes?: string
    },
    beforeValues: Record<string, unknown>,
  ): Promise<{ error: string | null }> {
    if (!user?.profile) return { error: 'Not authenticated' }

    const { data, error } = await db
      .from('hedge_positions')
      .update({ ...amendForm, amended_at: new Date().toISOString() })
      .eq('id', positionId)
      .select()
      .single()

    if (error || !data) return { error: error?.message ?? 'Amendment failed' }

    setPositions(prev => prev.map(p => p.id === positionId ? data : p))

    await log({
      action: 'update',
      resource: 'hedge_position',
      resource_id: positionId,
      summary: `Amended hedge position ${data.currency_pair}`,
      metadata: {
        changed_fields: Object.keys(amendForm),
        before: beforeValues,
        after: amendForm,
      },
    })

    return { error: null }
  }

  // ── Close Position Early ───────────────────────────────────
  // Marks position as closed with close date/rate for P&L tracking
  async function closePosition(
    position: HedgePosition,
    closeForm: { close_date: string; close_rate: number },
  ): Promise<{ error: string | null }> {
    if (!user?.profile) return { error: 'Not authenticated' }

    const { error } = await db
      .from('hedge_positions')
      .update({
        status: 'closed',
        close_date: closeForm.close_date,
        close_rate: closeForm.close_rate,
      })
      .eq('id', position.id)

    if (error) return { error: error.message }

    setPositions(prev => prev.filter(p => p.id !== position.id))

    // Calculate realized P&L for the audit record
    const realizedPnl = position.direction === 'buy'
      ? position.notional_base * (closeForm.close_rate - position.contracted_rate)
      : position.notional_base * (position.contracted_rate - closeForm.close_rate)

    await log({
      action: 'update',
      resource: 'hedge_position',
      resource_id: position.id,
      summary: `Early closed ${position.currency_pair}, realized P&L: ${realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(2)} ${position.quote_currency}`,
      metadata: {
        close_date: closeForm.close_date,
        close_rate: closeForm.close_rate,
        realized_pnl: realizedPnl,
        quote_currency: position.quote_currency,
      },
    })

    return { error: null }
  }

  return { positions, loading, refresh: load, addPosition, deletePosition, rollPosition, amendPosition, closePosition }
}

// ── Hedge Coverage (view) ─────────────────────────────────

export function useHedgeCoverage() {
  const { user, db } = useAuth()
  const [coverage, setCoverage] = useState<HedgeCoverage[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user?.profile?.org_id) { setLoading(false); return }
    const { data } = await db
      .from('v_hedge_coverage')
      .select('*')
      .eq('org_id', user.profile.org_id)
    setCoverage(data ?? [])
    setLoading(false)
  }, [user?.profile?.org_id, db])

  useEffect(() => { load() }, [load])
  return { coverage, loading, refresh: load }
}

// ── FX Rates ──────────────────────────────────────────────

export function useFxRates() {
  const [rates, setRates] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchLatestRates([])
      .then(({ pairs }) => { setRates(pairs); setError(null) })
      .catch((err) => { setError(err?.message ?? 'Failed to load FX rates') })
  }, [])

  return { rates, error }
}

// ── Upload Batches ────────────────────────────────────────

export function useUploadBatches() {
  const { user, db } = useAuth()
  const [batches, setBatches] = useState<UploadBatch[]>([])

  const load = useCallback(async () => {
    if (!user?.profile?.org_id) return
    const { data } = await db
      .from('upload_batches')
      .select('*')
      .eq('org_id', user.profile.org_id)
      .order('created_at', { ascending: false })
      .limit(10)
    setBatches(data ?? [])
  }, [user?.profile?.org_id, db])

  useEffect(() => { load() }, [load])
  return { batches, refresh: load }
}

// ── Dashboard Metrics (composite) ────────────────────────

export function useDashboardMetrics() {
  const { isConsolidated } = useEntity()
  // Only fetch DB views when showing consolidated (org-wide) data;
  // entity-filtered views are computed client-side from exposures/positions
  const { summary: viewSummary, loading: l1 } = useExposureSummary()
  const { coverage: viewCoverage, loading: l2 } = useHedgeCoverage()
  const { policy, loading: l3 } = useHedgePolicy()
  const { exposures, loading: l4 } = useExposures()
  const { positions, loading: l5 } = useHedgePositions()

  const loading = (isConsolidated ? (l1 || l2) : false) || l3 || l4 || l5

  // When an entity is selected the DB views can't be filtered, so compute client-side
  const entitySummary  = useMemo(() => isConsolidated ? null : computeExposureSummary(exposures),  [exposures, isConsolidated])
  const entityCoverage = useMemo(() => isConsolidated || !entitySummary ? null : computeHedgeCoverage(entitySummary, positions), [entitySummary, positions, isConsolidated])

  const summary  = isConsolidated ? viewSummary  : (entitySummary  ?? [])
  const coverage = isConsolidated ? viewCoverage : (entityCoverage ?? [])

  const metrics: DashboardMetrics | null = loading ? null : (() => {
    const total_exposure_usd = summary.reduce((s, e) => s + Math.abs(e.net_exposure), 0)
    const total_hedged_usd   = positions.reduce((s, p) => s + p.notional_base, 0)
    const overall_coverage_pct = total_exposure_usd > 0
      ? Math.min((total_hedged_usd / total_exposure_usd) * 100, 100) : 0

    const coverageWithStatus: CoverageWithStatus[] = coverage.map(c => ({
      ...c,
      status: getCoverageStatus(c.coverage_pct, policy),
      policy,
    }))

    const now = new Date()
    const in30 = new Date(now.getTime() + 30 * 86400000)
    const upcoming_settlements = exposures
      .filter(e => new Date(e.settlement_date) <= in30)
      .slice(0, 5)

    const maturing_hedges = positions
      .filter(p => new Date(p.value_date) <= in30)
      .slice(0, 5)

    return {
      total_exposure_usd,
      total_hedged_usd,
      overall_coverage_pct,
      coverage_status: getCoverageStatus(overall_coverage_pct, policy),
      currency_count: summary.length,
      open_exposure_count: exposures.length,
      active_hedge_count: positions.length,
      exposures_by_currency: summary,
      coverage_by_currency: coverageWithStatus,
      upcoming_settlements,
      maturing_hedges,
    }
  })()

  return { metrics, loading, policy }
}

// ── Bank Accounts ──────────────────────────────────────────

export function useBankAccounts() {
  const { user, db } = useAuth()
  const { log } = useAuditLog()
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user?.profile?.org_id) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await db
      .from('bank_accounts')
      .select('*')
      .eq('org_id', user.profile.org_id)
      .neq('status', 'disconnected')
      .order('bank_name')
      .order('account_name')
    if (error) setError(error.message)
    else { setError(null); setAccounts(data ?? []) }
    setLoading(false)
  }, [user?.profile?.org_id, db])

  useEffect(() => { load() }, [load])

  async function addAccount(form: BankAccountForm): Promise<{ error: string | null }> {
    if (!user?.profile?.org_id) return { error: 'Not authenticated' }
    const { error } = await db.from('bank_accounts').insert({
      ...form,
      org_id:        user.profile.org_id,
      status:        'active',
      last_synced_at: new Date().toISOString(),
    })
    if (error) return { error: error.message }
    await load()
    await log({
      action: 'create',
      resource: 'bank_account',
      summary: `Connected bank account ${form.bank_name} / ${form.account_name}`,
      metadata: {
        bank_name: form.bank_name,
        account_name: form.account_name,
        currency: form.currency,
      },
    })
    return { error: null }
  }

  async function syncAccount(id: string): Promise<{ error: string | null }> {
    const now = new Date().toISOString()
    const { error } = await db
      .from('bank_accounts')
      .update({ last_synced_at: now, updated_at: now })
      .eq('id', id)
    if (error) return { error: error.message }
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, last_synced_at: now } : a))
    await log({
      action: 'update',
      resource: 'bank_account',
      resource_id: id,
      summary: `Synced bank account ${id}`,
      metadata: { last_synced_at: now },
    })
    return { error: null }
  }

  async function disconnectAccount(id: string): Promise<{ error: string | null }> {
    const { error } = await db
      .from('bank_accounts')
      .update({ status: 'disconnected', updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return { error: error.message }
    setAccounts(prev => prev.filter(a => a.id !== id))
    await log({
      action: 'update',
      resource: 'bank_account',
      resource_id: id,
      summary: `Disconnected bank account ${id}`,
      metadata: { status: 'disconnected' },
    })
    return { error: null }
  }

  return { accounts, loading, error, addAccount, syncAccount, disconnectAccount, refresh: load }
}
