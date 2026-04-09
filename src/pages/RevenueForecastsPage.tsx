import { useState, useMemo } from 'react'
import {
  Upload, Plus, Pencil, Trash2, X, Check,
  AlertCircle, LineChart,
} from 'lucide-react'
import { useRevenueForecasts } from '@/hooks/useRevenueForecasts'
import type { RevenueForecast } from '@/hooks/useRevenueForecasts'
import { useHedgeCoverage } from '@/hooks/useData'
import { parseRevenueForecastCsv, downloadRevenueForecastTemplate } from '@/lib/revenueForecastParser'
import { UploadWizard } from '@/components/upload/UploadWizard'

// ── Constants ─────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear()
const FISCAL_YEARS = [2024, 2025, 2026, ...(CURRENT_YEAR > 2026 ? [CURRENT_YEAR] : [])]

// Hardcoded USD conversion rates for display purposes
const USD_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 1.09,
  GBP: 1.27,
  JPY: 0.0067,
  CAD: 0.73,
  AUD: 0.65,
  CHF: 1.11,
  CNY: 0.14,
}

function toUsd(amount: number, currency: string): number {
  const rate = USD_RATES[currency] ?? 1.0
  return amount * rate
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    notation: Math.abs(amount) >= 1_000_000 ? 'compact' : 'standard',
  }).format(amount)
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    notation: Math.abs(amount) >= 1_000_000 ? 'compact' : 'standard',
  }).format(amount)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Forecast Modal ────────────────────────────────────────────

interface ForecastModalProps {
  initial?: RevenueForecast | null
  onSave: (data: Omit<RevenueForecast, 'id' | 'uploaded_at'>) => void
  onClose: () => void
}

function ForecastModal({ initial, onSave, onClose }: ForecastModalProps) {
  const [currency, setCurrency]     = useState(initial?.currency ?? '')
  const [amount, setAmount]         = useState(initial?.amount?.toString() ?? '')
  const [period, setPeriod]         = useState(initial?.period ?? '')
  const [fiscalYear, setFiscalYear] = useState(initial?.fiscal_year?.toString() ?? CURRENT_YEAR.toString())
  const [segment, setSegment]       = useState(initial?.segment ?? '')
  const [region, setRegion]         = useState(initial?.region ?? '')
  const [description, setDesc]      = useState(initial?.description ?? '')
  const [formError, setFormError]   = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')

    const currencyClean = currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(currencyClean)) {
      setFormError('Currency must be a 3-letter ISO code (e.g. EUR, GBP, USD)')
      return
    }
    const amountNum = parseFloat(amount.replace(/,/g, ''))
    if (isNaN(amountNum)) {
      setFormError('Amount must be a valid number')
      return
    }
    const periodClean = period.trim()
    if (!periodClean) {
      setFormError('Period is required (e.g. Q1 2025, Jan 2025)')
      return
    }
    const yearNum = parseInt(fiscalYear, 10)
    if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
      setFormError('Fiscal year must be a valid 4-digit year')
      return
    }

    onSave({
      currency: currencyClean,
      amount: amountNum,
      period: periodClean,
      fiscal_year: yearNum,
      segment: segment.trim(),
      region: region.trim(),
      description: description.trim(),
    })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: '1rem',
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 520, background: 'var(--bg-card)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            {initial ? 'Edit Forecast' : 'Add Forecast'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Currency *</label>
              <input
                className="input"
                placeholder="EUR"
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}
                maxLength={3}
              />
            </div>
            <div>
              <label className="label">Amount *</label>
              <input
                className="input"
                type="number"
                placeholder="500000"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Period *</label>
              <input
                className="input"
                placeholder="Q1 2025"
                value={period}
                onChange={e => setPeriod(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label className="label">Fiscal Year *</label>
              <input
                className="input"
                type="number"
                min={2000}
                max={2100}
                value={fiscalYear}
                onChange={e => setFiscalYear(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Segment</label>
              <input
                className="input"
                placeholder="Enterprise"
                value={segment}
                onChange={e => setSegment(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label className="label">Region</label>
              <input
                className="input"
                placeholder="EMEA"
                value={region}
                onChange={e => setRegion(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div>
            <label className="label">Description</label>
            <input
              className="input"
              placeholder="Optional notes"
              value={description}
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
              {initial ? 'Save Changes' : 'Add Forecast'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Forecasts Tab ─────────────────────────────────────────────

interface ForecastsTabProps {
  forecasts: RevenueForecast[]
  onAdd: (data: Omit<RevenueForecast, 'id' | 'uploaded_at'>) => void
  onUpdate: (id: string, updates: Partial<RevenueForecast>) => void
  onDelete: (id: string) => void
  onSwitchToUpload: () => void
}

function ForecastsTab({ forecasts, onAdd, onUpdate, onDelete, onSwitchToUpload }: ForecastsTabProps) {
  const [selectedYear, setSelectedYear]     = useState(CURRENT_YEAR)
  const [currencyFilter, setCurrencyFilter] = useState('All')
  const [showModal, setShowModal]           = useState(false)
  const [editingForecast, setEditingForecast] = useState<RevenueForecast | null>(null)
  const [deletingId, setDeletingId]         = useState<string | null>(null)

  const years = useMemo(() => {
    const fromData = forecasts.map(f => f.fiscal_year)
    const all = new Set([...FISCAL_YEARS, ...fromData])
    return Array.from(all).sort()
  }, [forecasts])

  const currencies = useMemo(() => {
    const distinct = Array.from(new Set(forecasts.map(f => f.currency))).sort()
    return ['All', ...distinct]
  }, [forecasts])

  const filtered = useMemo(() => {
    return forecasts.filter(f => {
      if (f.fiscal_year !== selectedYear) return false
      if (currencyFilter !== 'All' && f.currency !== currencyFilter) return false
      return true
    })
  }, [forecasts, selectedYear, currencyFilter])

  // Footer: total count + amount sum by currency
  const amountByCurrency = useMemo(() => {
    const map = new Map<string, number>()
    for (const f of filtered) {
      map.set(f.currency, (map.get(f.currency) ?? 0) + f.amount)
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [filtered])

  function handleSave(data: Omit<RevenueForecast, 'id' | 'uploaded_at'>) {
    if (editingForecast) {
      onUpdate(editingForecast.id, data)
    } else {
      onAdd(data)
    }
    setShowModal(false)
    setEditingForecast(null)
  }

  function handleEdit(f: RevenueForecast) {
    setEditingForecast(f)
    setShowModal(true)
  }

  function handleAddNew() {
    setEditingForecast(null)
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

        <select
          className="input"
          value={currencyFilter}
          onChange={e => setCurrencyFilter(e.target.value)}
          style={{ height: 32, padding: '0 0.625rem', fontSize: '0.8125rem', minWidth: 100 }}
        >
          {currencies.map(c => <option key={c} value={c}>{c === 'All' ? 'All Currencies' : c}</option>)}
        </select>

        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {filtered.length} record{filtered.length !== 1 ? 's' : ''}
        </span>

        <button className="btn btn-ghost btn-sm" onClick={onSwitchToUpload} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Upload size={13} /> Import CSV
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleAddNew} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Plus size={13} /> Add Forecast
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <LineChart size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>
            No forecasts for FY{selectedYear}{currencyFilter !== 'All' ? ` · ${currencyFilter}` : ''}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Import a CSV file or add forecasts manually to get started.
          </div>
          <button className="btn btn-primary btn-sm" onClick={onSwitchToUpload} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <Upload size={13} /> Upload CSV
          </button>
        </div>
      ) : (
        <>
          <div className="data-table">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Currency', 'Amount', 'Period', 'Segment', 'Region', 'Description', 'Uploaded', 'Actions'].map(h => (
                    <th key={h} style={{
                      textAlign: h === 'Amount' ? 'right' : h === 'Actions' ? 'center' : 'left',
                      padding: '0.625rem 0.75rem',
                      color: 'var(--text-muted)',
                      fontWeight: 500,
                      fontSize: '0.75rem',
                      borderBottom: '1px solid var(--border)',
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(f => {
                  const isDeleting = deletingId === f.id
                  return (
                    <tr key={f.id} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                      <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                        <span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700 }}>
                          {f.currency}
                        </span>
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                        {formatAmount(f.amount, f.currency)}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                        <span className="badge badge-gray" style={{ fontSize: '0.75rem' }}>{f.period}</span>
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                        {f.segment || '—'}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                        {f.region || '—'}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.8125rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.description || '—'}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                        {formatDate(f.uploaded_at)}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {isDeleting ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', justifyContent: 'center' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Confirm?</span>
                            <button
                              className="btn btn-sm"
                              style={{ background: 'var(--red)', color: '#fff', border: 'none', padding: '0.2rem 0.5rem' }}
                              onClick={() => { onDelete(f.id); setDeletingId(null) }}
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
                              onClick={() => handleEdit(f)}
                              style={{ padding: '0.25rem' }}
                              title="Edit"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setDeletingId(f.id)}
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem 0.75rem', borderTop: '1px solid var(--border)', marginTop: '0.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              {filtered.length} record{filtered.length !== 1 ? 's' : ''} in view
            </span>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {amountByCurrency.map(([ccy, total]) => (
                <span key={ccy} style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--teal)' }}>{ccy}</span>
                  {' '}
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{formatAmount(total, ccy)}</span>
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {showModal && (
        <ForecastModal
          initial={editingForecast}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingForecast(null) }}
        />
      )}
    </div>
  )
}

// ── Analysis Tab ──────────────────────────────────────────────

interface AnalysisTabProps {
  forecasts: RevenueForecast[]
  onSwitchToUpload: () => void
}

function AnalysisTab({ forecasts, onSwitchToUpload }: AnalysisTabProps) {
  const { coverage } = useHedgeCoverage()

  const totalUsd = useMemo(
    () => forecasts.reduce((s, f) => s + toUsd(f.amount, f.currency), 0),
    [forecasts]
  )

  const byCurrency = useMemo(() => {
    const map = new Map<string, { total: number; periods: Map<string, number>; segments: Map<string, number> }>()
    for (const f of forecasts) {
      if (!map.has(f.currency)) {
        map.set(f.currency, { total: 0, periods: new Map(), segments: new Map() })
      }
      const entry = map.get(f.currency)!
      entry.total += f.amount
      entry.periods.set(f.period, (entry.periods.get(f.period) ?? 0) + f.amount)
      if (f.segment) {
        entry.segments.set(f.segment, (entry.segments.get(f.segment) ?? 0) + f.amount)
      }
    }
    return Array.from(map.entries())
      .map(([currency, data]) => ({
        currency,
        total: data.total,
        usd: toUsd(data.total, currency),
        periods: Array.from(data.periods.entries()).sort((a, b) => a[0].localeCompare(b[0])),
        segments: Array.from(data.segments.entries()).sort((a, b) => b[1] - a[1]),
      }))
      .sort((a, b) => b.total - a.total)
  }, [forecasts])

  const distinctCurrencies = byCurrency.length
  const distinctPeriods    = new Set(forecasts.map(f => f.period)).size
  const largestCurrency    = byCurrency[0]?.currency ?? '—'

  // Hedging coverage cross-reference
  const hedgingRows = useMemo(() => {
    return byCurrency.map(({ currency, total, usd }) => {
      // Sum total_hedged from coverage entries where currency_pair contains the currency
      const hedged = coverage
        .filter(c => c.currency_pair?.includes(currency))
        .reduce((s, c) => s + (c.total_hedged ?? 0), 0)

      const pct = total > 0 ? Math.min((hedged / total) * 100, 100) : 0

      let status: 'Covered' | 'Partial' | 'Exposed'
      if (pct >= 80)       status = 'Covered'
      else if (pct >= 40)  status = 'Partial'
      else                 status = 'Exposed'

      return { currency, total, usd, hedged, pct, status }
    })
  }, [byCurrency, coverage])

  if (forecasts.length === 0) {
    return (
      <div className="empty-state">
        <LineChart size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>
          No forecast data to analyze
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Upload revenue forecasts to enable analysis and hedging coverage comparison.
        </div>
        <button className="btn btn-primary btn-sm" onClick={onSwitchToUpload} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Upload size={13} /> Upload CSV
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
        <SummaryTile label="Total Currencies"     value={distinctCurrencies.toString()} color="var(--teal)" />
        <SummaryTile label="Total Forecast (USD)" value={formatUsd(totalUsd)}           color="#3b82f6" />
        <SummaryTile label="Largest Exposure"     value={largestCurrency}               color="#f59e0b" />
        <SummaryTile label="Periods Tracked"      value={distinctPeriods.toString()}    color="#8b5cf6" />
      </div>

      {/* Currency Breakdown */}
      <div>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.875rem', marginTop: 0 }}>
          Currency Breakdown
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
          {byCurrency.map(({ currency, total, usd, periods, segments }) => {
            const barPct = totalUsd > 0 ? Math.min((usd / totalUsd) * 100, 100) : 0
            return (
              <div key={currency} className="card" style={{ background: 'var(--bg-card)' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.875rem' }}>
                      {currency}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                      {formatAmount(total, currency)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      ≈ {formatUsd(usd)} USD
                    </div>
                  </div>
                </div>

                {/* Bar */}
                <div style={{ marginBottom: '0.875rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Share of total portfolio</span>
                    <span style={{ fontSize: '0.6875rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      {barPct.toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ height: 4, background: 'var(--border)', borderRadius: 999 }}>
                    <div style={{ height: '100%', width: `${barPct}%`, background: 'var(--teal)', borderRadius: 999 }} />
                  </div>
                </div>

                {/* Period breakdown */}
                <div style={{ marginBottom: segments.length > 0 ? '0.75rem' : 0 }}>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.375rem' }}>
                    By Period
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {periods.map(([p, amt]) => (
                      <div key={p} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>{p}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {formatAmount(amt, currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Segment breakdown */}
                {segments.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.375rem' }}>
                      By Segment
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {segments.map(([seg, amt]) => (
                        <div key={seg} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{seg}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {formatAmount(amt, currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Hedging Coverage */}
      <div>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.875rem', marginTop: 0 }}>
          Hedging Coverage
        </h3>
        <div className="data-table">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Currency', 'Total Forecast', 'Hedged Amount', 'Coverage %', 'Status'].map(h => (
                  <th key={h} style={{
                    textAlign: h === 'Coverage %' || h === 'Hedged Amount' || h === 'Total Forecast' ? 'right' : 'left',
                    padding: '0.625rem 0.75rem',
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                    fontSize: '0.75rem',
                    borderBottom: '1px solid var(--border)',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hedgingRows.map(({ currency, total, hedged, pct, status }) => (
                <tr key={currency} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                  <td style={{ padding: '0.625rem 0.75rem' }}>
                    <span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                      {currency}
                    </span>
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                    {formatAmount(total, currency)}
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: hedged > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {hedged > 0 ? formatAmount(hedged, currency) : '—'}
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                    {pct.toFixed(1)}%
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem' }}>
                    <span className={`badge ${
                      status === 'Covered'  ? 'badge-green' :
                      status === 'Partial'  ? 'badge-yellow' :
                                             'badge-red'
                    }`}>
                      {status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SummaryTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="card" style={{ background: 'var(--bg-card)', textAlign: 'center' }}>
      <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.375rem', fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

// ── Upload Tab ────────────────────────────────────────────────

interface UploadTabProps {
  onAddForecasts: (rows: Omit<RevenueForecast, 'id' | 'uploaded_at'>[]) => Promise<void>
  onSwitchToForecasts: () => void
}

function UploadTab({ onAddForecasts, onSwitchToForecasts }: UploadTabProps) {
  return (
    <UploadWizard
      label="Revenue Forecasts"
      icon={LineChart}
      color="#10b981"
      parse={parseRevenueForecastCsv}
      columns={[
        { key: 'currency',    label: 'Currency' },
        { key: 'amount',      label: 'Amount', format: (v) => v?.toLocaleString() ?? '—' },
        { key: 'period',      label: 'Period' },
        { key: 'fiscal_year', label: 'FY' },
        { key: 'segment',     label: 'Segment' },
        { key: 'region',      label: 'Region' },
      ]}
      onImport={async (rows, entityId) => {
        try {
          const enriched = rows.map(r => ({ ...r, entity_id: entityId ?? undefined }))
          await onAddForecasts(enriched)
          onSwitchToForecasts()
          return { error: null }
        } catch (err: any) {
          return { error: err?.message ?? 'Import failed' }
        }
      }}
      downloadTemplate={downloadRevenueForecastTemplate}
      onDone={onSwitchToForecasts}
    />
  )
}

// ── Page ──────────────────────────────────────────────────────

type Tab = 'forecasts' | 'analysis' | 'upload'

export function RevenueForecastsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('forecasts')
  const { forecasts, addForecast, addForecasts, updateForecast, deleteForecast } = useRevenueForecasts()

  const tabs: { id: Tab; label: string }[] = [
    { id: 'forecasts', label: 'Forecasts' },
    { id: 'analysis',  label: 'Analysis'  },
    { id: 'upload',    label: 'Upload'    },
  ]

  return (
    <div className="fade-in" style={{ padding: '1.5rem', maxWidth: 1200, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.25rem' }}>
            <LineChart size={20} style={{ color: 'var(--teal)' }} />
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Revenue Forecasts
            </h1>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>
            Manage expected revenue by currency, period, and segment. Cross-reference with hedge coverage.
          </p>
        </div>
        {forecasts.length > 0 && (
          <span className="badge badge-gray" style={{ fontSize: '0.75rem', alignSelf: 'flex-start' }}>
            {forecasts.length} total record{forecasts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '0.5rem 1rem',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === t.id ? '2px solid var(--teal)' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: activeTab === t.id ? 600 : 400,
              color: activeTab === t.id ? 'var(--teal)' : 'var(--text-muted)',
              transition: 'all 0.15s',
              marginBottom: '-1px',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="card" style={{ background: 'var(--bg-card)' }}>
        {activeTab === 'forecasts' && (
          <ForecastsTab
            forecasts={forecasts}
            onAdd={addForecast}
            onUpdate={updateForecast}
            onDelete={deleteForecast}
            onSwitchToUpload={() => setActiveTab('upload')}
          />
        )}
        {activeTab === 'analysis' && (
          <AnalysisTab
            forecasts={forecasts}
            onSwitchToUpload={() => setActiveTab('upload')}
          />
        )}
        {activeTab === 'upload' && (
          <UploadTab
            onAddForecasts={async rows => { await addForecasts(rows); setActiveTab('forecasts') }}
            onSwitchToForecasts={() => setActiveTab('forecasts')}
          />
        )}
      </div>
    </div>
  )
}
