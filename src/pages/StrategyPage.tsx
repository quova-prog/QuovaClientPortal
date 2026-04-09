import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, ShieldAlert, AlertTriangle, TrendingUp,
  Calendar, ChevronRight, Save, RefreshCw, Info,
  CheckSquare, Square, Clock,
} from 'lucide-react'
import { useHedgePolicy, useHedgePositions, useFxRates } from '@/hooks/useData'
import { useCombinedCoverage } from '@/hooks/useCombinedCoverage'
import { useEntity } from '@/context/EntityContext'
import { computeRiskMetrics, rankStrategies } from '@/lib/advisorEngine'
import { fetchHistoricalTimeseries, type MonthlySnapshot } from '@/lib/frankfurter'
import { toUsd } from '@/lib/fx'
import type { HedgePolicy } from '@/types'

// ── helpers ───────────────────────────────────────────────────────────────

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const fmtPct = (n: number) => `${Math.round(n)}%`
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const daysUntil = (s: string) => Math.ceil((new Date(s).getTime() - Date.now()) / 86_400_000)

const INSTRUMENTS = ['forward', 'swap', 'option', 'spot'] as const
const INSTRUMENT_LABELS: Record<string, string> = {
  forward: 'Forwards',
  swap:    'Swaps',
  option:  'Options',
  spot:    'Spot',
}
const HORIZON_OPTIONS = [3, 6, 12, 18, 24]
const REBALANCE_OPTIONS = [
  { value: 'monthly',    label: 'Monthly' },
  { value: 'quarterly',  label: 'Quarterly' },
  { value: 'on_trigger', label: 'On Trigger' },
]

type PolicyForm = {
  name: string
  min_coverage_pct: number
  max_coverage_pct: number
  target_hedge_ratio_pct: number
  coverage_horizon_months: number
  rebalance_frequency: 'monthly' | 'quarterly' | 'on_trigger'
  allowed_instruments: string[]
  min_notional_threshold: number
}

function defaultForm(policy: HedgePolicy | null): PolicyForm {
  const min = policy?.min_coverage_pct ?? 60
  const max = policy?.max_coverage_pct ?? 90
  return {
    name: policy?.name ?? 'Default Policy',
    min_coverage_pct: min,
    max_coverage_pct: max,
    target_hedge_ratio_pct: policy?.target_hedge_ratio_pct ?? Math.round((min + max) / 2),
    coverage_horizon_months: policy?.coverage_horizon_months ?? 6,
    rebalance_frequency: policy?.rebalance_frequency ?? 'quarterly',
    allowed_instruments: policy?.allowed_instruments ?? ['forward', 'swap', 'option'],
    min_notional_threshold: policy?.min_notional_threshold ?? 500_000,
  }
}

// ── sub-components ────────────────────────────────────────────────────────

function CoverageBar({ pct, min, max }: { pct: number; min: number; max: number }) {
  const inPolicy = pct >= min && pct <= max
  const under    = pct < min
  const color    = inPolicy ? 'var(--green, #22c55e)' : under ? '#f59e0b' : '#3b82f6'
  return (
    <div style={{ position: 'relative', height: 8, background: 'var(--bg-surface)', borderRadius: 4, overflow: 'hidden', minWidth: 80 }}>
      {/* Policy corridor */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0,
        left: `${min}%`, width: `${max - min}%`,
        background: 'rgba(34,197,94,0.15)',
      }} />
      {/* Coverage fill */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: 0,
        width: `${Math.min(pct, 100)}%`,
        background: color,
        borderRadius: 4,
        transition: 'width 0.4s ease',
      }} />
    </div>
  )
}

function StatusBadge({ pct, min, max }: { pct: number; min: number; max: number }) {
  if (pct >= min && pct <= max) return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 600,
      background: 'rgba(34,197,94,0.12)', color: '#22c55e', padding: '2px 8px', borderRadius: 4 }}>
      <ShieldCheck size={12} /> In Policy
    </span>
  )
  if (pct < min) return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 600,
      background: 'rgba(245,158,11,0.12)', color: '#f59e0b', padding: '2px 8px', borderRadius: 4 }}>
      <AlertTriangle size={12} /> Under-hedged
    </span>
  )
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 600,
      background: 'rgba(59,130,246,0.12)', color: '#3b82f6', padding: '2px 8px', borderRadius: 4 }}>
      <Info size={12} /> Over-hedged
    </span>
  )
}

// ── main page ─────────────────────────────────────────────────────────────

export function StrategyPage() {
  const navigate = useNavigate()
  const { currentEntityId, isConsolidated, entities } = useEntity()
  const { policy, loading: polLoading, saving, savePolicy } = useHedgePolicy()
  const { positions, loading: posLoading } = useHedgePositions()
  const { combinedCoverage, loading: covLoading } = useCombinedCoverage()
  const { rates } = useFxRates()

  const [snapshots, setSnapshots]         = useState<MonthlySnapshot[]>([])
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [form, setForm]                   = useState<PolicyForm>(defaultForm(null))
  const [savedOk, setSavedOk]             = useState(false)
  const [saveError, setSaveError]         = useState<string | null>(null)

  // Load historical snapshots once (2-year window, same as Advisor)
  useEffect(() => {
    const end   = new Date().toISOString().slice(0, 10)
    const start = new Date(Date.now() - 2 * 365 * 86_400_000).toISOString().slice(0, 10)
    fetchHistoricalTimeseries(start, end)
      .then(data => { setSnapshots(data); setSnapshotError(null) })
      .catch(() => { setSnapshotError('Failed to load historical data') })
  }, [])

  // Sync form when policy loads or entity changes
  useEffect(() => {
    setForm(defaultForm(policy))
  }, [policy?.id, currentEntityId])

  const riskMetrics = useMemo(() => {
    if (!combinedCoverage.length && !positions.length) return null
    return computeRiskMetrics(combinedCoverage, positions, rates, policy, snapshots)
  }, [combinedCoverage, positions, rates, policy, snapshots])

  const strategies = useMemo(() => {
    if (!riskMetrics) return []
    return rankStrategies(riskMetrics, policy)
  }, [riskMetrics, policy])

  const topStrategy = strategies[0] ?? null

  // Upcoming maturities
  const today = Date.now()
  const maturing = useMemo(() => {
    const buckets = { d30: [] as typeof positions, d60: [] as typeof positions, d90: [] as typeof positions }
    for (const p of positions) {
      const d = daysUntil(p.value_date)
      if (d <= 0) continue
      if (d <= 30) buckets.d30.push(p)
      else if (d <= 60) buckets.d60.push(p)
      else if (d <= 90) buckets.d90.push(p)
    }
    return buckets
  }, [positions, today])

  const totalMaturingUsd = useMemo(() => {
    const all = [...maturing.d30, ...maturing.d60, ...maturing.d90]
    return all.reduce((s, p) => s + toUsd(p.notional_base, p.base_currency, rates), 0)
  }, [maturing, rates])

  // Entity label
  const entityName = useMemo(() => {
    if (isConsolidated) return 'All Entities'
    return entities.find(e => e.id === currentEntityId)?.name ?? 'Current Entity'
  }, [isConsolidated, currentEntityId, entities])

  // Policy form helpers
  const setField = useCallback(<K extends keyof PolicyForm>(k: K, v: PolicyForm[K]) => {
    setForm(f => ({ ...f, [k]: v }))
  }, [])

  function toggleInstrument(inst: string) {
    setForm(f => {
      const cur = f.allowed_instruments
      return {
        ...f,
        allowed_instruments: cur.includes(inst) ? cur.filter(i => i !== inst) : [...cur, inst],
      }
    })
  }

  async function handleSave() {
    setSaveError(null)
    const { error } = await savePolicy({
      name:                    form.name,
      min_coverage_pct:        form.min_coverage_pct,
      max_coverage_pct:        form.max_coverage_pct,
      target_hedge_ratio_pct:  form.target_hedge_ratio_pct,
      coverage_horizon_months: form.coverage_horizon_months,
      rebalance_frequency:     form.rebalance_frequency,
      allowed_instruments:     form.allowed_instruments,
      min_notional_threshold:  form.min_notional_threshold,
    })
    if (error) { setSaveError(error); return }
    setSavedOk(true)
    setTimeout(() => setSavedOk(false), 3000)
  }

  const loading = polLoading || covLoading || posLoading

  // ── render ──────────────────────────────────────────────────────────────

  const currPct  = riskMetrics?.currentHedgeRatioPct ?? 0
  const targetPct = riskMetrics?.targetPct ?? form.target_hedge_ratio_pct
  const minPct   = riskMetrics?.policyMinPct ?? form.min_coverage_pct
  const maxPct   = riskMetrics?.policyMaxPct ?? form.max_coverage_pct

  const statusColor =
    currPct >= minPct && currPct <= maxPct ? '#22c55e' :
    currPct < minPct ? '#f59e0b' : '#3b82f6'

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Strategy
          </h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
            Hedge policy workbench · {entityName}
          </p>
        </div>
        {policy && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', alignSelf: 'center',
            background: 'var(--bg-surface)', padding: '4px 10px', borderRadius: 6 }}>
            {policy.entity_id ? 'Entity policy' : 'Org-level policy'}
          </span>
        )}
      </div>

      <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* ── 1. Policy Status Banner ───────────────────────────────── */}
        <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading metrics…</div>
          ) : !riskMetrics ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              No exposure data yet. Upload data to see your hedge coverage status.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1.5rem', alignItems: 'center' }}>

              {/* Current ratio */}
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Hedge Coverage
                </div>
                <div style={{ fontSize: '2.25rem', fontWeight: 700, color: statusColor, lineHeight: 1 }}>
                  {fmtPct(currPct)}
                </div>
                <div style={{ marginTop: 6 }}>
                  <StatusBadge pct={currPct} min={minPct} max={maxPct} />
                </div>
              </div>

              {/* Policy band visual */}
              <div style={{ gridColumn: 'span 2' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                  Policy Corridor: {fmtPct(minPct)} – {fmtPct(maxPct)} &nbsp;|&nbsp; Target: {fmtPct(targetPct)}
                </div>
                {/* Band bar */}
                <div style={{ position: 'relative', height: 20, background: 'var(--border-dim)', borderRadius: 6, overflow: 'hidden' }}>
                  {/* corridor */}
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${minPct}%`, width: `${maxPct - minPct}%`, background: 'rgba(34,197,94,0.2)' }} />
                  {/* fill */}
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${Math.min(currPct, 100)}%`, background: statusColor, opacity: 0.85, borderRadius: 6, transition: 'width 0.4s' }} />
                  {/* target marker */}
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${targetPct}%`, width: 2, background: '#fff', opacity: 0.6 }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>

              {/* Key numbers */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Total Exposure</span>
                  <span style={{ fontWeight: 600 }}>{fmt(riskMetrics.totalExposureUsd)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Hedged</span>
                  <span style={{ fontWeight: 600, color: '#22c55e' }}>{fmt(riskMetrics.totalHedgedUsd)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Open Exposure</span>
                  <span style={{ fontWeight: 600, color: '#f59e0b' }}>{fmt(riskMetrics.unhedgedUsd)}</span>
                </div>
                {riskMetrics.hedgeGapUsd > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                    <span style={{ color: '#f59e0b' }}>Gap to Target</span>
                    <span style={{ fontWeight: 600, color: '#f59e0b' }}>{fmt(riskMetrics.hedgeGapUsd)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── 2. Coverage by Currency + Maturities (side by side) ──── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1rem' }}>

          {/* Currency coverage table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <TrendingUp size={15} color="var(--teal)" />
              <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Coverage by Currency</span>
            </div>

            {!riskMetrics || !riskMetrics.currencyRisks?.length ? (
              <div style={{ padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                No currency exposures found.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Pair', 'Exposure', 'Hedged', 'Coverage', 'Status'].map(h => (
                      <th key={h} style={{ padding: '0.625rem 1rem', textAlign: h === 'Coverage' ? 'left' : 'right', color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {h === 'Pair' ? <span style={{ float: 'left' }}>{h}</span> : h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {riskMetrics.currencyRisks.map((cr, i) => (
                    <tr key={cr.pair} style={{ borderBottom: i < riskMetrics.currencyRisks.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{cr.pair}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--text-muted)' }}>{fmt(cr.exposureUsd)}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>{fmt(cr.hedgedUsd)}</td>
                      <td style={{ padding: '0.75rem 1rem', minWidth: 160 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1 }}>
                            <CoverageBar pct={cr.coveragePct} min={minPct} max={maxPct} />
                          </div>
                          <span style={{ minWidth: 36, textAlign: 'right', fontWeight: 600 }}>
                            {fmtPct(cr.coveragePct)}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                        <StatusBadge pct={cr.coveragePct} min={minPct} max={maxPct} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Upcoming maturities */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Calendar size={15} color="var(--teal)" />
              <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Upcoming Maturities</span>
            </div>

            {positions.length === 0 ? (
              <div style={{ padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                No active positions.
              </div>
            ) : (
              <div>
                {/* Bucket summary pills */}
                <div style={{ display: 'flex', gap: '0.5rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)' }}>
                  {[
                    { label: '≤ 30d', items: maturing.d30, color: '#ef4444' },
                    { label: '31–60d', items: maturing.d60, color: '#f59e0b' },
                    { label: '61–90d', items: maturing.d90, color: '#3b82f6' },
                  ].map(b => (
                    <div key={b.label} style={{ flex: 1, textAlign: 'center', padding: '6px 4px', borderRadius: 6, background: `${b.color}18` }}>
                      <div style={{ fontSize: '1.125rem', fontWeight: 700, color: b.color }}>{b.items.length}</div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>{b.label}</div>
                    </div>
                  ))}
                </div>

                {/* Individual position list */}
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {[...maturing.d30, ...maturing.d60, ...maturing.d90].length === 0 ? (
                    <div style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                      No positions maturing within 90 days.
                    </div>
                  ) : (
                    [...maturing.d30, ...maturing.d60, ...maturing.d90]
                      .sort((a, b) => a.value_date.localeCompare(b.value_date))
                      .map(p => {
                        const d = daysUntil(p.value_date)
                        const col = d <= 30 ? '#ef4444' : d <= 60 ? '#f59e0b' : '#3b82f6'
                        return (
                          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '0.625rem 1rem', borderBottom: '1px solid var(--border)' }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{p.currency_pair}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {p.instrument_type} · {fmtDate(p.value_date)}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                                {fmt(toUsd(p.notional_base, p.base_currency, rates))}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: col, fontWeight: 600 }}>
                                {d}d
                              </div>
                            </div>
                          </div>
                        )
                      })
                  )}
                </div>

                {totalMaturingUsd > 0 && (
                  <div style={{ padding: '0.625rem 1rem', borderTop: '1px solid var(--border)',
                    display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Total maturing (90d)</span>
                    <span style={{ fontWeight: 700 }}>{fmt(totalMaturingUsd)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── 3. Hedge Advisor Insight ──────────────────────────────── */}
        {topStrategy && (
          <div className="card" style={{ display: 'flex', alignItems: 'flex-start', gap: '1.25rem',
            background: 'linear-gradient(135deg, rgba(0,200,160,0.05) 0%, rgba(59,130,246,0.05) 100%)',
            border: '1px solid rgba(0,200,160,0.2)' }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,200,160,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
              <ShieldCheck size={20} color="var(--teal)" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.375rem' }}>
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase',
                  letterSpacing: '0.08em', color: 'var(--teal)' }}>Recommended Strategy</span>
                <span style={{ fontSize: '0.75rem', background: 'rgba(0,200,160,0.12)',
                  color: 'var(--teal)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                  Strategy {topStrategy.id}
                </span>
              </div>
              <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.375rem' }}>
                {topStrategy.name}
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem', lineHeight: 1.6 }}>
                {topStrategy.tagline} — targets {fmtPct(topStrategy.targetHedgeRatioPct)} coverage using{' '}
                {topStrategy.instruments.map(i => i.type).join(' + ')}.
                Estimated cost: {topStrategy.estimatedCostBps} bps / year.
                Projected volatility reduction: {fmtPct(topStrategy.volatilityReductionPct)}.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => navigate('/hedge', { state: { strategy: topStrategy.name } })}>
                  Create Position <ChevronRight size={13} />
                </button>
                <button
                  className="btn btn-sm"
                  style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)' }}
                  onClick={() => navigate('/advisor')}>
                  Full Analysis <ChevronRight size={13} />
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 130, textAlign: 'right', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Policy Score</div>
                <div style={{ fontWeight: 700, fontSize: '1.25rem', color: topStrategy.policyComplianceScore >= 80 ? '#22c55e' : '#f59e0b' }}>
                  {topStrategy.policyComplianceScore}/100
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Complexity</div>
                <div style={{ fontWeight: 600, fontSize: '0.875rem', textTransform: 'capitalize' }}>
                  {topStrategy.executionComplexity}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 4. Policy Settings ────────────────────────────────────── */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={15} color="var(--teal)" />
              <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Hedge Policy Settings</span>
              {!policy && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'var(--bg-surface)',
                  padding: '2px 8px', borderRadius: 4 }}>No policy — defaults shown</span>
              )}
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSave}
              disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {saving ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />}
              {savedOk ? 'Saved!' : saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>

          <div style={{ padding: '1.25rem 1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>

            {/* Left column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

              {/* Policy name */}
              <div>
                <label style={labelStyle}>Policy Name</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={e => setField('name', e.target.value)}
                  placeholder="e.g. FY2026 Hedge Policy"
                />
              </div>

              {/* Target ratio */}
              <div>
                <label style={labelStyle}>Target Hedge Ratio: <strong style={{ color: 'var(--teal)' }}>{fmtPct(form.target_hedge_ratio_pct)}</strong></label>
                <input
                  type="range" min={0} max={100} step={5}
                  value={form.target_hedge_ratio_pct}
                  onChange={e => setField('target_hedge_ratio_pct', Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--teal)', cursor: 'pointer', marginTop: 6 }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  <span>0%</span><span>50%</span><span>100%</span>
                </div>
              </div>

              {/* Min / Max band */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>Min Coverage (%)</label>
                  <input
                    className="input"
                    type="number" min={0} max={100} step={5}
                    value={form.min_coverage_pct}
                    onChange={e => setField('min_coverage_pct', Number(e.target.value))}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Max Coverage (%)</label>
                  <input
                    className="input"
                    type="number" min={0} max={100} step={5}
                    value={form.max_coverage_pct}
                    onChange={e => setField('max_coverage_pct', Number(e.target.value))}
                  />
                </div>
              </div>

              {/* Min notional */}
              <div>
                <label style={labelStyle}>Min Notional Threshold (USD)</label>
                <input
                  className="input"
                  type="number" min={0} step={100000}
                  value={form.min_notional_threshold}
                  onChange={e => setField('min_notional_threshold', Number(e.target.value))}
                />
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Only hedge exposures above this amount
                </div>
              </div>
            </div>

            {/* Right column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

              {/* Coverage horizon */}
              <div>
                <label style={labelStyle}>Coverage Horizon</label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: 4 }}>
                  {HORIZON_OPTIONS.map(m => (
                    <button
                      key={m}
                      onClick={() => setField('coverage_horizon_months', m)}
                      style={{
                        padding: '6px 14px', borderRadius: 6, fontSize: '0.8125rem', cursor: 'pointer',
                        fontWeight: form.coverage_horizon_months === m ? 700 : 400,
                        background: form.coverage_horizon_months === m ? 'var(--teal)' : 'rgba(255,255,255,0.07)',
                        color: '#e2e8f0',
                        border: `1px solid ${form.coverage_horizon_months === m ? 'var(--teal)' : 'rgba(255,255,255,0.15)'}`,
                        transition: 'all 0.15s',
                      }}>
                      {m}M
                    </button>
                  ))}
                </div>
              </div>

              {/* Rebalance frequency */}
              <div>
                <label style={labelStyle}>Rebalance Frequency</label>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: 4 }}>
                  {REBALANCE_OPTIONS.map(o => (
                    <button
                      key={o.value}
                      onClick={() => setField('rebalance_frequency', o.value as PolicyForm['rebalance_frequency'])}
                      style={{
                        flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: '0.8125rem', cursor: 'pointer',
                        fontWeight: form.rebalance_frequency === o.value ? 700 : 400,
                        background: form.rebalance_frequency === o.value ? 'var(--teal)' : 'rgba(255,255,255,0.07)',
                        color: '#e2e8f0',
                        border: `1px solid ${form.rebalance_frequency === o.value ? 'var(--teal)' : 'rgba(255,255,255,0.15)'}`,
                        transition: 'all 0.15s',
                      }}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Allowed instruments */}
              <div>
                <label style={labelStyle}>Allowed Instruments</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                  {INSTRUMENTS.map(inst => {
                    const checked = form.allowed_instruments.includes(inst)
                    return (
                      <button
                        key={inst}
                        onClick={() => toggleInstrument(inst)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                          background: checked ? 'rgba(0,200,160,0.08)' : 'var(--bg-surface)',
                          border: `1px solid ${checked ? 'var(--teal)' : 'var(--border)'}`,
                          color: 'var(--text-primary)', fontSize: '0.8125rem', textAlign: 'left',
                        }}>
                        {checked
                          ? <CheckSquare size={14} color="var(--teal)" />
                          : <Square size={14} color="var(--text-muted)" />}
                        {INSTRUMENT_LABELS[inst]}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {saveError && (
            <div style={{ margin: '0 1.5rem 1.25rem', padding: '0.625rem 1rem',
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 6, fontSize: '0.8125rem', color: '#ef4444' }}>
              {saveError}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

// ── shared styles ────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 6,
}

