import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getCoverageStatus } from '@/lib/utils'
import type {
  FxExposure, HedgePosition, HedgePolicy, ExposureSummary,
  HedgeCoverage, CoverageWithStatus, DashboardMetrics, FxRate, UploadBatch
} from '@/types'

// ── Hedge Policy ──────────────────────────────────────────

export function useHedgePolicy() {
  const { user } = useAuth()
  const [policy, setPolicy] = useState<HedgePolicy | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user?.profile?.org_id) return
    const { data } = await supabase
      .from('hedge_policies')
      .select('*')
      .eq('org_id', user.profile.org_id)
      .eq('active', true)
      .single()
    setPolicy(data)
    setLoading(false)
  }, [user?.profile?.org_id])

  useEffect(() => { load() }, [load])
  return { policy, loading, refresh: load }
}

// ── FX Exposures ──────────────────────────────────────────

export function useExposures() {
  const { user } = useAuth()
  const [exposures, setExposures] = useState<FxExposure[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user?.profile?.org_id) return
    setLoading(true)
    const { data, error } = await supabase
      .from('fx_exposures')
      .select('*')
      .eq('org_id', user.profile.org_id)
      .eq('status', 'open')
      .order('settlement_date', { ascending: true })
    if (error) setError(error.message)
    else setExposures(data ?? [])
    setLoading(false)
  }, [user?.profile?.org_id])

  useEffect(() => { load() }, [load])

  async function deleteExposure(id: string) {
    await supabase.from('fx_exposures').delete().eq('id', id)
    setExposures(prev => prev.filter(e => e.id !== id))
  }

  return { exposures, loading, error, refresh: load, deleteExposure }
}

// ── Exposure Summary (view) ────────────────────────────────

export function useExposureSummary() {
  const { user } = useAuth()
  const [summary, setSummary] = useState<ExposureSummary[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user?.profile?.org_id) return
    const { data } = await supabase
      .from('v_exposure_summary')
      .select('*')
      .eq('org_id', user.profile.org_id)
    setSummary(data ?? [])
    setLoading(false)
  }, [user?.profile?.org_id])

  useEffect(() => { load() }, [load])
  return { summary, loading, refresh: load }
}

// ── Hedge Positions ───────────────────────────────────────

export function useHedgePositions() {
  const { user } = useAuth()
  const [positions, setPositions] = useState<HedgePosition[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user?.profile?.org_id) return
    setLoading(true)
    const { data } = await supabase
      .from('hedge_positions')
      .select('*')
      .eq('org_id', user.profile.org_id)
      .eq('status', 'active')
      .order('value_date', { ascending: true })
    setPositions(data ?? [])
    setLoading(false)
  }, [user?.profile?.org_id])

  useEffect(() => { load() }, [load])

  async function addPosition(form: Omit<HedgePosition, 'id' | 'org_id' | 'created_by' | 'created_at' | 'updated_at'>) {
    if (!user?.profile) return { error: 'Not authenticated' }
    const { data, error } = await supabase
      .from('hedge_positions')
      .insert({ ...form, org_id: user.profile.org_id, created_by: user.id })
      .select()
      .single()
    if (!error && data) setPositions(prev => [...prev, data])
    return { error: error?.message ?? null }
  }

  async function deletePosition(id: string) {
    await supabase.from('hedge_positions').update({ status: 'cancelled' }).eq('id', id)
    setPositions(prev => prev.filter(p => p.id !== id))
  }

  return { positions, loading, refresh: load, addPosition, deletePosition }
}

// ── Hedge Coverage (view) ─────────────────────────────────

export function useHedgeCoverage() {
  const { user } = useAuth()
  const [coverage, setCoverage] = useState<HedgeCoverage[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user?.profile?.org_id) return
    const { data } = await supabase
      .from('v_hedge_coverage')
      .select('*')
      .eq('org_id', user.profile.org_id)
    setCoverage(data ?? [])
    setLoading(false)
  }, [user?.profile?.org_id])

  useEffect(() => { load() }, [load])
  return { coverage, loading, refresh: load }
}

// ── FX Rates ──────────────────────────────────────────────

export function useFxRates() {
  const [rates, setRates] = useState<Record<string, number>>({})

  useEffect(() => {
    supabase
      .from('fx_rates')
      .select('currency_pair, rate')
      .order('rate_date', { ascending: false })
      .then(({ data }) => {
        const map: Record<string, number> = {}
        data?.forEach(r => { if (!map[r.currency_pair]) map[r.currency_pair] = r.rate })
        setRates(map)
      })
  }, [])

  return rates
}

// ── Upload Batches ────────────────────────────────────────

export function useUploadBatches() {
  const { user } = useAuth()
  const [batches, setBatches] = useState<UploadBatch[]>([])

  const load = useCallback(async () => {
    if (!user?.profile?.org_id) return
    const { data } = await supabase
      .from('upload_batches')
      .select('*')
      .eq('org_id', user.profile.org_id)
      .order('created_at', { ascending: false })
      .limit(10)
    setBatches(data ?? [])
  }, [user?.profile?.org_id])

  useEffect(() => { load() }, [load])
  return { batches, refresh: load }
}

// ── Dashboard Metrics (composite) ────────────────────────

export function useDashboardMetrics() {
  const { summary, loading: l1 } = useExposureSummary()
  const { coverage, loading: l2 } = useHedgeCoverage()
  const { policy, loading: l3 } = useHedgePolicy()
  const { exposures, loading: l4 } = useExposures()
  const { positions, loading: l5 } = useHedgePositions()

  const loading = l1 || l2 || l3 || l4 || l5

  const metrics: DashboardMetrics | null = loading ? null : (() => {
    const total_exposure_usd = summary.reduce((s, e) => s + Math.abs(e.net_exposure), 0)
    const total_hedged_usd = positions.reduce((s, p) => s + p.notional_base, 0)
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
