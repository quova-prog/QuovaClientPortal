import { useState, useMemo } from 'react'
import {
  Upload, Download, Plus, Pencil, Trash2, X, Check,
  AlertCircle, Users,
} from 'lucide-react'
import { usePayroll } from '@/hooks/usePayroll'
import type { PayrollEntry } from '@/hooks/usePayroll'
import { parsePayrollCsv, downloadPayrollTemplate } from '@/lib/payrollParser'
import { useAuth } from '@/hooks/useAuth'
import { useEntity } from '@/context/EntityContext'
import { UploadWizard } from '@/components/upload/UploadWizard'
import { checkFileAlreadyUploaded, recordUploadBatch, formatUploadDate } from '@/lib/uploadDedup'

// ── Constants ─────────────────────────────────────────────────

const USD_RATES: Record<string, number> = {
  USD: 1.0, EUR: 1.09, GBP: 1.27, JPY: 0.0067,
  CAD: 0.73, AUD: 0.65, CHF: 1.11, CNY: 0.14,
}

function toUsd(amount: number, currency: string): number {
  return amount * (USD_RATES[currency] ?? 1.0)
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency,
    minimumFractionDigits: 0, maximumFractionDigits: 0,
    notation: Math.abs(amount) >= 1_000_000 ? 'compact' : 'standard',
  }).format(amount)
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
    notation: Math.abs(amount) >= 1_000_000 ? 'compact' : 'standard',
  }).format(amount)
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Payroll Modal ─────────────────────────────────────────────

interface PayrollModalProps {
  initial?: PayrollEntry | null
  onSave: (data: Omit<PayrollEntry, 'id' | 'uploaded_at'>) => void
  onClose: () => void
}

function PayrollModal({ initial, onSave, onClose }: PayrollModalProps) {
  const [payDate, setPayDate]         = useState(initial?.pay_date ?? '')
  const [currency, setCurrency]       = useState(initial?.currency ?? '')
  const [grossAmt, setGrossAmt]       = useState(initial?.gross_amount?.toString() ?? '')
  const [netAmt, setNetAmt]           = useState(initial?.net_amount?.toString() ?? '')
  const [empCount, setEmpCount]       = useState(initial?.employee_count?.toString() ?? '')
  const [entity, setEntity]           = useState(initial?.entity ?? '')
  const [department, setDepartment]   = useState(initial?.department ?? '')
  const [payPeriod, setPayPeriod]     = useState(initial?.pay_period ?? '')
  const [description, setDesc]        = useState(initial?.description ?? '')
  const [formError, setFormError]     = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!payDate) { setFormError('Pay date is required'); return }
    const cur = currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(cur)) { setFormError('Currency must be a 3-letter ISO code'); return }
    const gross = parseFloat(grossAmt.replace(/,/g, ''))
    if (isNaN(gross) || gross <= 0) { setFormError('Gross amount must be a positive number'); return }
    const net   = parseFloat(netAmt.replace(/,/g, '')) || gross
    const count = parseInt(empCount, 10) || 0
    onSave({
      pay_date: payDate,
      currency: cur,
      gross_amount: gross,
      net_amount: net,
      employee_count: count,
      entity: entity.trim(),
      department: department.trim(),
      pay_period: payPeriod.trim(),
      description: description.trim(),
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: 560, background: 'var(--bg-card)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            {initial ? 'Edit Payroll Entry' : 'Add Payroll Entry'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Pay Date *</label>
              <input className="input" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} />
            </div>
            <div>
              <label className="label">Currency *</label>
              <input className="input" placeholder="USD" value={currency} onChange={e => setCurrency(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }} maxLength={3} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Gross Amount *</label>
              <input className="input" type="number" placeholder="2450000" value={grossAmt} onChange={e => setGrossAmt(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} min={0} />
            </div>
            <div>
              <label className="label">Net Amount</label>
              <input className="input" type="number" placeholder="1960000" value={netAmt} onChange={e => setNetAmt(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} min={0} />
            </div>
            <div>
              <label className="label">Employees</label>
              <input className="input" type="number" placeholder="125" value={empCount} onChange={e => setEmpCount(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} min={0} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Entity</label>
              <input className="input" placeholder="Acme Corp USA" value={entity} onChange={e => setEntity(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label className="label">Department</label>
              <input className="input" placeholder="Engineering" value={department} onChange={e => setDepartment(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div>
            <label className="label">Pay Period</label>
            <input className="input" placeholder="2025-Q1 or 2025-03 or Jan 2025" value={payPeriod} onChange={e => setPayPeriod(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" placeholder="Optional notes" value={description} onChange={e => setDesc(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>
          {formError && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--red)', fontSize: '0.8125rem' }}>
              <AlertCircle size={14} /> {formError}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm">{initial ? 'Save Changes' : 'Add Entry'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Payroll Tab ───────────────────────────────────────────────

interface PayrollTabProps {
  entries: PayrollEntry[]
  onAdd: (data: Omit<PayrollEntry, 'id' | 'uploaded_at'>) => void
  onUpdate: (id: string, updates: Partial<PayrollEntry>) => void
  onDelete: (id: string) => void
  onSwitchToUpload: () => void
}

function PayrollTab({ entries, onAdd, onUpdate, onDelete, onSwitchToUpload }: PayrollTabProps) {
  const [currencyFilter, setCurrencyFilter] = useState('All')
  const [entityFilter, setEntityFilter]     = useState('All')
  const [periodFilter, setPeriodFilter]     = useState('All')
  const [showModal, setShowModal]           = useState(false)
  const [editingEntry, setEditingEntry]     = useState<PayrollEntry | null>(null)
  const [deletingId, setDeletingId]         = useState<string | null>(null)

  const currencies = useMemo(() => ['All', ...Array.from(new Set(entries.map(e => e.currency))).sort()], [entries])
  const entities   = useMemo(() => ['All', ...Array.from(new Set(entries.map(e => e.entity).filter(Boolean))).sort()], [entries])
  const periods    = useMemo(() => ['All', ...Array.from(new Set(entries.map(e => e.pay_period).filter(Boolean))).sort()], [entries])

  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (currencyFilter !== 'All' && e.currency !== currencyFilter) return false
      if (entityFilter !== 'All' && e.entity !== entityFilter) return false
      if (periodFilter !== 'All' && e.pay_period !== periodFilter) return false
      return true
    })
  }, [entries, currencyFilter, entityFilter, periodFilter])

  const footerTotals = useMemo(() => {
    const map = new Map<string, { gross: number; net: number; count: number }>()
    for (const e of filtered) {
      const cur = map.get(e.currency) ?? { gross: 0, net: 0, count: 0 }
      cur.gross += e.gross_amount
      cur.net   += e.net_amount
      cur.count += e.employee_count
      map.set(e.currency, cur)
    }
    return Array.from(map.entries()).sort((a, b) => toUsd(b[1].gross, b[0]) - toUsd(a[1].gross, a[0]))
  }, [filtered])

  function handleSave(data: Omit<PayrollEntry, 'id' | 'uploaded_at'>) {
    if (editingEntry) { onUpdate(editingEntry.id, data) } else { onAdd(data) }
    setShowModal(false); setEditingEntry(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select className="input" value={currencyFilter} onChange={e => setCurrencyFilter(e.target.value)} style={{ height: 32, padding: '0 0.625rem', fontSize: '0.8125rem', minWidth: 120 }}>
          {currencies.map(c => <option key={c} value={c}>{c === 'All' ? 'All Currencies' : c}</option>)}
        </select>
        <select className="input" value={entityFilter} onChange={e => setEntityFilter(e.target.value)} style={{ height: 32, padding: '0 0.625rem', fontSize: '0.8125rem', minWidth: 160 }}>
          {entities.map(e => <option key={e} value={e}>{e === 'All' ? 'All Entities' : e}</option>)}
        </select>
        <select className="input" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)} style={{ height: 32, padding: '0 0.625rem', fontSize: '0.8125rem', minWidth: 140 }}>
          {periods.map(p => <option key={p} value={p}>{p === 'All' ? 'All Periods' : p}</option>)}
        </select>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
          {filtered.length} record{filtered.length !== 1 ? 's' : ''}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onSwitchToUpload} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Upload size={13} /> Import CSV
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => { setEditingEntry(null); setShowModal(true) }} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Plus size={13} /> Add Entry
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <Users size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>No payroll entries found</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>Import a CSV file or add entries manually.</div>
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
                  {['Pay Date', 'Currency', 'Gross Amount', 'Net Amount', 'Employees', 'Entity', 'Department', 'Period', 'Actions'].map(h => (
                    <th key={h} style={{
                      textAlign: h === 'Gross Amount' || h === 'Net Amount' || h === 'Employees' ? 'right' : h === 'Actions' ? 'center' : 'left',
                      padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => {
                  const isDeleting = deletingId === e.id
                  return (
                    <tr key={e.id} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                      <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{formatDate(e.pay_date)}</td>
                      <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                        <span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700 }}>{e.currency}</span>
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                        {formatAmount(e.gross_amount, e.currency)}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {formatAmount(e.net_amount, e.currency)}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                        {e.employee_count > 0 ? e.employee_count.toLocaleString() : '—'}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{e.entity || '—'}</td>
                      <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{e.department || '—'}</td>
                      <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{e.pay_period || '—'}</td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {isDeleting ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', justifyContent: 'center' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Confirm?</span>
                            <button className="btn btn-sm" style={{ background: 'var(--red)', color: '#fff', border: 'none', padding: '0.2rem 0.5rem' }} onClick={() => { onDelete(e.id); setDeletingId(null) }}><Check size={11} /></button>
                            <button className="btn btn-ghost btn-sm" style={{ padding: '0.2rem 0.5rem' }} onClick={() => setDeletingId(null)}><X size={11} /></button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', justifyContent: 'center' }}>
                            <button className="btn btn-ghost btn-sm" style={{ padding: '0.25rem' }} title="Edit" onClick={() => { setEditingEntry(e); setShowModal(true) }}><Pencil size={13} /></button>
                            <button className="btn btn-ghost btn-sm" style={{ padding: '0.25rem', color: 'var(--red)' }} title="Delete" onClick={() => setDeletingId(e.id)}><Trash2 size={13} /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {footerTotals.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginTop: '0.875rem', padding: '0.75rem 1rem', background: 'var(--bg-app)', borderRadius: 'var(--r-md)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Totals:</span>
              {footerTotals.map(([ccy, v]) => (
                <span key={ccy} style={{ fontSize: '0.875rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.75rem', marginRight: '0.25rem' }}>{ccy}</span>
                  {formatAmount(v.gross, ccy)}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.75rem', marginLeft: '0.25rem' }}>gross</span>
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {showModal && (
        <PayrollModal initial={editingEntry} onSave={handleSave} onClose={() => { setShowModal(false); setEditingEntry(null) }} />
      )}
    </div>
  )
}

// ── Analysis Tab ──────────────────────────────────────────────

function AnalysisTab({ entries }: { entries: PayrollEntry[] }) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])

  const totalGrossUsd = useMemo(() => entries.reduce((s, e) => s + toUsd(e.gross_amount, e.currency), 0), [entries])
  const totalNetUsd   = useMemo(() => entries.reduce((s, e) => s + toUsd(e.net_amount, e.currency), 0), [entries])
  const totalEmployees = useMemo(() => entries.reduce((s, e) => s + e.employee_count, 0), [entries])
  const currencyCount  = useMemo(() => new Set(entries.map(e => e.currency)).size, [entries])

  // By currency
  const currencyBreakdown = useMemo(() => {
    const map = new Map<string, { gross: number; net: number; count: number; usd: number }>()
    for (const e of entries) {
      const cur = map.get(e.currency) ?? { gross: 0, net: 0, count: 0, usd: 0 }
      cur.gross += e.gross_amount
      cur.net   += e.net_amount
      cur.count += e.employee_count
      cur.usd   += toUsd(e.gross_amount, e.currency)
      map.set(e.currency, cur)
    }
    return Array.from(map.entries()).map(([ccy, v]) => ({ ccy, ...v })).sort((a, b) => b.usd - a.usd)
  }, [entries])

  // By entity
  const entityBreakdown = useMemo(() => {
    const map = new Map<string, { usd: number; count: number; currencies: Set<string> }>()
    for (const e of entries) {
      const key = e.entity || '(No Entity)'
      const cur = map.get(key) ?? { usd: 0, count: 0, currencies: new Set() }
      cur.usd += toUsd(e.gross_amount, e.currency)
      cur.count += e.employee_count
      cur.currencies.add(e.currency)
      map.set(key, cur)
    }
    return Array.from(map.entries())
      .map(([entity, v]) => ({ entity, usd: v.usd, count: v.count, currencies: Array.from(v.currencies).sort().join(', ') }))
      .sort((a, b) => b.usd - a.usd)
  }, [entries])

  // Monthly trend — last 12 months
  const monthlyTrend = useMemo(() => {
    const map = new Map<string, number>()
    const monthKeys: string[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthKeys.push(key)
      map.set(key, 0)
    }
    for (const e of entries) {
      const key = e.pay_date.slice(0, 7)
      if (map.has(key)) {
        map.set(key, (map.get(key) ?? 0) + toUsd(e.gross_amount, e.currency))
      }
    }
    return monthKeys.map(key => ({ month: key, usd: map.get(key) ?? 0 }))
  }, [entries, today])

  const maxMonthlyUsd = Math.max(...monthlyTrend.map(m => m.usd), 1)

  if (entries.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: '2rem' }}>
        <Users size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>No payroll data</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Add or import payroll entries to see analysis.</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        {[
          { label: 'Total Gross Payroll', value: formatUsd(totalGrossUsd), sub: 'USD equivalent', color: 'var(--teal)' },
          { label: 'Total Net Payroll',   value: formatUsd(totalNetUsd),   sub: 'USD equivalent', color: 'var(--teal)' },
          { label: 'Total Employees',     value: totalEmployees.toLocaleString(), sub: 'sum of employee counts', color: 'var(--teal)' },
          { label: 'Currencies',          value: currencyCount.toString(),  sub: 'distinct currencies', color: 'var(--teal)' },
        ].map(tile => (
          <div key={tile.label} className="card" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.375rem', fontWeight: 500 }}>{tile.label}</div>
            <div style={{ fontSize: '1.375rem', fontWeight: 700, color: tile.color, fontFamily: 'var(--font-mono)', lineHeight: 1.2 }}>{tile.value}</div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{tile.sub}</div>
          </div>
        ))}
      </div>

      {/* By Currency */}
      {currencyBreakdown.length > 0 && (
        <div className="card">
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>Payroll by Currency</div>
          <div className="data-table">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Currency', 'Gross', 'Net', 'Employees', '% of Total', ''].map((h, i) => (
                    <th key={i} style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', textAlign: i > 0 && i < 4 ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currencyBreakdown.map(row => {
                  const pct = totalGrossUsd > 0 ? (row.usd / totalGrossUsd * 100).toFixed(1) : '0.0'
                  const barWidth = totalGrossUsd > 0 ? (row.usd / (currencyBreakdown[0]?.usd ?? 1)) * 100 : 0
                  return (
                    <tr key={row.ccy} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                      <td style={{ padding: '0.625rem 0.75rem' }}>
                        <span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700 }}>{row.ccy}</span>
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)' }}>{formatAmount(row.gross, row.ccy)}</td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{formatAmount(row.net, row.ccy)}</td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{row.count > 0 ? row.count.toLocaleString() : '—'}</td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{pct}%</td>
                      <td style={{ padding: '0.625rem 0.75rem', minWidth: 100 }}>
                        <div style={{ height: 6, background: 'var(--border)', borderRadius: 999 }}>
                          <div style={{ height: '100%', width: `${barWidth}%`, background: 'var(--teal)', borderRadius: 999 }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* By Entity */}
      {entityBreakdown.length > 0 && (
        <div className="card">
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>Payroll by Entity</div>
          <div className="data-table">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Entity', 'Currencies', 'Employees', 'Total Gross (USD)'].map((h, i) => (
                    <th key={i} style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', textAlign: i > 1 ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entityBreakdown.map(row => (
                  <tr key={row.entity} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                    <td style={{ padding: '0.625rem 0.75rem', fontWeight: 500, color: 'var(--text-primary)', fontSize: '0.8125rem' }}>{row.entity}</td>
                    <td style={{ padding: '0.625rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.currencies}</td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{row.count > 0 ? row.count.toLocaleString() : '—'}</td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{formatUsd(row.usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Monthly Trend */}
      <div className="card">
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>Monthly Trend (Last 12 Months)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {monthlyTrend.map(({ month, usd }) => {
            const barWidth = maxMonthlyUsd > 0 ? (usd / maxMonthlyUsd) * 100 : 0
            const [year, mon] = month.split('-')
            const label = new Date(parseInt(year), parseInt(mon) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
            return (
              <div key={month} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: 72, textAlign: 'right' }}>{label}</span>
                <div style={{ flex: 1, height: 16, background: 'var(--border)', borderRadius: 4 }}>
                  <div style={{ height: '100%', width: `${barWidth}%`, background: usd > 0 ? 'var(--teal)' : 'transparent', borderRadius: 4, transition: 'width 0.4s ease' }} />
                </div>
                <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: usd > 0 ? 'var(--text-primary)' : 'var(--text-muted)', minWidth: 80, textAlign: 'right' }}>
                  {usd > 0 ? formatUsd(usd) : '—'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Upload Tab ────────────────────────────────────────────────

function UploadTab({ onImported, addEntries }: { onImported: () => void; addEntries: (rows: Omit<PayrollEntry, 'id' | 'uploaded_at'>[]) => Promise<void> }) {
  const { user, db } = useAuth()
  const { entities } = useEntity()

  return (
    <div style={{ maxWidth: 720 }}>
      <UploadWizard
        label="Payroll"
        icon={Users}
        color="#00c8a0"
        accept=".csv"
        parse={async (file) => {
          const result = await parsePayrollCsv(file)
          return { data: result.data, errors: result.errors, warnings: [] }
        }}
        columns={[
          { key: 'pay_date', label: 'Pay Date' },
          { key: 'currency', label: 'Currency' },
          { key: 'gross_amount', label: 'Gross', format: (v, row) => formatAmount(v, row.currency) },
          { key: 'net_amount', label: 'Net', format: (v, row) => formatAmount(v, row.currency) },
          { key: 'employee_count', label: 'Employees', format: (v) => v?.toLocaleString?.() ?? '—' },
          { key: 'entity', label: 'Entity' },
          { key: 'pay_period', label: 'Period' },
        ]}
        onImport={async (rows, entityId, file) => {
          const orgId = user?.profile?.org_id
          if (!orgId) return { error: 'Not authenticated' }
          if (!file) return { error: 'No file selected' }
          const selectedEntity = entityId ? entities.find(e => e.id === entityId) ?? null : null

          try {
            const dupeCheck = await checkFileAlreadyUploaded(db, orgId, file, 'payroll')
            if (dupeCheck.isDuplicate) {
              return { error: `This file was already uploaded on ${formatUploadDate(dupeCheck.uploadedAt!)}. To re-upload, first clear the existing data.` }
            }

            const enriched = rows.map(row => ({
              ...row,
              entity: row.entity?.trim() || selectedEntity?.name || '',
            }))

            await addEntries(enriched)
            await recordUploadBatch(db, orgId, user?.id, file, 'payroll', enriched.length)
            onImported()
            return { error: null }
          } catch (err: any) {
            const msg: string = err?.message ?? ''
            if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique')) {
              onImported()
              return { error: null }
            }
            return { error: msg ? `Import failed: ${msg}` : 'Import failed' }
          }
        }}
        downloadTemplate={downloadPayrollTemplate}
        onDone={onImported}
      />

      <div className="card" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>CSV Format Guide</div>
          <button className="btn btn-ghost btn-sm" onClick={downloadPayrollTemplate} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <Download size={13} /> Download Template
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[
            { col: 'pay_date',       req: true,  ex: '2025-03-31',     desc: 'Payroll payment date (YYYY-MM-DD)' },
            { col: 'currency',       req: true,  ex: 'USD',            desc: '3-letter ISO currency code' },
            { col: 'gross_amount',   req: true,  ex: '2450000',        desc: 'Total gross payroll amount' },
            { col: 'net_amount',     req: false, ex: '1960000',        desc: 'Total net (take-home) payroll amount' },
            { col: 'employee_count', req: false, ex: '125',            desc: 'Number of employees in this payroll run' },
            { col: 'entity',         req: false, ex: 'Acme Corp USA',  desc: 'Legal entity or company name' },
            { col: 'department',     req: false, ex: 'Engineering',    desc: 'Department or cost centre' },
            { col: 'pay_period',     req: false, ex: '2025-Q1',        desc: 'Pay period label (e.g. 2025-03, 2025-Q1)' },
            { col: 'description',    req: false, ex: 'Q1 2025 payroll',desc: 'Optional notes or memo' },
          ].map(({ col, req, ex, desc }) => (
            <div key={col} style={{ display: 'grid', gridTemplateColumns: '140px 60px 160px 1fr', gap: '0.5rem', alignItems: 'center', fontSize: '0.8125rem' }}>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--teal)', background: 'rgba(0,200,160,0.08)', padding: '0.15rem 0.35rem', borderRadius: 4 }}>{col}</code>
              <span style={{ fontSize: '0.6875rem' }}>
                {req ? <span className="badge badge-red" style={{ fontSize: '0.6rem' }}>required</span> : <span className="badge badge-gray" style={{ fontSize: '0.6rem' }}>optional</span>}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{ex}</span>
              <span style={{ color: 'var(--text-muted)' }}>{desc}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '0.875rem', padding: '0.625rem', background: 'var(--bg-app)', borderRadius: 'var(--r-md)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Column headers are case-insensitive. Accepted aliases: <em>gross/total_gross</em> for gross_amount, <em>net/total_net</em> for net_amount, <em>headcount/employees</em> for employee_count.
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────

type Tab = 'payroll' | 'analysis' | 'upload'

export function PayrollPage() {
  const { entries, addEntry, addEntries, updateEntry, deleteEntry, loading } = usePayroll()
  const [activeTab, setActiveTab] = useState<Tab>('payroll')

  const TABS: { key: Tab; label: string }[] = [
    { key: 'payroll',  label: 'Payroll' },
    { key: 'analysis', label: 'Analysis' },
    { key: 'upload',   label: 'Upload' },
  ]

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    )
  }

  return (
    <div className="fade-in" style={{ padding: '1.5rem', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
            <Users size={20} style={{ color: 'var(--teal)' }} />
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Payroll by Currency</h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>Track multi-currency payroll obligations, headcount and entity breakdowns.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{entries.length} entr{entries.length !== 1 ? 'ies' : 'y'}</span>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 1.25rem' }}>
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
              padding: '0.875rem 1rem', fontSize: '0.875rem',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
              background: 'none', border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid var(--teal)' : '2px solid transparent',
              cursor: 'pointer', transition: 'all 0.15s', marginBottom: -1,
            }}>
              {tab.label}
              {tab.key === 'payroll' && entries.length > 0 && (
                <span style={{ marginLeft: '0.5rem', fontSize: '0.6875rem', background: 'var(--bg-app)', color: 'var(--text-muted)', padding: '0.1rem 0.4rem', borderRadius: 999, fontWeight: 400 }}>{entries.length}</span>
              )}
            </button>
          ))}
        </div>
        <div style={{ padding: '1.25rem' }}>
          {activeTab === 'payroll' && <PayrollTab entries={entries} onAdd={addEntry} onUpdate={updateEntry} onDelete={deleteEntry} onSwitchToUpload={() => setActiveTab('upload')} />}
          {activeTab === 'analysis' && <AnalysisTab entries={entries} />}
          {activeTab === 'upload' && <UploadTab addEntries={addEntries} onImported={() => setActiveTab('payroll')} />}
        </div>
      </div>
    </div>
  )
}
