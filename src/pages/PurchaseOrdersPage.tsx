import { useState, useMemo } from 'react'
import {
  Upload, Plus, Pencil, Trash2, X, Check,
  AlertCircle, ShoppingCart,
} from 'lucide-react'
import { usePurchaseOrders } from '@/hooks/usePurchaseOrders'
import type { PurchaseOrder } from '@/hooks/usePurchaseOrders'
import { useHedgeCoverage } from '@/hooks/useData'
import { parsePurchaseOrderCsv, downloadPurchaseOrderTemplate } from '@/lib/purchaseOrderParser'
import { UploadWizard } from '@/components/upload/UploadWizard'

// ── Constants ─────────────────────────────────────────────────

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
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function isOverdue(dueDate: string, status: string): boolean {
  if (status === 'paid') return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(dueDate + 'T00:00:00') < today
}

const ACTIVE_STATUSES: PurchaseOrder['status'][] = ['open', 'approved', 'pending']

// ── Status badge ──────────────────────────────────────────────

function StatusBadge({ status }: { status: PurchaseOrder['status'] }) {
  const styleMap: Record<PurchaseOrder['status'], string> = {
    open:     'badge-blue',
    approved: 'badge-teal',
    pending:  'badge-amber',
    paid:     'badge-gray',
  }
  return (
    <span className={`badge ${styleMap[status]}`} style={{ fontSize: '0.6875rem', textTransform: 'capitalize' }}>
      {status}
    </span>
  )
}

// ── Order Modal ───────────────────────────────────────────────

interface OrderModalProps {
  initial?: PurchaseOrder | null
  onSave: (data: Omit<PurchaseOrder, 'id' | 'uploaded_at'>) => void
  onClose: () => void
}

function OrderModal({ initial, onSave, onClose }: OrderModalProps) {
  const [poNumber, setPoNumber]     = useState(initial?.po_number ?? '')
  const [supplier, setSupplier]     = useState(initial?.supplier ?? '')
  const [currency, setCurrency]     = useState(initial?.currency ?? '')
  const [amount, setAmount]         = useState(initial?.amount?.toString() ?? '')
  const [dueDate, setDueDate]       = useState(initial?.due_date ?? '')
  const [issueDate, setIssueDate]   = useState(initial?.issue_date ?? '')
  const [category, setCategory]     = useState(initial?.category ?? '')
  const [status, setStatus]         = useState<PurchaseOrder['status']>(initial?.status ?? 'open')
  const [description, setDesc]      = useState(initial?.description ?? '')
  const [formError, setFormError]   = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')

    const poNum = poNumber.trim()
    if (!poNum) { setFormError('PO Number is required'); return }

    const sup = supplier.trim()
    if (!sup) { setFormError('Supplier is required'); return }

    const currencyClean = currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(currencyClean)) {
      setFormError('Currency must be a 3-letter ISO code (e.g. EUR, GBP, USD)')
      return
    }

    const amountNum = parseFloat(amount.replace(/,/g, ''))
    if (isNaN(amountNum) || amountNum <= 0) {
      setFormError('Amount must be a positive number')
      return
    }

    if (!dueDate) { setFormError('Due Date is required'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      setFormError('Due Date must be in YYYY-MM-DD format')
      return
    }

    if (issueDate && !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
      setFormError('Issue Date must be in YYYY-MM-DD format')
      return
    }

    onSave({
      po_number: poNum,
      supplier: sup,
      currency: currencyClean,
      amount: amountNum,
      due_date: dueDate,
      issue_date: issueDate.trim(),
      category: category.trim(),
      status,
      description: description.trim(),
    })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: '1rem',
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 560, background: 'var(--bg-card)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            {initial ? 'Edit Purchase Order' : 'Add Purchase Order'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">PO Number *</label>
              <input
                className="input"
                placeholder="PO-2025-001"
                value={poNumber}
                onChange={e => setPoNumber(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div>
              <label className="label">Supplier *</label>
              <input
                className="input"
                placeholder="Acme Corp"
                value={supplier}
                onChange={e => setSupplier(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
          </div>

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
                placeholder="125000"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }}
                min={0}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Due Date *</label>
              <input
                className="input"
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div>
              <label className="label">Issue Date</label>
              <input
                className="input"
                type="date"
                value={issueDate}
                onChange={e => setIssueDate(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Category</label>
              <input
                className="input"
                placeholder="Raw Materials"
                value={category}
                onChange={e => setCategory(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label className="label">Status</label>
              <select
                className="input"
                value={status}
                onChange={e => setStatus(e.target.value as PurchaseOrder['status'])}
                style={{ width: '100%', boxSizing: 'border-box', height: 36 }}
              >
                <option value="open">Open</option>
                <option value="approved">Approved</option>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
              </select>
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
              {initial ? 'Save Changes' : 'Add Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Orders Tab ────────────────────────────────────────────────

type StatusFilter = 'All' | PurchaseOrder['status']
type DateFilter = 'all' | 'this-month' | 'next-30' | 'overdue'

interface OrdersTabProps {
  orders: PurchaseOrder[]
  onAdd: (data: Omit<PurchaseOrder, 'id' | 'uploaded_at'>) => void
  onUpdate: (id: string, updates: Partial<PurchaseOrder>) => void
  onDelete: (id: string) => void
  onSwitchToUpload: () => void
}

function OrdersTab({ orders, onAdd, onUpdate, onDelete, onSwitchToUpload }: OrdersTabProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')
  const [currencyFilter, setCurrencyFilter] = useState('All')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [showModal, setShowModal] = useState(false)
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  }, [])

  const currencies = useMemo(() => {
    const distinct = Array.from(new Set(orders.map(o => o.currency))).sort()
    return ['All', ...distinct]
  }, [orders])

  const filtered = useMemo(() => {
    const in30 = new Date(today.getTime() + 30 * 86400000)
    return orders.filter(o => {
      if (statusFilter !== 'All' && o.status !== statusFilter) return false
      if (currencyFilter !== 'All' && o.currency !== currencyFilter) return false
      if (dateFilter !== 'all') {
        const due = new Date(o.due_date + 'T00:00:00')
        if (dateFilter === 'overdue' && !(due < today && o.status !== 'paid')) return false
        if (dateFilter === 'this-month' && !(due >= today && due <= in30)) return false
        if (dateFilter === 'next-30' && !(due >= today && due <= in30)) return false
      }
      return true
    })
  }, [orders, statusFilter, currencyFilter, dateFilter, today])

  // Footer totals by currency (active statuses only)
  const footerTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of filtered.filter(o => ACTIVE_STATUSES.includes(o.status))) {
      map.set(o.currency, (map.get(o.currency) ?? 0) + o.amount)
    }
    return Array.from(map.entries()).sort((a, b) => toUsd(b[1], b[0]) - toUsd(a[1], a[0]))
  }, [filtered])

  function handleSave(data: Omit<PurchaseOrder, 'id' | 'uploaded_at'>) {
    if (editingOrder) {
      onUpdate(editingOrder.id, data)
    } else {
      onAdd(data)
    }
    setShowModal(false)
    setEditingOrder(null)
  }

  function handleEdit(o: PurchaseOrder) {
    setEditingOrder(o)
    setShowModal(true)
  }

  function handleAddNew() {
    setEditingOrder(null)
    setShowModal(true)
  }

  const DATE_FILTER_LABELS: Record<DateFilter, string> = {
    'all': 'All Dates',
    'this-month': 'Due This Month',
    'next-30': 'Due Next 30 Days',
    'overdue': 'Overdue',
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="pill-tabs" style={{ flexShrink: 0 }}>
          {(['All', 'open', 'approved', 'pending', 'paid'] as StatusFilter[]).map(s => (
            <button
              key={s}
              className={`pill-tab${statusFilter === s ? ' active' : ''}`}
              onClick={() => setStatusFilter(s)}
              style={{ textTransform: s === 'All' ? undefined : 'capitalize' }}
            >
              {s}
            </button>
          ))}
        </div>

        <select
          className="input"
          value={currencyFilter}
          onChange={e => setCurrencyFilter(e.target.value)}
          style={{ height: 32, padding: '0 0.625rem', fontSize: '0.8125rem', minWidth: 120 }}
        >
          {currencies.map(c => <option key={c} value={c}>{c === 'All' ? 'All Currencies' : c}</option>)}
        </select>

        <select
          className="input"
          value={dateFilter}
          onChange={e => setDateFilter(e.target.value as DateFilter)}
          style={{ height: 32, padding: '0 0.625rem', fontSize: '0.8125rem', minWidth: 160 }}
        >
          {(Object.keys(DATE_FILTER_LABELS) as DateFilter[]).map(k => (
            <option key={k} value={k}>{DATE_FILTER_LABELS[k]}</option>
          ))}
        </select>

        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
          {filtered.length} record{filtered.length !== 1 ? 's' : ''}
        </span>

        <button className="btn btn-ghost btn-sm" onClick={onSwitchToUpload} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Upload size={13} /> Import CSV
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleAddNew} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Plus size={13} /> Add Order
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <ShoppingCart size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>
            No purchase orders found
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Import a CSV file or add purchase orders manually to get started.
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
                  {['PO Number', 'Supplier', 'Currency', 'Amount', 'Due Date', 'Category', 'Status', 'Actions'].map(h => (
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
                {filtered.map(o => {
                  const isDeleting = deletingId === o.id
                  const overdue = isOverdue(o.due_date, o.status)
                  return (
                    <tr key={o.id} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                      <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                        {o.po_number}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                        {o.supplier}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                        <span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700 }}>
                          {o.currency}
                        </span>
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                        {formatAmount(o.amount, o.currency)}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap', fontSize: '0.8125rem', color: overdue ? 'var(--red)' : 'var(--text-secondary)', fontWeight: overdue ? 600 : 400 }}>
                        {formatDate(o.due_date)}
                        {overdue && <span style={{ marginLeft: '0.375rem', fontSize: '0.6875rem' }}>⚠</span>}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                        {o.category || '—'}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                        <StatusBadge status={o.status} />
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {isDeleting ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', justifyContent: 'center' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Confirm?</span>
                            <button
                              className="btn btn-sm"
                              style={{ background: 'var(--red)', color: '#fff', border: 'none', padding: '0.2rem 0.5rem' }}
                              onClick={() => { onDelete(o.id); setDeletingId(null) }}
                            >
                              <Check size={11} />
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '0.2rem 0.5rem' }}
                              onClick={() => setDeletingId(null)}
                            >
                              <X size={11} />
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', justifyContent: 'center' }}>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '0.25rem' }}
                              title="Edit"
                              onClick={() => handleEdit(o)}
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '0.25rem', color: 'var(--red)' }}
                              title="Delete"
                              onClick={() => setDeletingId(o.id)}
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

          {/* Footer totals */}
          {footerTotals.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginTop: '0.875rem', padding: '0.75rem 1rem', background: 'var(--bg-app)', borderRadius: 'var(--r-md)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Open payables:</span>
              {footerTotals.map(([ccy, amt]) => (
                <span key={ccy} style={{ fontSize: '0.875rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.75rem', marginRight: '0.25rem' }}>{ccy}</span>
                  {formatAmount(amt, ccy)}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {showModal && (
        <OrderModal
          initial={editingOrder}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingOrder(null) }}
        />
      )}
    </div>
  )
}

// ── Analysis Tab ──────────────────────────────────────────────

interface AnalysisTabProps {
  orders: PurchaseOrder[]
}

function AnalysisTab({ orders }: AnalysisTabProps) {
  const { coverage } = useHedgeCoverage()

  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  }, [])

  const activeOrders = useMemo(() =>
    orders.filter(o => ACTIVE_STATUSES.includes(o.status)),
    [orders]
  )

  // ── Summary tiles ──────────────────────────────────────────
  const totalOpenCount = activeOrders.length

  const totalPayablesUsd = useMemo(() =>
    activeOrders.reduce((s, o) => s + toUsd(o.amount, o.currency), 0),
    [activeOrders]
  )

  const overdueUsd = useMemo(() =>
    activeOrders
      .filter(o => isOverdue(o.due_date, o.status))
      .reduce((s, o) => s + toUsd(o.amount, o.currency), 0),
    [activeOrders]
  )

  const currencyCount = useMemo(() =>
    new Set(activeOrders.map(o => o.currency)).size,
    [activeOrders]
  )

  // ── Upcoming payments buckets ──────────────────────────────
  const in7  = useMemo(() => new Date(today.getTime() + 7  * 86400000), [today])
  const in30 = useMemo(() => new Date(today.getTime() + 30 * 86400000), [today])

  const buckets = useMemo(() => {
    const overdue: PurchaseOrder[]   = []
    const thisWeek: PurchaseOrder[]  = []
    const thisMonth: PurchaseOrder[] = []
    const later: PurchaseOrder[]     = []

    for (const o of activeOrders) {
      const due = new Date(o.due_date + 'T00:00:00')
      if (due < today)        overdue.push(o)
      else if (due <= in7)    thisWeek.push(o)
      else if (due <= in30)   thisMonth.push(o)
      else                    later.push(o)
    }

    return [
      { label: 'Overdue', orders: overdue, color: 'var(--red)' },
      { label: 'Due This Week', orders: thisWeek, color: '#f59e0b' },
      { label: 'Due This Month', orders: thisMonth, color: 'var(--teal)' },
      { label: 'Due Later', orders: later, color: 'var(--text-muted)' },
    ]
  }, [activeOrders, today, in7, in30])

  // ── Payables by currency ───────────────────────────────────
  const currencyBreakdown = useMemo(() => {
    const map = new Map<string, { amount: number; usd: number }>()
    for (const o of activeOrders) {
      const cur = map.get(o.currency) ?? { amount: 0, usd: 0 }
      cur.amount += o.amount
      cur.usd += toUsd(o.amount, o.currency)
      map.set(o.currency, cur)
    }
    return Array.from(map.entries())
      .map(([ccy, v]) => ({ ccy, ...v }))
      .sort((a, b) => b.usd - a.usd)
  }, [activeOrders])

  const maxCurrencyUsd = currencyBreakdown[0]?.usd ?? 1

  // ── Top suppliers ──────────────────────────────────────────
  const supplierBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; usd: number; currencies: Set<string>; dueDates: string[] }>()
    for (const o of activeOrders) {
      const s = map.get(o.supplier) ?? { count: 0, usd: 0, currencies: new Set(), dueDates: [] }
      s.count++
      s.usd += toUsd(o.amount, o.currency)
      s.currencies.add(o.currency)
      s.dueDates.push(o.due_date)
      map.set(o.supplier, s)
    }
    return Array.from(map.entries())
      .map(([supplier, v]) => ({
        supplier,
        count: v.count,
        usd: v.usd,
        currencies: Array.from(v.currencies).sort().join(', '),
        avgDueDate: v.dueDates.length > 0
          ? new Date(v.dueDates.reduce((s, d) => s + new Date(d + 'T00:00:00').getTime(), 0) / v.dueDates.length)
              .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '—',
      }))
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 10)
  }, [activeOrders])

  // Coverage helper
  function getCoverageForCurrency(ccy: string) {
    const c = coverage.find(c => c.base_currency === ccy)
    if (!c) return null
    return c
  }

  function coverageBadgeClass(pct: number): string {
    if (pct >= 80) return 'badge-teal'
    if (pct >= 40) return 'badge-amber'
    return 'badge-red'
  }

  function coverageLabel(pct: number): string {
    if (pct >= 80) return 'Covered'
    if (pct >= 40) return 'Partial'
    return 'Exposed'
  }

  if (activeOrders.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: '2rem' }}>
        <ShoppingCart size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>No active purchase orders</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Add or import purchase orders to see payables analysis.</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        {[
          {
            label: 'Total Open POs',
            value: totalOpenCount.toString(),
            sub: 'open + approved + pending',
            color: 'var(--teal)',
          },
          {
            label: 'Total Payables',
            value: formatUsd(totalPayablesUsd),
            sub: 'USD equivalent',
            color: 'var(--teal)',
          },
          {
            label: 'Overdue Amount',
            value: formatUsd(overdueUsd),
            sub: 'past due, unpaid',
            color: overdueUsd > 0 ? 'var(--red)' : 'var(--text-muted)',
          },
          {
            label: 'Currencies',
            value: currencyCount.toString(),
            sub: 'across open orders',
            color: 'var(--teal)',
          },
        ].map(tile => (
          <div key={tile.label} className="card" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.375rem', fontWeight: 500 }}>{tile.label}</div>
            <div style={{ fontSize: '1.375rem', fontWeight: 700, color: tile.color, fontFamily: 'var(--font-mono)', lineHeight: 1.2 }}>{tile.value}</div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{tile.sub}</div>
          </div>
        ))}
      </div>

      {/* Upcoming payments */}
      <div className="card">
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Upcoming Payments
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          {buckets.map(bucket => (
            <div key={bucket.label} style={{ background: 'var(--bg-app)', borderRadius: 'var(--r-md)', padding: '0.875rem', border: `1px solid var(--border)` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: bucket.color }}>{bucket.label}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {bucket.orders.length} PO{bucket.orders.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: bucket.orders.length > 0 ? bucket.color : 'var(--text-muted)', marginBottom: '0.5rem' }}>
                {formatUsd(bucket.orders.reduce((s, o) => s + toUsd(o.amount, o.currency), 0))}
              </div>
              {bucket.orders.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {bucket.orders.slice(0, 3).map(o => (
                    <div key={o.id} style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{o.supplier}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                        {formatAmount(o.amount, o.currency)}
                      </span>
                    </div>
                  ))}
                  {bucket.orders.length > 3 && (
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>+{bucket.orders.length - 3} more</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Payables by currency */}
      {currencyBreakdown.length > 0 && (
        <div className="card">
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
            Payables by Currency
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            {currencyBreakdown.map(({ ccy, amount, usd }) => {
              const cov = getCoverageForCurrency(ccy)
              const barWidth = maxCurrencyUsd > 0 ? (usd / maxCurrencyUsd) * 100 : 0
              return (
                <div key={ccy}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.375rem', flexWrap: 'wrap' }}>
                    <span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700, minWidth: 44, textAlign: 'center' }}>
                      {ccy}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {formatAmount(amount, ccy)}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      ≈ {formatUsd(usd)}
                    </span>
                    {cov && (
                      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Hedge coverage: {Math.round(cov.coverage_pct)}%
                        </span>
                        <span className={`badge ${coverageBadgeClass(cov.coverage_pct)}`} style={{ fontSize: '0.6875rem' }}>
                          {coverageLabel(cov.coverage_pct)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div style={{ height: 6, background: 'var(--border)', borderRadius: 999 }}>
                    <div style={{ height: '100%', width: `${barWidth}%`, background: 'var(--teal)', borderRadius: 999, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Top suppliers */}
      {supplierBreakdown.length > 0 && (
        <div className="card">
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
            Top Suppliers
          </div>
          <div className="data-table">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Supplier', 'Open POs', 'Total (USD equiv)', 'Currencies', 'Avg Due Date'].map(h => (
                    <th key={h} style={{
                      textAlign: h === 'Open POs' || h === 'Total (USD equiv)' ? 'right' : 'left',
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
                {supplierBreakdown.map(row => (
                  <tr key={row.supplier} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                    <td style={{ padding: '0.625rem 0.75rem', fontWeight: 500, color: 'var(--text-primary)', fontSize: '0.8125rem' }}>
                      {row.supplier}
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                      {row.count}
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {formatUsd(row.usd)}
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-secondary)', fontSize: '0.8125rem', fontFamily: 'var(--font-mono)' }}>
                      {row.currencies}
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-secondary)', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                      {row.avgDueDate}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Upload Tab ────────────────────────────────────────────────

interface UploadTabProps {
  onImported: () => void
  addOrders: (rows: Omit<PurchaseOrder, 'id' | 'uploaded_at'>[]) => Promise<void>
}

function UploadTab({ onImported, addOrders }: UploadTabProps) {
  return (
    <UploadWizard
      label="Purchase Orders"
      icon={ShoppingCart}
      color="#f59e0b"
      parse={parsePurchaseOrderCsv}
      columns={[
        { key: 'po_number',   label: 'PO Number' },
        { key: 'supplier',    label: 'Supplier' },
        { key: 'currency',    label: 'Currency' },
        { key: 'amount',      label: 'Amount', format: (v) => v?.toLocaleString() ?? '—' },
        { key: 'due_date',    label: 'Due Date' },
        { key: 'category',    label: 'Category' },
        { key: 'status',      label: 'Status' },
      ]}
      onImport={async (rows, entityId) => {
        try {
          const enriched = rows.map(r => ({ ...r, entity_id: entityId ?? undefined }))
          await addOrders(enriched)
          onImported()
          return { error: null }
        } catch (err: any) {
          return { error: err?.message ?? 'Import failed' }
        }
      }}
      downloadTemplate={downloadPurchaseOrderTemplate}
      onDone={onImported}
    />
  )
}

// ── Main Page ─────────────────────────────────────────────────

type Tab = 'orders' | 'analysis' | 'upload'

export function PurchaseOrdersPage() {
  const { orders, addOrder, addOrders, updateOrder, deleteOrder, loading } = usePurchaseOrders()
  const [activeTab, setActiveTab] = useState<Tab>('orders')

  const TABS: { key: Tab; label: string }[] = [
    { key: 'orders',   label: 'Orders' },
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
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
            <ShoppingCart size={20} style={{ color: 'var(--teal)' }} />
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Purchase Orders
            </h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>
            Manage accounts payable, track supplier POs and payment obligations.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {orders.filter(o => ACTIVE_STATUSES.includes(o.status)).length} open POs
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 1.25rem' }}>
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '0.875rem 1rem',
                fontSize: '0.875rem',
                fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab.key ? '2px solid var(--teal)' : '2px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.15s',
                marginBottom: -1,
              }}
            >
              {tab.label}
              {tab.key === 'orders' && orders.length > 0 && (
                <span style={{ marginLeft: '0.5rem', fontSize: '0.6875rem', background: 'var(--bg-app)', color: 'var(--text-muted)', padding: '0.1rem 0.4rem', borderRadius: 999, fontWeight: 400 }}>
                  {orders.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div style={{ padding: '1.25rem' }}>
          {activeTab === 'orders' && (
            <OrdersTab
              orders={orders}
              onAdd={addOrder}
              onUpdate={updateOrder}
              onDelete={deleteOrder}
              onSwitchToUpload={() => setActiveTab('upload')}
            />
          )}
          {activeTab === 'analysis' && (
            <AnalysisTab orders={orders} />
          )}
          {activeTab === 'upload' && (
            <UploadTab
              addOrders={addOrders}
              onImported={() => setActiveTab('orders')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
