import { useState, useRef, useMemo } from 'react'
import {
  Upload, Download, Plus, Pencil, Trash2, X, Check,
  AlertCircle, CheckCircle, Info, CircleDollarSign, FileText
} from 'lucide-react'
import { useBudgetRates } from '@/hooks/useBudgetRates'
import type { BudgetRate } from '@/hooks/useBudgetRates'
import { useHedgePositions, useFxRates } from '@/hooks/useData'
import { parseBudgetRatesCsv, downloadBudgetRateTemplate } from '@/lib/budgetRatesParser'
import type { ParsedBudgetRate } from '@/lib/budgetRatesParser'
import { formatCurrency, currencyFlag, parseCurrencyPair } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { checkFileAlreadyUploaded, recordUploadBatch, formatUploadDate } from '@/lib/uploadDedup'

// ── Constants ────────────────────────────────────────────────
const CURRENT_YEAR = new Date().getFullYear()
const FISCAL_YEARS = [2024, 2025, 2026, ...(CURRENT_YEAR > 2026 ? [CURRENT_YEAR] : [])]
const PERIODS = [
  'Annual', 'Q1', 'Q2', 'Q3', 'Q4',
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

// ── Sub-components ───────────────────────────────────────────

interface RateModalProps {
  initial?: BudgetRate | null
  onSave: (data: Omit<BudgetRate, 'id' | 'uploaded_at'>) => void
  onClose: () => void
}

function RateModal({ initial, onSave, onClose }: RateModalProps) {
  const [pair, setPair] = useState(initial?.currency_pair ?? '')
  const [rate, setRate] = useState(initial?.budget_rate?.toString() ?? '')
  const [year, setYear] = useState(initial?.fiscal_year?.toString() ?? CURRENT_YEAR.toString())
  const [period, setPeriod] = useState(initial?.period ?? 'Annual')
  const [notional, setNotional] = useState(initial?.notional_budget?.toString() ?? '')
  const [desc, setDesc] = useState(initial?.description ?? '')
  const [formError, setFormError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')

    const pairClean = pair.trim().toUpperCase()
    if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(pairClean)) {
      setFormError('Currency pair must be in format USD/CAD')
      return
    }
    const rateNum = parseFloat(rate)
    if (isNaN(rateNum) || rateNum <= 0) {
      setFormError('Budget rate must be a positive number')
      return
    }
    const yearNum = parseInt(year, 10)
    if (isNaN(yearNum) || yearNum < 2020 || yearNum > 2030) {
      setFormError('Fiscal year must be between 2020 and 2030')
      return
    }
    const notionalNum = parseFloat(notional) || 0

    onSave({
      currency_pair: pairClean,
      budget_rate: rateNum,
      fiscal_year: yearNum,
      period,
      notional_budget: notionalNum,
      description: desc.trim(),
    })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: '1rem',
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 480, background: 'var(--bg-card)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            {initial ? 'Edit Budget Rate' : 'Add Budget Rate'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div>
            <label className="label">Currency Pair</label>
            <input
              className="input"
              placeholder="USD/CAD"
              value={pair}
              onChange={e => setPair(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Budget Rate</label>
              <input
                className="input"
                type="number"
                step="0.0001"
                placeholder="1.3200"
                value={rate}
                onChange={e => setRate(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div>
              <label className="label">Fiscal Year</label>
              <input
                className="input"
                type="number"
                min={2020}
                max={2030}
                value={year}
                onChange={e => setYear(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Period</label>
              <select
                className="input"
                value={period}
                onChange={e => setPeriod(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}
              >
                {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Notional Budget</label>
              <input
                className="input"
                type="number"
                placeholder="1000000"
                value={notional}
                onChange={e => setNotional(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }}
              />
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <input
              className="input"
              placeholder="e.g. Full year USD receivables"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          {formError && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--red)', fontSize: '0.8125rem' }}>
              <AlertCircle size={14} /> {formError}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm">
              {initial ? 'Save Changes' : 'Add Rate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Rates Tab ────────────────────────────────────────────────

interface RatesTabProps {
  rates: BudgetRate[]
  onAdd: (data: Omit<BudgetRate, 'id' | 'uploaded_at'>) => void
  onUpdate: (id: string, updates: Partial<BudgetRate>) => void
  onDelete: (id: string) => void
  onSwitchToUpload: () => void
}

function RatesTab({ rates, onAdd, onUpdate, onDelete, onSwitchToUpload }: RatesTabProps) {
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR)
  const [showModal, setShowModal] = useState(false)
  const [editingRate, setEditingRate] = useState<BudgetRate | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const years = useMemo(() => {
    const fromRates = rates.map(r => r.fiscal_year)
    const all = new Set([...FISCAL_YEARS, ...fromRates])
    return Array.from(all).sort()
  }, [rates])

  const filtered = rates.filter(r => r.fiscal_year === selectedYear)
  const totalNotional = filtered.reduce((s, r) => s + r.notional_budget, 0)

  function handleSave(data: Omit<BudgetRate, 'id' | 'uploaded_at'>) {
    if (editingRate) {
      onUpdate(editingRate.id, data)
    } else {
      onAdd(data)
    }
    setShowModal(false)
    setEditingRate(null)
  }

  function handleEdit(r: BudgetRate) {
    setEditingRate(r)
    setShowModal(true)
  }

  function handleAddNew() {
    setEditingRate(null)
    setShowModal(true)
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="pill-tabs" style={{ flex: 1, minWidth: 0 }}>
          {years.map(y => (
            <button
              key={y}
              className={`pill-tab${selectedYear === y ? ' active' : ''}`}
              onClick={() => setSelectedYear(y)}
            >
              FY{y}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onSwitchToUpload} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Upload size={13} /> Import CSV
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleAddNew} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Plus size={13} /> Add Rate
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <CircleDollarSign size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>
            No budget rates for FY{selectedYear}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Import a CSV or add rates manually to get started.
          </div>
          <button className="btn btn-primary btn-sm" onClick={onSwitchToUpload} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <Upload size={13} /> Switch to Upload
          </button>
        </div>
      ) : (
        <>
          <div className="data-table">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)' }}>Currency Pair</th>
                  <th style={{ textAlign: 'left', padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)' }}>FY</th>
                  <th style={{ textAlign: 'left', padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)' }}>Period</th>
                  <th style={{ textAlign: 'right', padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)' }}>Budget Rate</th>
                  <th style={{ textAlign: 'right', padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)' }}>Notional Budget</th>
                  <th style={{ textAlign: 'left', padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)' }}>Description</th>
                  <th style={{ textAlign: 'center', padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const parsed = parseCurrencyPair(r.currency_pair)
                  const flag = parsed ? currencyFlag(parsed.base) : '💱'
                  const isDeleting = deletingId === r.id
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                      <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                        <span style={{ marginRight: '0.375rem' }}>{flag}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>{r.currency_pair}</span>
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{r.fiscal_year}</td>
                      <td style={{ padding: '0.625rem 0.75rem' }}>
                        <span className="badge badge-gray" style={{ fontSize: '0.75rem' }}>{r.period}</span>
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                        {r.budget_rate.toFixed(4)}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                        {r.notional_budget > 0 ? formatCurrency(r.notional_budget, parsed?.quote ?? 'CAD', true) : '—'}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.8125rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.description || '—'}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'center' }}>
                        {isDeleting ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', justifyContent: 'center' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Delete?</span>
                            <button
                              className="btn btn-sm"
                              style={{ background: 'var(--red)', color: '#fff', border: 'none', padding: '0.2rem 0.5rem' }}
                              onClick={() => { onDelete(r.id); setDeletingId(null) }}
                            >
                              <Check size={12} />
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '0.2rem 0.5rem' }}
                              onClick={() => setDeletingId(null)}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', justifyContent: 'center' }}>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => handleEdit(r)}
                              style={{ padding: '0.25rem' }}
                              title="Edit"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setDeletingId(r.id)}
                              style={{ padding: '0.25rem', color: 'var(--red)' }}
                              title="Delete"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0.625rem 0.75rem', borderTop: '1px solid var(--border)', marginTop: '0.25rem' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              Total Notional:{' '}
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>
                {formatCurrency(totalNotional, 'CAD', true)}
              </span>
            </span>
          </div>
        </>
      )}

      {showModal && (
        <RateModal
          initial={editingRate}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingRate(null) }}
        />
      )}
    </div>
  )
}

// ── Variance Tab ─────────────────────────────────────────────

interface VariancePair {
  pair: string
  budgetRate: number
  avgHedgeRate: number | null
  currentSpot: number | null
  notionalBudget: number
  rateVariance: number | null
  spotVariance: number | null
  impliedPnL: number | null
  spotImpliedPnL: number | null
  hedgedPositionCount: number
  quoteCurrency: string
}

interface VarianceTabProps {
  rates: BudgetRate[]
  onSwitchToRates: () => void
}

function VarianceTab({ rates, onSwitchToRates }: VarianceTabProps) {
  const { positions } = useHedgePositions()
  const { rates: fxRates } = useFxRates()

  const variances = useMemo((): VariancePair[] => {
    // Group budget rates by currency pair
    const byPair = new Map<string, BudgetRate[]>()
    for (const r of rates) {
      const prev = byPair.get(r.currency_pair) ?? []
      byPair.set(r.currency_pair, [...prev, r])
    }

    return Array.from(byPair.entries()).map(([pair, pairRates]) => {
      const parsed = parseCurrencyPair(pair)
      const quoteCurrency = parsed?.quote ?? 'CAD'

      // Weighted average budget rate (by notional)
      const totalNotional = pairRates.reduce((s, r) => s + (r.notional_budget || 1), 0)
      const budgetRate = totalNotional > 0
        ? pairRates.reduce((s, r) => s + r.budget_rate * (r.notional_budget || 1), 0) / totalNotional
        : pairRates[0].budget_rate

      const notionalBudget = pairRates.reduce((s, r) => s + r.notional_budget, 0)

      // Active hedge positions for this pair
      const pairPositions = positions.filter(p => p.currency_pair === pair && p.status === 'active')
      const totalHedgeNotional = pairPositions.reduce((s, p) => s + p.notional_base, 0)
      const avgHedgeRate = pairPositions.length > 0 && totalHedgeNotional > 0
        ? pairPositions.reduce((s, p) => s + p.contracted_rate * p.notional_base, 0) / totalHedgeNotional
        : null

      const currentSpot = fxRates[pair] ?? null

      const rateVariance = avgHedgeRate !== null ? avgHedgeRate - budgetRate : null
      const spotVariance = currentSpot !== null ? currentSpot - budgetRate : null
      const impliedPnL = rateVariance !== null && notionalBudget > 0 ? rateVariance * notionalBudget : null
      const spotImpliedPnL = spotVariance !== null && notionalBudget > 0 ? spotVariance * notionalBudget : null

      return {
        pair,
        budgetRate,
        avgHedgeRate,
        currentSpot,
        notionalBudget,
        rateVariance,
        spotVariance,
        impliedPnL,
        spotImpliedPnL,
        hedgedPositionCount: pairPositions.length,
        quoteCurrency,
      }
    })
  }, [rates, positions, fxRates])

  const maxNotional = useMemo(() => Math.max(...variances.map(v => v.notionalBudget), 1), [variances])

  if (rates.length === 0) {
    return (
      <div className="empty-state">
        <CircleDollarSign size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>
          Configure budget rates first
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Add budget rates to enable budget vs actual variance analysis.
        </div>
        <button className="btn btn-primary btn-sm" onClick={onSwitchToRates}>
          Go to Rates
        </button>
      </div>
    )
  }

  // Summary tiles
  const favorableCount = variances.filter(v => v.rateVariance !== null && v.rateVariance > 0).length
  const unfavorableCount = variances.filter(v => v.rateVariance !== null && v.rateVariance < 0).length
  const totalImpliedPnL = variances.reduce((s, v) => s + (v.impliedPnL ?? 0), 0)

  return (
    <div>
      {/* Info box */}
      <div style={{
        display: 'flex', gap: '0.625rem', alignItems: 'flex-start',
        background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 'var(--r-md)',
        padding: '0.75rem', marginBottom: '1.25rem',
      }}>
        <Info size={14} style={{ color: '#0284c7', flexShrink: 0, marginTop: '0.125rem' }} />
        <p style={{ margin: 0, fontSize: '0.8125rem', color: '#0369a1', lineHeight: 1.5 }}>
          <strong>Positive rate variance</strong> means your hedge rate is higher than budget. For receivables this is favorable (you locked in more); for payables this is unfavorable (you pay more). Review per-position direction for full context.
        </p>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <SummaryTile label="Pairs Analyzed" value={variances.length.toString()} color="var(--teal)" />
        <SummaryTile label="Favorable vs Budget" value={favorableCount.toString()} color="#10b981" />
        <SummaryTile label="Unfavorable vs Budget" value={unfavorableCount.toString()} color="#ef4444" />
        <SummaryTile
          label="Total Implied P&L"
          value={formatCurrency(Math.abs(totalImpliedPnL), 'USD', true)}
          color={totalImpliedPnL >= 0 ? '#10b981' : '#ef4444'}
          prefix={totalImpliedPnL >= 0 ? '+' : '-'}
        />
      </div>

      {/* Per-pair cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
        {variances.map(v => {
          const parsed = parseCurrencyPair(v.pair)
          const baseFlag = parsed ? currencyFlag(parsed.base) : '💱'
          const isFavorable = v.rateVariance !== null && v.rateVariance > 0
          const isUnfavorable = v.rateVariance !== null && v.rateVariance < 0
          const notionalBarWidth = v.notionalBudget > 0 ? Math.min((v.notionalBudget / maxNotional) * 100, 100) : 0

          return (
            <div key={v.pair} className="card" style={{ background: 'var(--bg-card)' }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>{baseFlag}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
                    {v.pair}
                  </span>
                </div>
                {v.rateVariance === null ? (
                  <span className="badge badge-gray">No Hedges</span>
                ) : isFavorable ? (
                  <span className="badge badge-green">Favorable</span>
                ) : isUnfavorable ? (
                  <span className="badge badge-red">Unfavorable</span>
                ) : (
                  <span className="badge badge-gray">At Budget</span>
                )}
              </div>

              {/* Rate comparison */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.875rem' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Budget Rate</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9375rem', fontWeight: 700, color: '#3b82f6' }}>
                    {v.budgetRate.toFixed(4)}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg Hedge Rate</div>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.9375rem', fontWeight: 700,
                    color: v.avgHedgeRate === null ? 'var(--text-muted)' : isFavorable ? '#10b981' : isUnfavorable ? '#ef4444' : 'var(--text-primary)',
                  }}>
                    {v.avgHedgeRate !== null ? v.avgHedgeRate.toFixed(4) : '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Spot</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                    {v.currentSpot !== null ? v.currentSpot.toFixed(4) : '—'}
                  </div>
                </div>
              </div>

              {/* Rate variance line */}
              {v.rateVariance !== null && (
                <div style={{
                  fontSize: '0.8125rem',
                  color: isFavorable ? '#10b981' : isUnfavorable ? '#ef4444' : 'var(--text-muted)',
                  marginBottom: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                }}>
                  Hedge vs Budget:{' '}
                  <strong>
                    {v.rateVariance >= 0 ? '+' : ''}{v.rateVariance.toFixed(4)}
                  </strong>{' '}
                  <span style={{ fontFamily: 'inherit', fontWeight: 'normal', opacity: 0.8 }}>
                    ({isFavorable ? 'favorable' : isUnfavorable ? 'unfavorable' : 'at budget'})
                  </span>
                </div>
              )}

              {/* Notional bar */}
              {v.notionalBudget > 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Budget Notional</span>
                    <span style={{ fontSize: '0.6875rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      {formatCurrency(v.notionalBudget, v.quoteCurrency, true)}
                    </span>
                  </div>
                  <div style={{ height: 4, background: 'var(--border)', borderRadius: 999 }}>
                    <div style={{ height: '100%', width: `${notionalBarWidth}%`, background: 'var(--teal)', borderRadius: 999 }} />
                  </div>
                </div>
              )}

              {/* Implied P&L */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: v.impliedPnL === null ? 'var(--bg-surface)' : v.impliedPnL >= 0 ? '#f0fdfa' : '#fef2f2',
                borderRadius: 'var(--r-md)', padding: '0.5rem 0.75rem',
              }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Implied P&L</span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.875rem',
                  color: v.impliedPnL === null ? 'var(--text-muted)' : v.impliedPnL >= 0 ? '#10b981' : '#ef4444',
                }}>
                  {v.impliedPnL !== null
                    ? `${v.impliedPnL >= 0 ? '+' : ''}${formatCurrency(v.impliedPnL, v.quoteCurrency, true)}`
                    : '—'
                  }
                </span>
              </div>

              {/* Sub-text */}
              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Based on {v.hedgedPositionCount} hedge position{v.hedgedPositionCount !== 1 ? 's' : ''} · Budget notional {formatCurrency(v.notionalBudget, v.quoteCurrency, true)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SummaryTile({ label, value, color, prefix = '' }: { label: string; value: string; color: string; prefix?: string }) {
  return (
    <div className="card" style={{ background: 'var(--bg-card)', textAlign: 'center' }}>
      <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.375rem', fontWeight: 700, color }}>{prefix}{value}</div>
    </div>
  )
}

// ── Upload Tab ───────────────────────────────────────────────

interface UploadTabProps {
  onAddRates: (rows: Omit<BudgetRate, 'id' | 'uploaded_at'>[]) => Promise<void>
  onSwitchToRates: () => void
}

function UploadTab({ onAddRates, onSwitchToRates }: UploadTabProps) {
  const { user, db } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<{ rows: ParsedBudgetRate[]; errors: string[]; warnings: string[] } | null>(null)
  const [importDone, setImportDone] = useState(false)
  const [fileName, setFileName] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  async function handleFile(file: File) {
    if (!file.name.match(/\.csv$/i)) return
    setParsing(true)
    setImportDone(false)
    setImportError(null)
    setFileName(file.name)
    setSelectedFile(file)
    const result = await parseBudgetRatesCsv(file)
    setParsed(result)
    setParsing(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  async function handleConfirmImport() {
    if (!parsed || parsed.rows.length === 0) return
    setImportError(null)
    const orgId = user?.profile?.org_id
    if (orgId && selectedFile) {
      const dupeCheck = await checkFileAlreadyUploaded(db, orgId, selectedFile, 'budget_rates')
      if (dupeCheck.isDuplicate) {
        setImportError(`This file was already uploaded on ${formatUploadDate(dupeCheck.uploadedAt!)}. To re-upload, first clear the existing data.`)
        return
      }
    }
    try {
      await onAddRates(parsed.rows)
      if (orgId && selectedFile) {
        await recordUploadBatch(db, orgId, user?.id, selectedFile, 'budget_rates', parsed.rows.length)
      }
      setImportDone(true)
    } catch (err: any) {
      const msg: string = err?.message ?? ''
      if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique')) {
        setImportError(`Some records were skipped — they already exist in the database. ${parsed.rows.length} records were submitted.`)
        setImportDone(true)
      } else {
        setImportError(`Import failed: ${msg}`)
      }
    }
  }

  function handleReset() {
    setParsed(null)
    setImportDone(false)
    setFileName('')
    setSelectedFile(null)
    setImportError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '1.5rem', alignItems: 'start' }}>
      <div>
        {/* Success state */}
        {importDone && parsed && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem',
            padding: '2rem', background: '#f0fdfa', border: '1px solid #6ee7b7',
            borderRadius: 'var(--r-lg)', marginBottom: '1rem', textAlign: 'center',
          }}>
            <CheckCircle size={36} style={{ color: '#10b981' }} />
            <div style={{ fontWeight: 600, fontSize: '1rem', color: '#065f46' }}>
              {parsed.rows.length} rate{parsed.rows.length !== 1 ? 's' : ''} imported successfully!
            </div>
            <div style={{ display: 'flex', gap: '0.625rem' }}>
              <button className="btn btn-ghost btn-sm" onClick={handleReset}>Import Another</button>
              <button className="btn btn-primary btn-sm" onClick={onSwitchToRates}>View Rates</button>
            </div>
          </div>
        )}

        {/* Drop zone */}
        {!importDone && (
          <>
            <div
              onClick={() => fileRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              style={{
                border: `2px dashed ${dragging ? 'var(--teal)' : 'var(--border)'}`,
                borderRadius: 'var(--r-lg)',
                padding: '2.5rem',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem',
                cursor: 'pointer',
                background: dragging ? '#f0fdfa' : 'var(--bg-surface)',
                transition: 'all 0.15s',
                marginBottom: '1rem',
              }}
            >
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFileChange} style={{ display: 'none' }} />
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {parsing ? (
                  <div className="spinner" style={{ width: 20, height: 20 }} />
                ) : (
                  <Upload size={20} style={{ color: 'var(--teal)' }} />
                )}
              </div>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9375rem', textAlign: 'center', marginBottom: '0.25rem' }}>
                  Choose a CSV file or drag it here
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', textAlign: 'center' }}>
                  {parsing ? `Parsing ${fileName}…` : 'Budget rates CSV, max 5MB'}
                </div>
              </div>
            </div>

            {/* Parse results */}
            {parsed && !parsing && (
              <div>
                {/* Errors */}
                {parsed.errors.length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <AlertCircle size={14} style={{ color: '#ef4444' }} />
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#ef4444' }}>
                        {parsed.errors.length} error{parsed.errors.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {parsed.errors.map((e, i) => (
                        <li key={i} style={{ fontSize: '0.8125rem', color: '#ef4444' }}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {/* Warnings */}
                {parsed.warnings.length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <AlertCircle size={14} style={{ color: '#f59e0b' }} />
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#f59e0b' }}>
                        {parsed.warnings.length} warning{parsed.warnings.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {parsed.warnings.map((w, i) => (
                        <li key={i} style={{ fontSize: '0.8125rem', color: '#d97706' }}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Preview table */}
                {parsed.rows.length > 0 && (
                  <>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                      Preview — {parsed.rows.length} row{parsed.rows.length !== 1 ? 's' : ''}
                    </div>
                    <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                        <thead>
                          <tr>
                            {['Pair', 'Budget Rate', 'FY', 'Period', 'Notional'].map(h => (
                              <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.625rem', color: 'var(--text-muted)', fontWeight: 500, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {parsed.rows.slice(0, 10).map((r, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                              <td style={{ padding: '0.5rem 0.625rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 500 }}>{r.currency_pair}</td>
                              <td style={{ padding: '0.5rem 0.625rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{r.budget_rate.toFixed(4)}</td>
                              <td style={{ padding: '0.5rem 0.625rem', color: 'var(--text-secondary)' }}>{r.fiscal_year}</td>
                              <td style={{ padding: '0.5rem 0.625rem', color: 'var(--text-secondary)' }}>{r.period}</td>
                              <td style={{ padding: '0.5rem 0.625rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                                {r.notional_budget > 0 ? formatCurrency(r.notional_budget, 'CAD', true) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {parsed.rows.length > 10 && (
                        <div style={{ padding: '0.375rem 0.625rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                          …and {parsed.rows.length - 10} more rows
                        </div>
                      )}
                    </div>

                    {importError && (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--r-lg)', marginBottom: '0.75rem' }}>
                        <AlertCircle size={15} style={{ color: '#ef4444', flexShrink: 0, marginTop: '0.125rem' }} />
                        <span style={{ fontSize: '0.8125rem', color: '#ef4444' }}>{importError}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '0.625rem' }}>
                      <button className="btn btn-ghost btn-sm" onClick={handleReset}>
                        <X size={13} style={{ marginRight: '0.25rem' }} /> Clear
                      </button>
                      <button className="btn btn-primary btn-sm" onClick={handleConfirmImport} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        <Check size={13} /> Confirm & Import {parsed.rows.length} rate{parsed.rows.length !== 1 ? 's' : ''}
                      </button>
                    </div>
                  </>
                )}

                {parsed.rows.length === 0 && parsed.errors.length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No valid rows found in file.</div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Sidebar: format guide + template */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="card" style={{ background: 'var(--bg-card)' }}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <FileText size={14} style={{ color: 'var(--teal)' }} /> Format Guide
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {[
              { col: 'currency_pair', desc: 'USD/CAD format', req: true },
              { col: 'budget_rate', desc: 'Positive number (e.g. 1.3200)', req: true },
              { col: 'fiscal_year', desc: '2020–2030 (defaults to current)', req: false },
              { col: 'period', desc: 'Annual, Q1–Q4, or month name', req: false },
              { col: 'notional_budget', desc: 'Amount (defaults to 0)', req: false },
              { col: 'description', desc: 'Optional notes', req: false },
            ].map(({ col, desc, req }) => (
              <div key={col} style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <code style={{ fontSize: '0.75rem', background: 'var(--bg-surface)', padding: '0.125rem 0.375rem', borderRadius: 'var(--r-sm)', color: 'var(--teal)', fontFamily: 'var(--font-mono)' }}>{col}</code>
                  {req && <span className="badge badge-red" style={{ fontSize: '0.625rem', padding: '0.1rem 0.375rem' }}>required</span>}
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', paddingLeft: '0.25rem' }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ background: 'var(--bg-card)' }}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
            Template
          </div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            Download a pre-formatted CSV template with 3 example rows.
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={downloadBudgetRateTemplate}
            style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', width: '100%', justifyContent: 'center' }}
          >
            <Download size={13} /> Download Template
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────

type TabId = 'rates' | 'variance' | 'upload'

export function BudgetRatesPage() {
  const { rates, addRate, addRates, updateRate, deleteRate } = useBudgetRates()
  const [activeTab, setActiveTab] = useState<TabId>('rates')

  return (
    <div className="page-content fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, marginBottom: '0.25rem' }}>
            Budget FX Rates
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>
            Manage FX budget rates and analyze variance against actual hedge positions.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {rates.length} rate{rates.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-bar" style={{ marginBottom: '1.5rem' }}>
        {(['rates', 'variance', 'upload'] as TabId[]).map(tab => (
          <button
            key={tab}
            className={`tab${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'rates' && 'Rates'}
            {tab === 'variance' && 'Variance'}
            {tab === 'upload' && 'Upload'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'rates' && (
        <RatesTab
          rates={rates}
          onAdd={addRate}
          onUpdate={updateRate}
          onDelete={deleteRate}
          onSwitchToUpload={() => setActiveTab('upload')}
        />
      )}
      {activeTab === 'variance' && (
        <VarianceTab
          rates={rates}
          onSwitchToRates={() => setActiveTab('rates')}
        />
      )}
      {activeTab === 'upload' && (
        <UploadTab
          onAddRates={addRates}
          onSwitchToRates={() => setActiveTab('rates')}
        />
      )}
    </div>
  )
}
