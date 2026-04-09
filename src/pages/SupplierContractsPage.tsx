import { useState, useRef, useMemo, useCallback } from 'react'
import {
  Upload, Download, Plus, Pencil, Trash2, X, Check,
  AlertCircle, CheckCircle, Truck,
} from 'lucide-react'
import { useSupplierContracts } from '@/hooks/useSupplierContracts'
import type { SupplierContract } from '@/hooks/useSupplierContracts'
import { parseSupplierContractCsv, downloadSupplierContractTemplate } from '@/lib/supplierContractParser'
import { useAuth } from '@/hooks/useAuth'
import { checkFileAlreadyUploaded, recordUploadBatch, formatUploadDate } from '@/lib/uploadDedup'

const USD_RATES: Record<string, number> = {
  USD: 1.0, EUR: 1.09, GBP: 1.27, JPY: 0.0067,
  CAD: 0.73, AUD: 0.65, CHF: 1.11, CNY: 0.14,
}
function toUsd(amount: number, currency: string) { return amount * (USD_RATES[currency] ?? 1.0) }
function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0, notation: Math.abs(amount) >= 1_000_000 ? 'compact' : 'standard' }).format(amount)
}
function formatUsd(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0, notation: Math.abs(amount) >= 1_000_000 ? 'compact' : 'standard' }).format(amount)
}
function formatDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function annualizedAmount(amount: number, frequency: SupplierContract['payment_frequency']): number {
  if (frequency === 'monthly')   return amount * 12
  if (frequency === 'quarterly') return amount * 4
  return amount
}

function StatusBadge({ status }: { status: SupplierContract['status'] }) {
  const map: Record<SupplierContract['status'], string> = { active: 'badge-teal', expired: 'badge-gray', pending: 'badge-amber' }
  return <span className={`badge ${map[status]}`} style={{ fontSize: '0.6875rem', textTransform: 'capitalize' }}>{status}</span>
}

// ── Contract Modal ────────────────────────────────────────────

function ContractModal({ initial, onSave, onClose }: {
  initial?: SupplierContract | null
  onSave: (d: Omit<SupplierContract, 'id' | 'uploaded_at'>) => void
  onClose: () => void
}) {
  const [supplier, setSupplier]       = useState(initial?.supplier_name ?? '')
  const [currency, setCurrency]       = useState(initial?.currency ?? '')
  const [value, setValue]             = useState(initial?.contract_value?.toString() ?? '')
  const [startDate, setStartDate]     = useState(initial?.start_date ?? '')
  const [endDate, setEndDate]         = useState(initial?.end_date ?? '')
  const [freq, setFreq]               = useState<SupplierContract['payment_frequency']>(initial?.payment_frequency ?? 'monthly')
  const [nextPay, setNextPay]         = useState(initial?.next_payment_date ?? '')
  const [payAmt, setPayAmt]           = useState(initial?.payment_amount?.toString() ?? '')
  const [category, setCategory]       = useState(initial?.category ?? '')
  const [status, setStatus]           = useState<SupplierContract['status']>(initial?.status ?? 'active')
  const [description, setDesc]        = useState(initial?.description ?? '')
  const [formError, setFormError]     = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setFormError('')
    const sup = supplier.trim(); if (!sup) { setFormError('Supplier name is required'); return }
    const cur = currency.trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(cur)) { setFormError('Currency must be a 3-letter ISO code'); return }
    const val = parseFloat(value.replace(/,/g, '')); if (isNaN(val) || val <= 0) { setFormError('Contract value must be a positive number'); return }
    if (!endDate) { setFormError('End date is required'); return }
    const amt = parseFloat(payAmt.replace(/,/g, '')) || 0
    onSave({ supplier_name: sup, currency: cur, contract_value: val, start_date: startDate, end_date: endDate, payment_frequency: freq, next_payment_date: nextPay, payment_amount: amt, category: category.trim(), status, description: description.trim() })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: 580, background: 'var(--bg-card)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{initial ? 'Edit Contract' : 'Add Contract'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Supplier Name *</label>
              <input className="input" placeholder="AWS Inc" value={supplier} onChange={e => setSupplier(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label className="label">Category</label>
              <input className="input" placeholder="Cloud Services" value={category} onChange={e => setCategory(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Currency *</label>
              <input className="input" placeholder="USD" value={currency} onChange={e => setCurrency(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }} maxLength={3} />
            </div>
            <div>
              <label className="label">Contract Value *</label>
              <input className="input" type="number" placeholder="240000" value={value} onChange={e => setValue(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} min={0} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Start Date</label>
              <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} />
            </div>
            <div>
              <label className="label">End Date *</label>
              <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Frequency</label>
              <select className="input" value={freq} onChange={e => setFreq(e.target.value as SupplierContract['payment_frequency'])} style={{ width: '100%', boxSizing: 'border-box', height: 36 }}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
                <option value="one-time">One-time</option>
              </select>
            </div>
            <div>
              <label className="label">Next Payment</label>
              <input className="input" type="date" value={nextPay} onChange={e => setNextPay(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} />
            </div>
            <div>
              <label className="label">Payment Amount</label>
              <input className="input" type="number" placeholder="20000" value={payAmt} onChange={e => setPayAmt(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} min={0} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Status</label>
              <select className="input" value={status} onChange={e => setStatus(e.target.value as SupplierContract['status'])} style={{ width: '100%', boxSizing: 'border-box', height: 36 }}>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="expired">Expired</option>
              </select>
            </div>
            <div>
              <label className="label">Description</label>
              <input className="input" placeholder="Optional notes" value={description} onChange={e => setDesc(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
          </div>
          {formError && <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--red)', fontSize: '0.8125rem' }}><AlertCircle size={14} /> {formError}</div>}
          <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm">{initial ? 'Save Changes' : 'Add Contract'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Contracts Tab ─────────────────────────────────────────────

function ContractsTab({ contracts, onAdd, onUpdate, onDelete, onSwitchToUpload }: {
  contracts: SupplierContract[]
  onAdd: (d: Omit<SupplierContract, 'id' | 'uploaded_at'>) => void
  onUpdate: (id: string, u: Partial<SupplierContract>) => void
  onDelete: (id: string) => void
  onSwitchToUpload: () => void
}) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const in90  = useMemo(() => new Date(today.getTime() + 90 * 86400000), [today])

  const [statusFilter, setStatusFilter]     = useState<'All' | SupplierContract['status']>('All')
  const [currencyFilter, setCurrFilter]     = useState('All')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [showModal, setShowModal]           = useState(false)
  const [editing, setEditing]               = useState<SupplierContract | null>(null)
  const [deletingId, setDeletingId]         = useState<string | null>(null)

  const currencies = useMemo(() => ['All', ...Array.from(new Set(contracts.map(c => c.currency))).sort()], [contracts])
  const categories = useMemo(() => ['All', ...Array.from(new Set(contracts.map(c => c.category).filter(Boolean))).sort()], [contracts])

  const filtered = useMemo(() => contracts.filter(c => {
    if (statusFilter !== 'All' && c.status !== statusFilter) return false
    if (currencyFilter !== 'All' && c.currency !== currencyFilter) return false
    if (categoryFilter !== 'All' && c.category !== categoryFilter) return false
    return true
  }), [contracts, statusFilter, currencyFilter, categoryFilter])

  function handleSave(data: Omit<SupplierContract, 'id' | 'uploaded_at'>) {
    if (editing) { onUpdate(editing.id, data) } else { onAdd(data) }
    setShowModal(false); setEditing(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="pill-tabs" style={{ flexShrink: 0 }}>
          {(['All', 'active', 'expired', 'pending'] as const).map(s => (
            <button key={s} className={`pill-tab${statusFilter === s ? ' active' : ''}`} onClick={() => setStatusFilter(s)} style={{ textTransform: s === 'All' ? undefined : 'capitalize' }}>{s}</button>
          ))}
        </div>
        <select className="input" value={currencyFilter} onChange={e => setCurrFilter(e.target.value)} style={{ height: 32, padding: '0 0.625rem', fontSize: '0.8125rem', minWidth: 120 }}>
          {currencies.map(c => <option key={c} value={c}>{c === 'All' ? 'All Currencies' : c}</option>)}
        </select>
        <select className="input" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ height: 32, padding: '0 0.625rem', fontSize: '0.8125rem', minWidth: 140 }}>
          {categories.map(c => <option key={c} value={c}>{c === 'All' ? 'All Categories' : c}</option>)}
        </select>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 'auto' }}>{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
        <button className="btn btn-ghost btn-sm" onClick={onSwitchToUpload} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Upload size={13} /> Import CSV</button>
        <button className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setShowModal(true) }} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Plus size={13} /> Add Contract</button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <Truck size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>No supplier contracts found</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>Import a CSV file or add contracts manually.</div>
          <button className="btn btn-primary btn-sm" onClick={onSwitchToUpload} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Upload size={13} /> Upload CSV</button>
        </div>
      ) : (
        <div className="data-table">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Supplier', 'Currency', 'Contract Value', 'Payment Amount', 'Frequency', 'Next Payment', 'End Date', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ textAlign: h === 'Contract Value' || h === 'Payment Amount' ? 'right' : h === 'Actions' ? 'center' : 'left', padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const isDeleting = deletingId === c.id
                const expDate = new Date(c.end_date + 'T00:00:00')
                const expired    = expDate < today
                const expiringSoon = !expired && expDate >= today && expDate <= in90
                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                    <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-primary)', fontWeight: 500 }}>{c.supplier_name}</td>
                    <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                      <span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700 }}>{c.currency}</span>
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{formatAmount(c.contract_value, c.currency)}</td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {c.payment_amount > 0 ? formatAmount(c.payment_amount, c.currency) : '—'}
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-secondary)', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{c.payment_frequency}</td>
                    <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                      {c.next_payment_date ? formatDate(c.next_payment_date) : '—'}
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        <span style={{ fontSize: '0.8125rem', color: expired ? 'var(--red)' : 'var(--text-secondary)', fontWeight: expired ? 600 : 400 }}>{formatDate(c.end_date)}</span>
                        {expired      && <span className="badge badge-red"   style={{ fontSize: '0.6rem' }}>Expired</span>}
                        {expiringSoon && <span className="badge badge-amber" style={{ fontSize: '0.6rem' }}>Expiring</span>}
                      </div>
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}><StatusBadge status={c.status} /></td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {isDeleting ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', justifyContent: 'center' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Confirm?</span>
                          <button className="btn btn-sm" style={{ background: 'var(--red)', color: '#fff', border: 'none', padding: '0.2rem 0.5rem' }} onClick={() => { onDelete(c.id); setDeletingId(null) }}><Check size={11} /></button>
                          <button className="btn btn-ghost btn-sm" style={{ padding: '0.2rem 0.5rem' }} onClick={() => setDeletingId(null)}><X size={11} /></button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', justifyContent: 'center' }}>
                          <button className="btn btn-ghost btn-sm" style={{ padding: '0.25rem' }} title="Edit" onClick={() => { setEditing(c); setShowModal(true) }}><Pencil size={13} /></button>
                          <button className="btn btn-ghost btn-sm" style={{ padding: '0.25rem', color: 'var(--red)' }} title="Delete" onClick={() => setDeletingId(c.id)}><Trash2 size={13} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <ContractModal initial={editing} onSave={handleSave} onClose={() => { setShowModal(false); setEditing(null) }} />}
    </div>
  )
}

// ── Analysis Tab ──────────────────────────────────────────────

function AnalysisTab({ contracts }: { contracts: SupplierContract[] }) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const in90  = useMemo(() => new Date(today.getTime() + 90 * 86400000), [today])
  const in180 = useMemo(() => new Date(today.getTime() + 180 * 86400000), [today])

  const active = useMemo(() => contracts.filter(c => c.status === 'active'), [contracts])

  const totalValueUsd = useMemo(() => active.reduce((s, c) => s + toUsd(c.contract_value, c.currency), 0), [active])
  const annualPayablesUsd = useMemo(() =>
    active.reduce((s, c) => s + toUsd(annualizedAmount(c.payment_amount, c.payment_frequency), c.currency), 0),
    [active]
  )
  const activeCount   = useMemo(() => active.length, [active])
  const expiring90    = useMemo(() => contracts.filter(c => {
    const d = new Date(c.end_date + 'T00:00:00')
    return d >= today && d <= in90
  }).length, [contracts, today, in90])

  // By category
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; valueUsd: number; annualUsd: number }>()
    for (const c of contracts) {
      const key = c.category || '(Uncategorized)'
      const cur = map.get(key) ?? { count: 0, valueUsd: 0, annualUsd: 0 }
      cur.count++
      cur.valueUsd  += toUsd(c.contract_value, c.currency)
      cur.annualUsd += toUsd(annualizedAmount(c.payment_amount, c.payment_frequency), c.currency)
      map.set(key, cur)
    }
    return Array.from(map.entries()).map(([cat, v]) => ({ cat, ...v })).sort((a, b) => b.valueUsd - a.valueUsd)
  }, [contracts])

  // By currency
  const currencyBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; valueUsd: number; annualUsd: number }>()
    for (const c of contracts) {
      const cur = map.get(c.currency) ?? { count: 0, valueUsd: 0, annualUsd: 0 }
      cur.count++
      cur.valueUsd  += toUsd(c.contract_value, c.currency)
      cur.annualUsd += toUsd(annualizedAmount(c.payment_amount, c.payment_frequency), c.currency)
      map.set(c.currency, cur)
    }
    return Array.from(map.entries()).map(([ccy, v]) => ({ ccy, ...v, pct: totalValueUsd > 0 ? v.valueUsd / totalValueUsd * 100 : 0 })).sort((a, b) => b.valueUsd - a.valueUsd)
  }, [contracts, totalValueUsd])

  // Renewal pipeline
  const renewalPipeline = useMemo(() =>
    contracts
      .filter(c => {
        const d = new Date(c.end_date + 'T00:00:00')
        return d >= today && d <= in180
      })
      .sort((a, b) => a.end_date.localeCompare(b.end_date)),
    [contracts, today, in180]
  )

  if (contracts.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: '2rem' }}>
        <Truck size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>No contract data</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Add or import supplier contracts to see analysis.</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        {[
          { label: 'Total Contract Value', value: formatUsd(totalValueUsd), sub: 'active contracts, USD equiv', color: 'var(--teal)' },
          { label: 'Annual Payables', value: formatUsd(annualPayablesUsd), sub: 'annualized payments, USD equiv', color: 'var(--teal)' },
          { label: 'Active Contracts', value: activeCount.toString(), sub: 'status = active', color: 'var(--teal)' },
          { label: 'Expiring in 90d', value: expiring90.toString(), sub: 'renewal attention needed', color: expiring90 > 0 ? '#f59e0b' : 'var(--text-muted)' },
        ].map(tile => (
          <div key={tile.label} className="card" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.375rem', fontWeight: 500 }}>{tile.label}</div>
            <div style={{ fontSize: '1.375rem', fontWeight: 700, color: tile.color, fontFamily: 'var(--font-mono)', lineHeight: 1.2 }}>{tile.value}</div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{tile.sub}</div>
          </div>
        ))}
      </div>

      {/* By Category */}
      {categoryBreakdown.length > 0 && (
        <div className="card">
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>By Category</div>
          <div className="data-table">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                {['Category', 'Count', 'Total Value (USD)', 'Annual Payables (USD)'].map((h, i) => (
                  <th key={i} style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', textAlign: i > 0 ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {categoryBreakdown.map(row => (
                  <tr key={row.cat} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                    <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-primary)', fontWeight: 500 }}>{row.cat}</td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{row.count}</td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: 600 }}>{formatUsd(row.valueUsd)}</td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{formatUsd(row.annualUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* By Currency */}
      {currencyBreakdown.length > 0 && (
        <div className="card">
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>By Currency</div>
          <div className="data-table">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                {['Currency', 'Count', 'Contract Value', 'Annual Payables', '% of Total', ''].map((h, i) => (
                  <th key={i} style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', textAlign: i >= 2 && i <= 4 ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {currencyBreakdown.map(row => (
                  <tr key={row.ccy} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                    <td style={{ padding: '0.625rem 0.75rem' }}><span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700 }}>{row.ccy}</span></td>
                    <td style={{ padding: '0.625rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{row.count}</td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: 600 }}>{formatUsd(row.valueUsd)}</td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{formatUsd(row.annualUsd)}</td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{row.pct.toFixed(1)}%</td>
                    <td style={{ padding: '0.625rem 0.75rem', minWidth: 80 }}>
                      <div style={{ height: 5, background: 'var(--border)', borderRadius: 999 }}>
                        <div style={{ height: '100%', width: `${Math.min(row.pct, 100)}%`, background: 'var(--teal)', borderRadius: 999 }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Renewal Pipeline */}
      <div className="card">
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Renewal Pipeline (Next 180 Days)
          <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>{renewalPipeline.length} contract{renewalPipeline.length !== 1 ? 's' : ''}</span>
        </div>
        {renewalPipeline.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No contracts expiring in the next 180 days.</div>
        ) : (
          <div className="data-table">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                {['Supplier', 'Currency', 'Contract Value', 'Annual Payables', 'End Date', 'Category', 'Status'].map((h, i) => (
                  <th key={i} style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', textAlign: i >= 2 && i <= 3 ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {renewalPipeline.map(c => {
                  const annual = annualizedAmount(c.payment_amount, c.payment_frequency)
                  return (
                    <tr key={c.id} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                      <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-primary)', fontWeight: 500 }}>{c.supplier_name}</td>
                      <td style={{ padding: '0.625rem 0.75rem' }}><span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700 }}>{c.currency}</span></td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)' }}>{formatAmount(c.contract_value, c.currency)}</td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{annual > 0 ? formatAmount(annual, c.currency) : '—'}</td>
                      <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatDate(c.end_date)}</td>
                      <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{c.category || '—'}</td>
                      <td style={{ padding: '0.625rem 0.75rem' }}><StatusBadge status={c.status} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Upload Tab ────────────────────────────────────────────────

function UploadTab({ onImported, addContracts }: { onImported: () => void; addContracts: (rows: Omit<SupplierContract, 'id' | 'uploaded_at'>[]) => Promise<void> }) {
  const { user, db } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging]           = useState(false)
  const [parsing, setParsing]             = useState(false)
  const [parseResult, setParseResult]     = useState<{ data: Omit<SupplierContract, 'id' | 'uploaded_at'>[]; errors: string[]; fileName: string } | null>(null)
  const [importing, setImporting]         = useState(false)
  const [importSuccess, setImportSuccess] = useState(false)
  const [selectedFile, setSelectedFile]   = useState<File | null>(null)
  const [importError, setImportError]     = useState<string | null>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) { setParseResult({ data: [], errors: ['Only CSV files are supported.'], fileName: file.name }); return }
    setParsing(true); setParseResult(null); setImportSuccess(false); setImportError(null); setSelectedFile(file)
    const result = await parseSupplierContractCsv(file)
    setParseResult({ ...result, fileName: file.name }); setParsing(false)
  }, [])

  function handleDrop(e: React.DragEvent) { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }
  async function handleImport() {
    if (!parseResult || parseResult.data.length === 0) return
    setImportError(null)
    const orgId = user?.profile?.org_id
    if (orgId && selectedFile) {
      const dupeCheck = await checkFileAlreadyUploaded(db, orgId, selectedFile, 'supplier_contracts')
      if (dupeCheck.isDuplicate) {
        setImportError(`This file was already uploaded on ${formatUploadDate(dupeCheck.uploadedAt!)}. To re-upload, first clear the existing data.`)
        return
      }
    }
    setImporting(true)
    try {
      await addContracts(parseResult.data)
      if (orgId && selectedFile) {
        await recordUploadBatch(db, orgId, user?.id, selectedFile, 'supplier_contracts', parseResult.data.length)
      }
      setImporting(false); setImportSuccess(true)
      setTimeout(() => onImported(), 800)
    } catch (err: any) {
      setImporting(false)
      const msg: string = err?.message ?? ''
      if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique')) {
        setImportError(`Some records were skipped — they already exist in the database. ${parseResult.data.length} records were submitted.`)
        setImportSuccess(true); setTimeout(() => onImported(), 800)
      } else {
        setImportError(`Import failed: ${msg}`)
      }
    }
  }
  function handleClear() { setParseResult(null); setImportSuccess(false); setSelectedFile(null); setImportError(null) }

  return (
    <div style={{ maxWidth: 720 }}>
      <div onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={handleDrop} onClick={() => fileRef.current?.click()}
        style={{ border: `2px dashed ${dragging ? 'var(--teal)' : 'var(--border)'}`, borderRadius: 'var(--r-lg)', padding: '2.5rem 1.5rem', textAlign: 'center', cursor: 'pointer', background: dragging ? 'rgba(0,200,160,0.04)' : 'var(--bg-app)', transition: 'all 0.15s', marginBottom: '1.5rem' }}>
        <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleInputChange} />
        {parsing ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}><div className="spinner" style={{ width: 28, height: 28 }} /><span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Parsing CSV…</span></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.625rem' }}>
            <Upload size={28} style={{ color: 'var(--teal)', opacity: 0.7 }} />
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9375rem' }}>Drop CSV file here</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>or click to browse</div>
          </div>
        )}
      </div>

      {parseResult && !importSuccess && (
        <div className="card fade-in" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
            <div>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>{parseResult.fileName}</span>
              <span style={{ marginLeft: '0.75rem', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                {parseResult.data.length} row{parseResult.data.length !== 1 ? 's' : ''} parsed{parseResult.errors.length > 0 && `, ${parseResult.errors.length} error${parseResult.errors.length !== 1 ? 's' : ''}`}
              </span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={handleClear} style={{ padding: '0.25rem' }}><X size={14} /></button>
          </div>
          {parseResult.errors.length > 0 && (
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--r-md)', padding: '0.75rem', marginBottom: '0.875rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: 'var(--red)', fontWeight: 600, fontSize: '0.8125rem' }}><AlertCircle size={14} />{parseResult.errors.length} error{parseResult.errors.length !== 1 ? 's' : ''}</div>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {parseResult.errors.slice(0, 10).map((e, i) => <li key={i} style={{ fontSize: '0.75rem', color: 'var(--red)' }}>{e}</li>)}
                {parseResult.errors.length > 10 && <li style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>…and {parseResult.errors.length - 10} more</li>}
              </ul>
            </div>
          )}
          {parseResult.data.length > 0 && (
            <>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 500 }}>Preview (first {Math.min(parseResult.data.length, 10)} of {parseResult.data.length} rows)</div>
              <div className="data-table" style={{ marginBottom: '1rem', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                  <thead><tr>{['Supplier', 'Currency', 'Value', 'End Date', 'Frequency', 'Status'].map(h => (
                    <th key={h} style={{ padding: '0.5rem 0.625rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}</tr></thead>
                  <tbody>
                    {parseResult.data.slice(0, 10).map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                        <td style={{ padding: '0.5rem 0.625rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{row.supplier_name}</td>
                        <td style={{ padding: '0.5rem 0.625rem' }}><span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', fontWeight: 700 }}>{row.currency}</span></td>
                        <td style={{ padding: '0.5rem 0.625rem', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{formatAmount(row.contract_value, row.currency)}</td>
                        <td style={{ padding: '0.5rem 0.625rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.end_date}</td>
                        <td style={{ padding: '0.5rem 0.625rem', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{row.payment_frequency}</td>
                        <td style={{ padding: '0.5rem 0.625rem' }}><StatusBadge status={row.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importError && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--r-lg)', marginBottom: '0.75rem' }}>
                  <AlertCircle size={15} style={{ color: '#ef4444', flexShrink: 0, marginTop: '0.125rem' }} />
                  <span style={{ fontSize: '0.8125rem', color: '#ef4444' }}>{importError}</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={handleClear}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={handleImport} disabled={importing} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  {importing ? <div className="spinner" style={{ width: 13, height: 13 }} /> : <Check size={13} />}
                  Import {parseResult.data.length} Contract{parseResult.data.length !== 1 ? 's' : ''}
                </button>
              </div>
            </>
          )}
          {parseResult.data.length === 0 && parseResult.errors.length > 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center', padding: '1rem 0' }}>No valid rows to import. Please fix the errors and try again.</div>
          )}
        </div>
      )}

      {importSuccess && (
        <div className="card fade-in" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem' }}>
          <CheckCircle size={20} style={{ color: 'var(--teal)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>Import successful</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Redirecting to contracts…</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>CSV Format Guide</div>
          <button className="btn btn-ghost btn-sm" onClick={downloadSupplierContractTemplate} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Download size={13} /> Download Template</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[
            { col: 'supplier_name',     req: true,  ex: 'AWS Inc',          desc: 'Supplier / vendor name' },
            { col: 'currency',          req: true,  ex: 'USD',              desc: '3-letter ISO currency code' },
            { col: 'contract_value',    req: true,  ex: '240000',           desc: 'Total contract value' },
            { col: 'end_date',          req: true,  ex: '2025-12-31',       desc: 'Contract expiry date (YYYY-MM-DD)' },
            { col: 'start_date',        req: false, ex: '2025-01-01',       desc: 'Contract start date (YYYY-MM-DD)' },
            { col: 'payment_frequency', req: false, ex: 'monthly',          desc: 'monthly / quarterly / annual / one-time' },
            { col: 'next_payment_date', req: false, ex: '2025-08-01',       desc: 'Next payment due date' },
            { col: 'payment_amount',    req: false, ex: '20000',            desc: 'Periodic payment amount' },
            { col: 'category',          req: false, ex: 'Cloud Services',   desc: 'Contract category or type' },
            { col: 'status',            req: false, ex: 'active',           desc: 'active / expired / pending' },
            { col: 'description',       req: false, ex: 'Annual cloud contract', desc: 'Optional notes' },
          ].map(({ col, req, ex, desc }) => (
            <div key={col} style={{ display: 'grid', gridTemplateColumns: '160px 60px 180px 1fr', gap: '0.5rem', alignItems: 'center', fontSize: '0.8125rem' }}>
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
          Column headers are case-insensitive. Accepted aliases: <em>vendor/vendor_name</em> for supplier_name, <em>value/total_value</em> for contract_value, <em>expiry_date/expiration</em> for end_date.
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────

type Tab = 'contracts' | 'analysis' | 'upload'

export function SupplierContractsPage() {
  const { contracts, addContract, addContracts, updateContract, deleteContract, loading } = useSupplierContracts()
  const [activeTab, setActiveTab] = useState<Tab>('contracts')

  const TABS: { key: Tab; label: string }[] = [
    { key: 'contracts', label: 'Contracts' },
    { key: 'analysis',  label: 'Analysis' },
    { key: 'upload',    label: 'Upload' },
  ]

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>
  }

  return (
    <div className="fade-in" style={{ padding: '1.5rem', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
            <Truck size={20} style={{ color: 'var(--teal)' }} />
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Supplier Contracts</h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>Manage vendor agreements, payment obligations and renewal pipeline.</p>
        </div>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{contracts.length} contract{contracts.length !== 1 ? 's' : ''}</span>
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
              {tab.key === 'contracts' && contracts.length > 0 && (
                <span style={{ marginLeft: '0.5rem', fontSize: '0.6875rem', background: 'var(--bg-app)', color: 'var(--text-muted)', padding: '0.1rem 0.4rem', borderRadius: 999, fontWeight: 400 }}>{contracts.length}</span>
              )}
            </button>
          ))}
        </div>
        <div style={{ padding: '1.25rem' }}>
          {activeTab === 'contracts' && <ContractsTab contracts={contracts} onAdd={addContract} onUpdate={updateContract} onDelete={deleteContract} onSwitchToUpload={() => setActiveTab('upload')} />}
          {activeTab === 'analysis'  && <AnalysisTab contracts={contracts} />}
          {activeTab === 'upload'    && <UploadTab addContracts={addContracts} onImported={() => setActiveTab('contracts')} />}
        </div>
      </div>
    </div>
  )
}
