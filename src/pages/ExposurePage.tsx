import { useState, useMemo, useRef } from 'react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as ReTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts'
import {
  Shield, TrendingUp, DollarSign, RefreshCw, Upload, FileText,
  Search, Trash2, X, Info, Plus, ShoppingCart, Users, Building2,
  ArrowLeftRight, Landmark, HardHat, ArrowUpDown, Activity,
  ChevronDown,
} from 'lucide-react'
import { useExposures, useUploadBatches, useFxRates, useHedgePolicy } from '@/hooks/useData'
import { useAuth } from '@/hooks/useAuth'
import { useAuditLog } from '@/hooks/useAuditLog'
import { useLiveFxRates } from '@/hooks/useLiveFxRates'
import { useCombinedCoverage } from '@/hooks/useCombinedCoverage'
import { useDerivedExposures } from '@/hooks/useDerivedExposures'
import {
  formatCurrency, formatDate, formatPct, daysUntil,
  currencyFlag, COVERAGE_COLORS, getCoverageStatus,
} from '@/lib/utils'
import { parseWorkdayCsv, downloadCsvTemplate } from '@/lib/csvParser'
import { toUsd } from '@/lib/fx'
import type { ParsedExposure } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type TabKey = 'summary' | 'sources' | 'timeline' | 'rates' | 'ledger'
type UploadState = 'idle' | 'parsing' | 'preview' | 'uploading' | 'done' | 'error'

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCE_CONFIG: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
  purchase_order:    { label: 'Purchase Orders',    color: '#0ea5e9', Icon: ShoppingCart },
  revenue_forecast:  { label: 'Revenue Forecasts',  color: '#10b981', Icon: TrendingUp },
  customer_contract: { label: 'Customer Contracts', color: '#6366f1', Icon: Users },
  supplier_contract: { label: 'Supplier Contracts', color: '#f59e0b', Icon: Building2 },
  cash_flow:         { label: 'Cash Flows',         color: '#06b6d4', Icon: ArrowUpDown },
  payroll:           { label: 'Payroll',            color: '#8b5cf6', Icon: Users },
  loan:              { label: 'Loan Schedules',     color: '#ef4444', Icon: Landmark },
  capex:             { label: 'CapEx',              color: '#f97316', Icon: HardHat },
  intercompany:      { label: 'Intercompany',       color: '#84cc16', Icon: ArrowLeftRight },
  manual:            { label: 'Manual Entries',     color: '#64748b', Icon: FileText },
}

const PIE_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#84cc16']

function monthKey(d: string) { return d.slice(0, 7) }
function monthLabel(k: string) {
  const [y, m] = k.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' })
}
function quarterKey(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`
}
function quarterLabel(key: string): string {
  return key.replace('-', ' ')
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ExposurePage() {
  const [tab, setTab] = useState<TabKey>('summary')
  const [timelinePeriod, setTimelinePeriod] = useState<'monthly' | 'quarterly'>('monthly')
  const [search, setSearch] = useState('')
  const [filterSource, setFilterSource] = useState('all')
  const [filterDir, setFilterDir] = useState<'all' | 'receivable' | 'payable'>('all')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [uploadPreview, setUploadPreview] = useState<ParsedExposure[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [filename, setFilename] = useState('')

  // ── Data ──────────────────────────────────────────────────────────────────
  const { exposures, loading: manualLoading, refresh: refreshExposures, deleteExposure } = useExposures()
  const { policy } = useHedgePolicy()
  const { user, db } = useAuth()
  const { log } = useAuditLog()
  const { rates: fxRates } = useFxRates()
  const { combinedCoverage, loading: covLoading } = useCombinedCoverage()
  const { derivedExposures, loading: derLoading } = useDerivedExposures()
  const { rates: liveRates, ratesMap, lastUpdated, refresh: refreshRates } = useLiveFxRates()
  // Prefer live rates from Frankfurter; fall back to DB rates (consistent with DashboardPage)
  const effectiveFxRates = Object.keys(ratesMap).length > 0 ? ratesMap : fxRates

  const loading = covLoading || derLoading || manualLoading

  // ── Summary computations ───────────────────────────────────────────────────
  const totalExposure = useMemo(() =>
    combinedCoverage.reduce((s, c) => s + toUsd(Math.abs(c.net_exposure), c.base_currency, effectiveFxRates), 0),
  [combinedCoverage, effectiveFxRates])

  const totalHedged = useMemo(() =>
    combinedCoverage.reduce((s, c) => s + toUsd(c.total_hedged, c.base_currency, effectiveFxRates), 0),
  [combinedCoverage, effectiveFxRates])

  const hedgedPct   = totalExposure > 0 ? (totalHedged / totalExposure) * 100 : 0
  const unhedged    = Math.max(0, totalExposure - totalHedged)
  const overHedged  = totalHedged > totalExposure ? totalHedged - totalExposure : 0
  const coverageStatus = getCoverageStatus(hedgedPct, policy ?? null)

  const sortedCoverage = useMemo(() =>
    [...combinedCoverage].sort((a, b) =>
      toUsd(Math.abs(b.net_exposure), b.base_currency, effectiveFxRates) -
      toUsd(Math.abs(a.net_exposure), a.base_currency, effectiveFxRates)
    ), [combinedCoverage, effectiveFxRates])

  const donutData = useMemo(() =>
    sortedCoverage.slice(0, 8).map((c, i) => ({
      name: c.currency_pair,
      value: Math.round(toUsd(Math.abs(c.net_exposure), c.base_currency, effectiveFxRates)),
      color: PIE_COLORS[i % PIE_COLORS.length],
    })), [sortedCoverage, effectiveFxRates])

  // ── By-source aggregation ──────────────────────────────────────────────────
  const sourceStats = useMemo(() => {
    const stats: Record<string, { count: number; totalUsd: number; currencies: Set<string> }> = {}
    for (const exp of derivedExposures) {
      if (!stats[exp.source]) stats[exp.source] = { count: 0, totalUsd: 0, currencies: new Set() }
      stats[exp.source].count++
      stats[exp.source].totalUsd += toUsd(exp.notional_base, exp.base_currency, effectiveFxRates)
      stats[exp.source].currencies.add(exp.base_currency)
    }
    if (exposures.length > 0) {
      stats['manual'] = { count: exposures.length, totalUsd: 0, currencies: new Set() }
      for (const e of exposures) {
        const [base = 'USD'] = e.currency_pair.split('/')
        stats['manual'].totalUsd += toUsd(Math.abs((e as any).net_exposure ?? (e as any).amount ?? 0), base, effectiveFxRates)
        stats['manual'].currencies.add(base)
      }
    }
    return stats
  }, [derivedExposures, exposures, effectiveFxRates])

  // ── Timeline data ──────────────────────────────────────────────────────────
  const timelineData = useMemo(() => {
    const buckets = new Map<string, { receivable: number; payable: number }>()
    for (const exp of derivedExposures) {
      if (!exp.settlement_date) continue
      const key = timelinePeriod === 'monthly'
        ? monthKey(exp.settlement_date)
        : quarterKey(exp.settlement_date)
      if (!buckets.has(key)) buckets.set(key, { receivable: 0, payable: 0 })
      const b = buckets.get(key)!
      const usd = toUsd(exp.notional_base, exp.base_currency, effectiveFxRates)
      if (exp.direction === 'receivable') b.receivable += usd
      else b.payable += usd
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, timelinePeriod === 'monthly' ? 18 : 8)
      .map(([key, v]) => ({
        key,
        label: timelinePeriod === 'monthly' ? monthLabel(key) : quarterLabel(key),
        Receivable: Math.round(v.receivable),
        Payable: Math.round(v.payable),
      }))
  }, [derivedExposures, effectiveFxRates, timelinePeriod])

  // ── Ledger rows ────────────────────────────────────────────────────────────
  const ledgerRows = useMemo(() => {
    const derived = derivedExposures.map(e => ({
      id: e.id,
      source_key: e.source,
      source_label: SOURCE_CONFIG[e.source]?.label ?? e.source,
      description: e.source_label,
      currency_pair: e.currency_pair,
      base_currency: e.base_currency,
      direction: e.direction,
      notional_base: e.notional_base,
      notional_usd: toUsd(e.notional_base, e.base_currency, effectiveFxRates),
      settlement_date: e.settlement_date,
      is_manual: false,
    }))
    const manual = exposures.map(e => {
      const [base = 'USD'] = e.currency_pair.split('/')
      return {
        id: e.id,
        source_key: 'manual',
        source_label: 'Manual',
        description: (e as any).entity || (e as any).description || '',
        currency_pair: e.currency_pair,
        base_currency: base,
        direction: (e as any).direction as 'receivable' | 'payable',
        notional_base: Math.abs((e as any).net_exposure ?? (e as any).amount ?? 0),
        notional_usd: toUsd(Math.abs((e as any).net_exposure ?? (e as any).amount ?? 0), base, effectiveFxRates),
        settlement_date: (e as any).settlement_date || '',
        is_manual: true,
      }
    })
    return [...derived, ...manual].sort((a, b) =>
      (a.settlement_date || '').localeCompare(b.settlement_date || '')
    )
  }, [derivedExposures, exposures, effectiveFxRates])

  const filteredLedger = useMemo(() =>
    ledgerRows.filter(r => {
      const matchSearch = !search ||
        [r.source_label, r.description, r.currency_pair]
          .some(s => s.toLowerCase().includes(search.toLowerCase()))
      const matchDir    = filterDir === 'all' || r.direction === filterDir
      const matchSrc    = filterSource === 'all' || r.source_key === filterSource
      return matchSearch && matchDir && matchSrc
    }), [ledgerRows, search, filterDir, filterSource])

  const hasManualRows = useMemo(() => filteredLedger.some(r => r.is_manual), [filteredLedger])

  // ── Upload handlers ────────────────────────────────────────────────────────
  async function handleFile(file: File) {
    setFilename(file.name)
    setUploadState('parsing')
    setParseErrors([])
    setParseWarnings([])
    const result = await parseWorkdayCsv(file)
    setParseErrors(result.errors)
    setParseWarnings(result.warnings)
    if (result.rows.length > 0) {
      setUploadPreview(result.rows)
      setUploadState('preview')
    } else {
      setUploadState('error')
    }
  }

  async function confirmUpload() {
    if (uploadPreview.length === 0) return
    if (!user?.profile?.org_id) { setImportError('Account setup incomplete.'); return }
    setImportError(null)
    setUploadState('uploading')
    const { data: batch, error: batchError } = await db
      .from('upload_batches')
      .insert({ org_id: user.profile.org_id, filename, row_count: uploadPreview.length, status: 'processing' })
      .select().single()
    if (batchError) { setUploadState('preview'); setImportError(batchError.message); return }
    const rows = uploadPreview.map(row => ({ ...row, org_id: user.profile!.org_id, upload_batch_id: batch?.id ?? null }))
    const { error } = await db.from('fx_exposures').insert(rows)
    if (error) {
      await db.from('upload_batches').update({ status: 'failed', error_message: error.message }).eq('id', batch!.id)
      await log({
        action: 'upload',
        resource: 'fx_exposures',
        resource_id: batch?.id,
        summary: 'Exposure upload failed',
        metadata: { filename, row_count: uploadPreview.length, error: error.message },
      })
      setUploadState('preview')
      setImportError(error.message)
      return
    }
    await db.from('upload_batches').update({ status: 'complete' }).eq('id', batch!.id)
    await log({
      action: 'upload',
      resource: 'fx_exposures',
      resource_id: batch?.id,
      summary: `Uploaded ${uploadPreview.length} exposure rows`,
      metadata: { filename, row_count: uploadPreview.length },
    })
    setUploadState('done')
    setUploadPreview([])
    refreshExposures()
  }

  function cancelUpload() {
    setUploadState('idle')
    setUploadPreview([])
    setParseErrors([])
    setParseWarnings([])
    setImportError(null)
    setShowUpload(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleDelete(id: string) {
    await deleteExposure(id)
    setConfirmDeleteId(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'summary',  label: 'Summary' },
    { key: 'sources',  label: 'By Source' },
    { key: 'timeline', label: 'Timeline' },
    { key: 'rates',    label: 'Market Rates' },
    { key: 'ledger',   label: 'Ledger' },
  ]

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Exposure</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
            {loading ? 'Loading…' : `${ledgerRows.length} exposures across ${combinedCoverage.length} currency pairs`}
          </p>
        </div>
      </div>

      <div style={{ padding: '1.5rem 1.5rem 0' }}>
        <div className="tab-bar">
          {tabs.map(t => (
            <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 1.5rem 1.5rem' }}>

        {/* ── SUMMARY TAB ──────────────────────────────────────────────────── */}
        {tab === 'summary' && (
          <div>
            {/* KPI tiles */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
              {[
                {
                  label: 'Total Exposure',
                  value: totalExposure > 0 ? formatCurrency(totalExposure, 'USD', true) : '—',
                  sub: `${combinedCoverage.length} currency pairs`,
                  icon: Activity, color: '#6366f1', bg: '#f5f3ff',
                },
                {
                  label: overHedged > 0 ? 'Over-hedged' : 'Unhedged',
                  value: totalExposure > 0 ? formatCurrency(overHedged > 0 ? overHedged : unhedged, 'USD', true) : '—',
                  sub: totalExposure > 0
                    ? overHedged > 0 ? `${(hedgedPct - 100).toFixed(1)}% above exposure` : `${(100 - hedgedPct).toFixed(1)}% of total`
                    : 'No exposure data',
                  icon: Shield,
                  color: overHedged > 0 ? 'var(--amber)' : unhedged > 0 ? 'var(--red)' : 'var(--green)',
                  bg: overHedged > 0 ? '#fffbeb' : unhedged > 0 ? '#fef2f2' : '#f0fdfa',
                },
                {
                  label: 'Hedge Coverage',
                  value: totalExposure > 0 ? formatPct(hedgedPct) : '—',
                  sub: policy ? `Target ${policy.min_coverage_pct}–${policy.max_coverage_pct}%` : 'No policy set',
                  icon: Shield, color: COVERAGE_COLORS[coverageStatus], bg: '#f0f9ff',
                },
                {
                  label: 'Data Sources',
                  value: Object.keys(sourceStats).length.toString(),
                  sub: `${ledgerRows.length} total exposures`,
                  icon: FileText, color: 'var(--teal)', bg: '#f0fdfa',
                },
              ].map(({ label, value, sub, icon: Icon, color, bg }) => (
                <div key={label} className="card" style={{ padding: '1rem' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.625rem' }}>
                    <Icon size={15} color={color} />
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '1.375rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: '0.25rem' }}>{value}</div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.125rem' }}>{label}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{sub}</div>
                </div>
              ))}
            </div>

            {/* Donut + per-pair coverage */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '1rem' }}>

              {/* Donut chart */}
              <div className="card" style={{ padding: 0 }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Exposure by Currency</span>
                  <Info size={13} color="var(--text-muted)" />
                </div>
                {loading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="spinner" style={{ width: 24, height: 24 }} /></div>
                ) : donutData.length === 0 ? (
                  <div className="empty-state"><Activity size={28} /><p>No exposure data yet</p></div>
                ) : (
                  <div style={{ padding: '1rem' }}>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={donutData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value">
                          {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                        <ReTooltip
                          contentStyle={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                          formatter={(v: number) => [formatCurrency(v, 'USD', true), 'Exposure']}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', justifyContent: 'center', marginTop: '0.5rem' }}>
                      {donutData.map(d => (
                        <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem' }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: d.color }} />
                          <span>{d.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Per-pair coverage table */}
              <div className="card" style={{ padding: 0 }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Coverage by Currency Pair</span>
                </div>
                {loading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="spinner" style={{ width: 24, height: 24 }} /></div>
                ) : sortedCoverage.length === 0 ? (
                  <div className="empty-state"><Shield size={28} /><p>No coverage data yet</p></div>
                ) : (
                  <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem', maxHeight: 280, overflowY: 'auto' }}>
                    {sortedCoverage.map(c => {
                      const pct = c.net_exposure !== 0
                        ? Math.min((c.total_hedged / Math.abs(c.net_exposure)) * 100, 100)
                        : 0
                      const expUsd = toUsd(Math.abs(c.net_exposure), c.base_currency, effectiveFxRates)
                      return (
                        <div key={c.currency_pair}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{currencyFlag(c.base_currency)} {c.currency_pair}</span>
                              {c.derived_sources.length > 0 && (
                                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                  {c.derived_sources.length} source{c.derived_sources.length > 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                {formatCurrency(expUsd, 'USD', true)}
                              </span>
                              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: COVERAGE_COLORS[getCoverageStatus(pct, policy ?? null)], minWidth: 36, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                {pct.toFixed(0)}%
                              </span>
                            </div>
                          </div>
                          <div style={{ height: 5, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: COVERAGE_COLORS[getCoverageStatus(pct, policy ?? null)], borderRadius: 3, transition: 'width 0.5s ease' }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── BY SOURCE TAB ─────────────────────────────────────────────────── */}
        {tab === 'sources' && (
          <div>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}><div className="spinner" style={{ width: 28, height: 28 }} /></div>
            ) : Object.keys(sourceStats).length === 0 ? (
              <div className="empty-state" style={{ marginTop: '2rem' }}>
                <Activity size={32} />
                <h3>No data uploaded yet</h3>
                <p>Upload CSV files on the Upload page to see exposure breakdowns.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                {Object.entries(sourceStats).map(([key, stat]) => {
                  const cfg = SOURCE_CONFIG[key] ?? { label: key, color: '#64748b', Icon: FileText }
                  const { Icon } = cfg
                  return (
                    <div key={key} className="card" style={{ padding: '1.25rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '1rem' }}>
                        <div style={{ width: 36, height: 36, borderRadius: 'var(--r-sm)', background: `${cfg.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon size={17} color={cfg.color} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{cfg.label}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{stat.count} item{stat.count !== 1 ? 's' : ''}</div>
                        </div>
                      </div>
                      <div style={{ borderTop: '1px solid var(--border-dim)', paddingTop: '0.75rem', display: 'flex', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.2rem' }}>Total (USD)</div>
                          <div style={{ fontWeight: 700, fontSize: '1.125rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                            {formatCurrency(stat.totalUsd, 'USD', true)}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.2rem' }}>Currencies</div>
                          <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            {Array.from(stat.currencies).map(c => (
                              <span key={c} className="badge badge-teal" style={{ fontSize: '0.65rem' }}>{c}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── TIMELINE TAB ──────────────────────────────────────────────────── */}
        {tab === 'timeline' && (
          <div>
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Exposure Timeline</span>
                  <Info size={13} color="var(--text-muted)" />
                </div>
                <div className="pill-tabs">
                  <button className={`pill-tab ${timelinePeriod === 'monthly' ? 'active' : ''}`} onClick={() => setTimelinePeriod('monthly')}>Monthly</button>
                  <button className={`pill-tab ${timelinePeriod === 'quarterly' ? 'active' : ''}`} onClick={() => setTimelinePeriod('quarterly')}>Quarterly</button>
                </div>
              </div>

              {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}><div className="spinner" style={{ width: 24, height: 24 }} /></div>
              ) : timelineData.length === 0 ? (
                <div className="empty-state"><Activity size={32} /><p>No settlement dates found in uploaded data.</p></div>
              ) : (
                <>
                  <div style={{ padding: '1rem 1.25rem', height: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={timelineData} barCategoryGap="30%">
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={v => `$${(v / 1000000).toFixed(1)}M`} axisLine={false} tickLine={false} width={56} />
                        <ReTooltip
                          contentStyle={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                          formatter={(v: number, name: string) => [formatCurrency(v, 'USD', true), name]}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="Receivable" fill="#10b981" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="Payable"    fill="#ef4444" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Summary below chart */}
                  <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '2rem' }}>
                    {(() => {
                      const totRec = timelineData.reduce((s, d) => s + d.Receivable, 0)
                      const totPay = timelineData.reduce((s, d) => s + d.Payable, 0)
                      return (
                        <>
                          <div>
                            <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Receivable</div>
                            <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#10b981' }}>{formatCurrency(totRec, 'USD', true)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Payable</div>
                            <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#ef4444' }}>{formatCurrency(totPay, 'USD', true)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Net Position</div>
                            <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: (totRec - totPay) >= 0 ? '#10b981' : '#ef4444' }}>
                              {formatCurrency(Math.abs(totRec - totPay), 'USD', true)} {(totRec - totPay) >= 0 ? 'net receivable' : 'net payable'}
                            </div>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── MARKET RATES TAB ──────────────────────────────────────────────── */}
        {tab === 'rates' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>

            {/* Live rates table — all pairs from feed */}
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Live Mid-Market Rates</span>
                  <span style={{ fontSize: '0.69rem', color: 'var(--text-muted)' }}>ECB reference</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                  {lastUpdated && (
                    <span style={{ fontSize: '0.69rem', color: 'var(--text-muted)' }}>
                      {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                  <button
                    onClick={refreshRates}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', display: 'flex' }}
                  ><RefreshCw size={13} /></button>
                </div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Pair</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Day Chg</th>
                    <th className="text-right">Chg %</th>
                    <th>In Portfolio</th>
                  </tr>
                </thead>
                <tbody>
                  {liveRates.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Loading rates…</td></tr>
                  ) : liveRates.map(r => {
                    const inPortfolio = combinedCoverage.some(c => c.currency_pair === r.pair)
                    const changePips = Math.round(r.changeAbs * 10000)
                    return (
                      <tr key={r.pair} style={inPortfolio ? { background: '#f0fdfa' } : undefined}>
                        <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                          {r.pair}
                          {inPortfolio && <span style={{ marginLeft: '0.375rem', fontSize: '0.65rem', color: 'var(--teal-dark)', fontWeight: 400 }}>● active</span>}
                        </td>
                        <td className="text-right mono">{r.rate.toFixed(r.pair.includes('JPY') ? 2 : 4)}</td>
                        <td className="text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: r.change === 'up' ? 'var(--green)' : r.change === 'down' ? 'var(--red)' : 'var(--text-muted)' }}>
                          {r.change === 'flat' ? '—' : `${r.change === 'up' ? '+' : ''}${changePips} pips`}
                        </td>
                        <td className="text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: r.change === 'up' ? 'var(--green)' : r.change === 'down' ? 'var(--red)' : 'var(--text-muted)' }}>
                          {r.change === 'flat' ? '—' : `${r.changePct > 0 ? '+' : ''}${r.changePct.toFixed(3)}%`}
                        </td>
                        <td>
                          {inPortfolio
                            ? <span className="badge badge-teal">Yes</span>
                            : <span className="badge badge-gray">No</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Exposure pairs summary */}
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Your Exposure Pairs</span>
              </div>
              {sortedCoverage.length === 0 ? (
                <div className="empty-state"><Shield size={28} /><p>No exposure data yet</p></div>
              ) : (
                <div style={{ padding: '0.5rem 0' }}>
                  {sortedCoverage.map(c => {
                    const live = ratesMap[c.currency_pair]
                    const liveEntry = liveRates.find(r => r.pair === c.currency_pair)
                    return (
                      <div key={c.currency_pair} style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--border-dim)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.875rem', fontFamily: 'var(--font-mono)' }}>
                            {currencyFlag(c.base_currency)} {c.currency_pair}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                            {formatCurrency(toUsd(Math.abs(c.net_exposure), c.base_currency, effectiveFxRates), 'USD', true)} exposure
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem' }}>
                            {live ? live.toFixed(c.currency_pair.includes('JPY') ? 2 : 4) : '—'}
                          </div>
                          {liveEntry && liveEntry.change !== 'flat' && (
                            <div style={{ fontSize: '0.72rem', color: liveEntry.change === 'up' ? 'var(--green)' : 'var(--red)' }}>
                              {liveEntry.change === 'up' ? '▲' : '▼'} {Math.abs(liveEntry.changePct).toFixed(2)}%
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── LEDGER TAB ────────────────────────────────────────────────────── */}
        {tab === 'ledger' && (
          <div>
            {/* Controls */}
            <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '0.875rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 280 }}>
                <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input className="input" style={{ paddingLeft: '2.25rem' }} placeholder="Search source, description, pair…"
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <select className="input" style={{ width: 'auto' }} value={filterDir} onChange={e => setFilterDir(e.target.value as any)}>
                <option value="all">All directions</option>
                <option value="receivable">Receivable</option>
                <option value="payable">Payable</option>
              </select>
              <select className="input" style={{ width: 'auto' }} value={filterSource} onChange={e => setFilterSource(e.target.value)}>
                <option value="all">All sources</option>
                {Object.entries(SOURCE_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
                  {filteredLedger.length} of {ledgerRows.length}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowUpload(v => !v)}>
                  <Upload size={13} /> Manual Upload
                </button>
              </div>
            </div>

            {/* Upload panel (collapsible) */}
            {showUpload && (
              <div className="card" style={{ marginBottom: '1rem', padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <span style={{ fontWeight: 600 }}>Upload Manual Exposures (FX Workday format)</span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => downloadCsvTemplate()}>
                      <FileText size={13} /> Template
                    </button>
                    <button onClick={cancelUpload} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={16} /></button>
                  </div>
                </div>

                {(uploadState === 'idle' || uploadState === 'error') && (
                  <div
                    style={{ border: '2px dashed var(--border)', borderRadius: 'var(--r-lg)', padding: '2rem', textAlign: 'center', cursor: 'pointer', background: 'var(--bg-surface)' }}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
                  >
                    <Upload size={24} color="var(--text-muted)" style={{ marginBottom: '0.5rem' }} />
                    <p style={{ fontWeight: 500, marginBottom: '0.25rem' }}>Drop CSV or click to browse</p>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Workday FX Exposure format</p>
                    {uploadState === 'error' && parseErrors.length > 0 && (
                      <div style={{ marginTop: '0.75rem', color: 'var(--red)', fontSize: '0.8125rem' }}>{parseErrors[0]}</div>
                    )}
                    <input type="file" accept=".csv" ref={fileRef} style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
                  </div>
                )}

                {uploadState === 'parsing' && (
                  <div style={{ textAlign: 'center', padding: '2rem' }}><div className="spinner" style={{ width: 24, height: 24, margin: '0 auto' }} /></div>
                )}

                {uploadState === 'preview' && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{uploadPreview.length} rows parsed from <code>{filename}</code></span>
                      {parseWarnings.length > 0 && <span className="badge badge-amber">{parseWarnings.length} warnings</span>}
                    </div>
                    {importError && <div style={{ color: 'var(--red)', fontSize: '0.8125rem', marginBottom: '0.75rem' }}>{importError}</div>}
                    <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: '1rem' }}>
                      <table className="data-table">
                        <thead><tr><th>Entity</th><th>Pair</th><th>Direction</th><th className="text-right">Amount</th><th>Settlement</th></tr></thead>
                        <tbody>
                          {uploadPreview.slice(0, 50).map((r, i) => (
                            <tr key={i}>
                              <td>{(r as any).entity}</td>
                              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.currency_pair}</td>
                              <td><span className={`badge badge-${r.direction === 'receivable' ? 'green' : 'blue'}`}>{r.direction}</span></td>
                              <td className="text-right mono">{formatCurrency((r as any).amount ?? 0, r.currency_pair.split('/')[0])}</td>
                              <td>{(r as any).settlement_date ? formatDate((r as any).settlement_date) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="btn btn-primary btn-sm" onClick={confirmUpload}>Import {uploadPreview.length} rows</button>
                      <button className="btn btn-ghost btn-sm" onClick={cancelUpload}>Cancel</button>
                    </div>
                  </div>
                )}

                {uploadState === 'uploading' && (
                  <div style={{ textAlign: 'center', padding: '1.5rem' }}>
                    <div className="spinner" style={{ width: 24, height: 24, margin: '0 auto 0.5rem' }} />
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Importing…</p>
                  </div>
                )}

                {uploadState === 'done' && (
                  <div style={{ textAlign: 'center', padding: '1.5rem' }}>
                    <p style={{ fontWeight: 600, color: 'var(--green)', marginBottom: '0.5rem' }}>✓ Import complete</p>
                    <button className="btn btn-ghost btn-sm" onClick={cancelUpload}>Close</button>
                  </div>
                )}
              </div>
            )}

            {/* Ledger table */}
            <div className="card" style={{ padding: 0 }}>
              {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="spinner" style={{ width: 24, height: 24 }} /></div>
              ) : filteredLedger.length === 0 ? (
                <div className="empty-state">
                  <FileText size={32} />
                  <h3>No exposures{search || filterDir !== 'all' || filterSource !== 'all' ? ' matching filters' : ' yet'}</h3>
                  <p>Upload data on the Upload page or use Manual Upload above.</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Description</th>
                        <th>Pair</th>
                        <th>Direction</th>
                        <th className="text-right">Amount</th>
                        <th className="text-right">USD Equiv.</th>
                        <th>Settlement</th>
                        <th>Days</th>
                        {hasManualRows && <th />}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLedger.map(r => {
                        const days = r.settlement_date ? daysUntil(r.settlement_date) : null
                        const cfg = SOURCE_CONFIG[r.source_key] ?? { color: '#64748b' }
                        return (
                          <tr key={r.id}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                                <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
                                <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{r.source_label}</span>
                              </div>
                            </td>
                            <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                              {r.description || '—'}
                            </td>
                            <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                              {currencyFlag(r.base_currency)} {r.currency_pair}
                            </td>
                            <td>
                              <span className={`badge badge-${r.direction === 'receivable' ? 'green' : 'blue'}`}>
                                {r.direction === 'receivable' ? '↑ Recv' : '↓ Pay'}
                              </span>
                            </td>
                            <td className="text-right mono" style={{ fontSize: '0.8125rem' }}>
                              {formatCurrency(r.notional_base, r.base_currency)}
                            </td>
                            <td className="text-right mono" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                              {formatCurrency(r.notional_usd, 'USD', true)}
                            </td>
                            <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                              {r.settlement_date ? formatDate(r.settlement_date) : '—'}
                            </td>
                            <td>
                              {days !== null ? (
                                <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: days < 0 ? 'var(--text-muted)' : days <= 7 ? 'var(--red)' : days <= 30 ? 'var(--amber)' : 'var(--teal-dark)' }}>
                                  {days < 0 ? 'Past' : `${days}d`}
                                </span>
                              ) : '—'}
                            </td>
                            {hasManualRows && (
                              <td>
                                {r.is_manual && (
                                  confirmDeleteId === r.id ? (
                                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r.id)}>Delete</button>
                                      <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDeleteId(null)}>Keep</button>
                                    </div>
                                  ) : (
                                    <button onClick={() => setConfirmDeleteId(r.id)}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}
                                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                                      <Trash2 size={13} />
                                    </button>
                                  )
                                )}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
