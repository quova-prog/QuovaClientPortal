import { useState, useRef, useMemo, useCallback } from 'react'
import {
  Upload, Download, Plus, Pencil, Trash2, X, Check,
  AlertCircle, CheckCircle, Building2,
} from 'lucide-react'
import { useCapex } from '@/hooks/useCapex'
import type { CapexEntry } from '@/hooks/useCapex'
import { parseCapexCsv, downloadCapexTemplate } from '@/lib/capexParser'
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

function StatusBadge({ status }: { status: CapexEntry['status'] }) {
  const map: Record<CapexEntry['status'], string> = {
    planned: 'badge-gray', approved: 'badge-blue', committed: 'badge-amber', completed: 'badge-teal',
  }
  return <span className={`badge ${map[status]}`} style={{ fontSize: '0.6875rem', textTransform: 'capitalize' }}>{status}</span>
}

// ── CapEx Modal ───────────────────────────────────────────────

function CapexModal({ initial, onSave, onClose }: {
  initial?: CapexEntry | null
  onSave: (d: Omit<CapexEntry, 'id' | 'uploaded_at'>) => void
  onClose: () => void
}) {
  const [projectName, setProjectName]   = useState(initial?.project_name ?? '')
  const [currency, setCurrency]         = useState(initial?.currency ?? '')
  const [budget, setBudget]             = useState(initial?.budget_amount?.toString() ?? '')
  const [committed, setCommitted]       = useState(initial?.committed_amount?.toString() ?? '')
  const [paymentDate, setPaymentDate]   = useState(initial?.payment_date ?? '')
  const [category, setCategory]         = useState<CapexEntry['category']>(initial?.category ?? 'other')
  const [entity, setEntity]             = useState(initial?.entity ?? '')
  const [status, setStatus]             = useState<CapexEntry['status']>(initial?.status ?? 'planned')
  const [description, setDesc]          = useState(initial?.description ?? '')
  const [formError, setFormError]       = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setFormError('')
    const name = projectName.trim(); if (!name) { setFormError('Project name is required'); return }
    const cur = currency.trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(cur)) { setFormError('Currency must be a 3-letter ISO code'); return }
    const budgetNum = parseFloat(budget.replace(/,/g, '')); if (isNaN(budgetNum) || budgetNum <= 0) { setFormError('Budget amount must be a positive number'); return }
    if (!paymentDate) { setFormError('Payment date is required'); return }
    const committedNum = parseFloat(committed.replace(/,/g, '')) || 0
    onSave({ project_name: name, currency: cur, budget_amount: budgetNum, committed_amount: committedNum, payment_date: paymentDate, category, entity: entity.trim(), status, description: description.trim() })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: 560, background: 'var(--bg-card)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{initial ? 'Edit CapEx Entry' : 'Add CapEx Entry'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div>
            <label className="label">Project Name *</label>
            <input className="input" placeholder="CNC Machining Centre Upgrade" value={projectName} onChange={e => setProjectName(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Currency *</label>
              <input className="input" placeholder="USD" value={currency} onChange={e => setCurrency(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }} maxLength={3} />
            </div>
            <div>
              <label className="label">Budget Amount *</label>
              <input className="input" type="number" placeholder="850000" value={budget} onChange={e => setBudget(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} min={0} />
            </div>
            <div>
              <label className="label">Committed Amount</label>
              <input className="input" type="number" placeholder="720000" value={committed} onChange={e => setCommitted(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} min={0} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Payment Date *</label>
              <input className="input" type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} />
            </div>
            <div>
              <label className="label">Category</label>
              <select className="input" value={category} onChange={e => setCategory(e.target.value as CapexEntry['category'])} style={{ width: '100%', boxSizing: 'border-box', height: 36 }}>
                <option value="equipment">Equipment</option>
                <option value="property">Property</option>
                <option value="technology">Technology</option>
                <option value="infrastructure">Infrastructure</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Entity</label>
              <input className="input" placeholder="Manufacturing Corp" value={entity} onChange={e => setEntity(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={status} onChange={e => setStatus(e.target.value as CapexEntry['status'])} style={{ width: '100%', boxSizing: 'border-box', height: 36 }}>
                <option value="planned">Planned</option>
                <option value="approved">Approved</option>
                <option value="committed">Committed</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" placeholder="Optional notes" value={description} onChange={e => setDesc(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>
          {formError && <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--red)', fontSize: '0.8125rem' }}><AlertCircle size={14} /> {formError}</div>}
          <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm">{initial ? 'Save Changes' : 'Add Entry'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── CapEx Tab ─────────────────────────────────────────────────

function CapexTab({ entries, onAdd, onUpdate, onDelete, onSwitchToUpload }: {
  entries: CapexEntry[]
  onAdd: (d: Omit<CapexEntry, 'id' | 'uploaded_at'>) => void
  onUpdate: (id: string, u: Partial<CapexEntry>) => void
  onDelete: (id: string) => void
  onSwitchToUpload: () => void
}) {
  const [statusFilter, setStatusFilter]     = useState<'All' | CapexEntry['status']>('All')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [currencyFilter, setCurrFilter]     = useState('All')
  const [showModal, setShowModal]           = useState(false)
  const [editing, setEditing]               = useState<CapexEntry | null>(null)
  const [deletingId, setDeletingId]         = useState<string | null>(null)

  const categories = useMemo(() => ['All', ...Array.from(new Set(entries.map(e => e.category))).sort()], [entries])
  const currencies = useMemo(() => ['All', ...Array.from(new Set(entries.map(e => e.currency))).sort()], [entries])

  const filtered = useMemo(() => entries.filter(e => {
    if (statusFilter !== 'All' && e.status !== statusFilter) return false
    if (categoryFilter !== 'All' && e.category !== categoryFilter) return false
    if (currencyFilter !== 'All' && e.currency !== currencyFilter) return false
    return true
  }), [entries, statusFilter, categoryFilter, currencyFilter])

  function handleSave(data: Omit<CapexEntry, 'id' | 'uploaded_at'>) {
    if (editing) { onUpdate(editing.id, data) } else { onAdd(data) }
    setShowModal(false); setEditing(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="pill-tabs" style={{ flexShrink: 0 }}>
          {(['All', 'planned', 'approved', 'committed', 'completed'] as const).map(s => (
            <button key={s} className={`pill-tab${statusFilter === s ? ' active' : ''}`} onClick={() => setStatusFilter(s)} style={{ textTransform: s === 'All' ? undefined : 'capitalize' }}>{s}</button>
          ))}
        </div>
        <select className="input" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ height: 32, padding: '0 0.625rem', fontSize: '0.8125rem', minWidth: 140 }}>
          {categories.map(c => <option key={c} value={c}>{c === 'All' ? 'All Categories' : c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
        </select>
        <select className="input" value={currencyFilter} onChange={e => setCurrFilter(e.target.value)} style={{ height: 32, padding: '0 0.625rem', fontSize: '0.8125rem', minWidth: 120 }}>
          {currencies.map(c => <option key={c} value={c}>{c === 'All' ? 'All Currencies' : c}</option>)}
        </select>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 'auto' }}>{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
        <button className="btn btn-ghost btn-sm" onClick={onSwitchToUpload} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Upload size={13} /> Import CSV</button>
        <button className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setShowModal(true) }} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Plus size={13} /> Add Entry</button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <Building2 size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>No CapEx entries found</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>Import a CSV file or add entries manually.</div>
          <button className="btn btn-primary btn-sm" onClick={onSwitchToUpload} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Upload size={13} /> Upload CSV</button>
        </div>
      ) : (
        <div className="data-table">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Project', 'Currency', 'Budget', 'Committed', 'Utilization', 'Payment Date', 'Category', 'Entity', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ textAlign: h === 'Budget' || h === 'Committed' ? 'right' : h === 'Actions' ? 'center' : 'left', padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => {
                const isDeleting = deletingId === e.id
                const utilPct    = e.budget_amount > 0 ? (e.committed_amount / e.budget_amount) : 0
                const overBudget = utilPct > 1
                return (
                  <tr key={e.id} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                    <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-primary)', fontWeight: 500 }}>{e.project_name}</td>
                    <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                      <span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700 }}>{e.currency}</span>
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{formatAmount(e.budget_amount, e.currency)}</td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: overBudget ? 'var(--red)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {e.committed_amount > 0 ? formatAmount(e.committed_amount, e.currency) : '—'}
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', minWidth: 90 }}>
                      {e.budget_amount > 0 && e.committed_amount > 0 ? (
                        <div>
                          <div style={{ fontSize: '0.6875rem', color: overBudget ? 'var(--red)' : 'var(--text-muted)', marginBottom: '0.2rem', fontFamily: 'var(--font-mono)' }}>
                            {Math.round(utilPct * 100)}%{overBudget && ' ⚠'}
                          </div>
                          <div style={{ height: 5, background: 'var(--border)', borderRadius: 999 }}>
                            <div style={{ height: '100%', width: `${Math.min(utilPct * 100, 100)}%`, background: overBudget ? 'var(--red)' : 'var(--teal)', borderRadius: 999 }} />
                          </div>
                        </div>
                      ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>}
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{formatDate(e.payment_date)}</td>
                    <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{e.category}</td>
                    <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{e.entity || '—'}</td>
                    <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}><StatusBadge status={e.status} /></td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {isDeleting ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', justifyContent: 'center' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Confirm?</span>
                          <button className="btn btn-sm" style={{ background: 'var(--red)', color: '#fff', border: 'none', padding: '0.2rem 0.5rem' }} onClick={() => { onDelete(e.id); setDeletingId(null) }}><Check size={11} /></button>
                          <button className="btn btn-ghost btn-sm" style={{ padding: '0.2rem 0.5rem' }} onClick={() => setDeletingId(null)}><X size={11} /></button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', justifyContent: 'center' }}>
                          <button className="btn btn-ghost btn-sm" style={{ padding: '0.25rem' }} title="Edit" onClick={() => { setEditing(e); setShowModal(true) }}><Pencil size={13} /></button>
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
      )}

      {showModal && <CapexModal initial={editing} onSave={handleSave} onClose={() => { setShowModal(false); setEditing(null) }} />}
    </div>
  )
}

// ── Analysis Tab ──────────────────────────────────────────────

function AnalysisTab({ entries }: { entries: CapexEntry[] }) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const in90  = useMemo(() => new Date(today.getTime() + 90 * 86400000), [today])

  const totalBudgetUsd    = useMemo(() => entries.reduce((s, e) => s + toUsd(e.budget_amount, e.currency), 0), [entries])
  const totalCommittedUsd = useMemo(() => entries.reduce((s, e) => s + toUsd(e.committed_amount, e.currency), 0), [entries])
  const utilizationPct    = useMemo(() => totalBudgetUsd > 0 ? (totalCommittedUsd / totalBudgetUsd * 100) : 0, [totalBudgetUsd, totalCommittedUsd])
  const activeCount       = useMemo(() => entries.filter(e => e.status !== 'completed').length, [entries])

  // By category
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { budget: number; committed: number }>()
    for (const e of entries) {
      const cur = map.get(e.category) ?? { budget: 0, committed: 0 }
      cur.budget    += toUsd(e.budget_amount, e.currency)
      cur.committed += toUsd(e.committed_amount, e.currency)
      map.set(e.category, cur)
    }
    return Array.from(map.entries()).map(([cat, v]) => ({ cat, ...v, util: v.budget > 0 ? v.committed / v.budget : 0 })).sort((a, b) => b.budget - a.budget)
  }, [entries])

  // By status
  const statusBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; budgetUsd: number }>()
    for (const e of entries) {
      const cur = map.get(e.status) ?? { count: 0, budgetUsd: 0 }
      cur.count++; cur.budgetUsd += toUsd(e.budget_amount, e.currency)
      map.set(e.status, cur)
    }
    return Array.from(map.entries()).map(([status, v]) => ({ status, ...v }))
  }, [entries])

  // Upcoming 90d
  const upcoming90 = useMemo(() =>
    entries.filter(e => {
      const d = new Date(e.payment_date + 'T00:00:00')
      return e.status !== 'completed' && d >= today && d <= in90
    }).sort((a, b) => a.payment_date.localeCompare(b.payment_date)),
    [entries, today, in90]
  )

  if (entries.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: '2rem' }}>
        <Building2 size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>No CapEx data</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Add or import CapEx entries to see analysis.</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        {[
          { label: 'Total Budget', value: formatUsd(totalBudgetUsd), sub: 'USD equivalent', color: 'var(--teal)' },
          { label: 'Total Committed', value: formatUsd(totalCommittedUsd), sub: 'USD equivalent', color: 'var(--teal)' },
          { label: 'Budget Utilization', value: `${utilizationPct.toFixed(1)}%`, sub: 'committed / budget', color: utilizationPct > 100 ? 'var(--red)' : utilizationPct > 80 ? '#f59e0b' : 'var(--teal)' },
          { label: 'Active Projects', value: activeCount.toString(), sub: 'status != completed', color: 'var(--teal)' },
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
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>CapEx by Category</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {categoryBreakdown.map(row => {
              const overBudget = row.util > 1
              const barWidth = categoryBreakdown[0].budget > 0 ? (row.budget / categoryBreakdown[0].budget) * 100 : 0
              return (
                <div key={row.cat}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.375rem', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', minWidth: 110, textTransform: 'capitalize' }}>{row.cat}</span>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }}>Budget: <strong style={{ fontFamily: 'var(--font-mono)' }}>{formatUsd(row.budget)}</strong></span>
                    <span style={{ fontSize: '0.8125rem', color: overBudget ? 'var(--red)' : 'var(--text-secondary)' }}>Committed: <strong style={{ fontFamily: 'var(--font-mono)' }}>{formatUsd(row.committed)}</strong></span>
                    <span style={{ fontSize: '0.75rem', color: overBudget ? 'var(--red)' : 'var(--text-muted)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>{Math.round(row.util * 100)}% utilized{overBudget && ' ⚠'}</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--border)', borderRadius: 999 }}>
                    <div style={{ height: '100%', width: `${barWidth}%`, background: 'var(--teal)', borderRadius: 999 }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* By Status */}
      {statusBreakdown.length > 0 && (
        <div className="card">
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>CapEx by Status</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {statusBreakdown.map(row => (
              <div key={row.status} style={{ background: 'var(--bg-app)', borderRadius: 'var(--r-md)', padding: '0.875rem', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <StatusBadge status={row.status as CapexEntry['status']} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{row.count} project{row.count !== 1 ? 's' : ''}</span>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formatUsd(row.budgetUsd)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming 90d */}
      <div className="card">
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Upcoming Payments (Next 90 Days)
          <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>{upcoming90.length} project{upcoming90.length !== 1 ? 's' : ''}</span>
        </div>
        {upcoming90.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No upcoming CapEx payments in the next 90 days.</div>
        ) : (
          <div className="data-table">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                {['Project', 'Currency', 'Budget', 'Committed', 'Payment Date', 'Category', 'Status'].map((h, i) => (
                  <th key={i} style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', textAlign: i >= 2 && i <= 3 ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {upcoming90.map(e => (
                  <tr key={e.id} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                    <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-primary)', fontWeight: 500 }}>{e.project_name}</td>
                    <td style={{ padding: '0.625rem 0.75rem' }}><span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700 }}>{e.currency}</span></td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)' }}>{formatAmount(e.budget_amount, e.currency)}</td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{e.committed_amount > 0 ? formatAmount(e.committed_amount, e.currency) : '—'}</td>
                    <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatDate(e.payment_date)}</td>
                    <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{e.category}</td>
                    <td style={{ padding: '0.625rem 0.75rem' }}><StatusBadge status={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Upload Tab ────────────────────────────────────────────────

function UploadTab({ onImported, addEntries }: { onImported: () => void; addEntries: (rows: Omit<CapexEntry, 'id' | 'uploaded_at'>[]) => Promise<void> }) {
  const { user, db } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging]           = useState(false)
  const [parsing, setParsing]             = useState(false)
  const [parseResult, setParseResult]     = useState<{ data: Omit<CapexEntry, 'id' | 'uploaded_at'>[]; errors: string[]; fileName: string } | null>(null)
  const [importing, setImporting]         = useState(false)
  const [importSuccess, setImportSuccess] = useState(false)
  const [selectedFile, setSelectedFile]   = useState<File | null>(null)
  const [importError, setImportError]     = useState<string | null>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) { setParseResult({ data: [], errors: ['Only CSV files are supported.'], fileName: file.name }); return }
    setParsing(true); setParseResult(null); setImportSuccess(false); setImportError(null); setSelectedFile(file)
    const result = await parseCapexCsv(file)
    setParseResult({ ...result, fileName: file.name }); setParsing(false)
  }, [])

  function handleDrop(e: React.DragEvent) { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }
  async function handleImport() {
    if (!parseResult || parseResult.data.length === 0) return
    setImportError(null)
    const orgId = user?.profile?.org_id
    if (orgId && selectedFile) {
      const dupeCheck = await checkFileAlreadyUploaded(db, orgId, selectedFile, 'capex')
      if (dupeCheck.isDuplicate) {
        setImportError(`This file was already uploaded on ${formatUploadDate(dupeCheck.uploadedAt!)}. To re-upload, first clear the existing data.`)
        return
      }
    }
    setImporting(true)
    try {
      await addEntries(parseResult.data)
      if (orgId && selectedFile) {
        await recordUploadBatch(db, orgId, user?.id, selectedFile, 'capex', parseResult.data.length)
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
                  <thead><tr>{['Project', 'Currency', 'Budget', 'Committed', 'Payment Date', 'Category', 'Status'].map(h => (
                    <th key={h} style={{ padding: '0.5rem 0.625rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}</tr></thead>
                  <tbody>
                    {parseResult.data.slice(0, 10).map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                        <td style={{ padding: '0.5rem 0.625rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.project_name}</td>
                        <td style={{ padding: '0.5rem 0.625rem' }}><span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', fontWeight: 700 }}>{row.currency}</span></td>
                        <td style={{ padding: '0.5rem 0.625rem', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{formatAmount(row.budget_amount, row.currency)}</td>
                        <td style={{ padding: '0.5rem 0.625rem', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{row.committed_amount > 0 ? formatAmount(row.committed_amount, row.currency) : '—'}</td>
                        <td style={{ padding: '0.5rem 0.625rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.payment_date}</td>
                        <td style={{ padding: '0.5rem 0.625rem', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{row.category}</td>
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
                  Import {parseResult.data.length} Entr{parseResult.data.length !== 1 ? 'ies' : 'y'}
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
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Redirecting to CapEx…</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>CSV Format Guide</div>
          <button className="btn btn-ghost btn-sm" onClick={downloadCapexTemplate} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Download size={13} /> Download Template</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[
            { col: 'project_name',     req: true,  ex: 'CNC Upgrade',      desc: 'Project or CapEx item name' },
            { col: 'currency',         req: true,  ex: 'USD',              desc: '3-letter ISO currency code' },
            { col: 'budget_amount',    req: true,  ex: '850000',           desc: 'Total approved budget' },
            { col: 'payment_date',     req: true,  ex: '2025-09-30',       desc: 'Expected payment date (YYYY-MM-DD)' },
            { col: 'committed_amount', req: false, ex: '720000',           desc: 'Amount committed / spent to date' },
            { col: 'category',         req: false, ex: 'equipment',        desc: 'equipment / property / technology / infrastructure / other' },
            { col: 'entity',           req: false, ex: 'Manufacturing Corp',desc: 'Legal entity or subsidiary' },
            { col: 'status',           req: false, ex: 'approved',         desc: 'planned / approved / committed / completed' },
            { col: 'description',      req: false, ex: 'CNC replacement',  desc: 'Optional notes' },
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
          Column headers are case-insensitive. Accepted aliases: <em>project/name</em> for project_name, <em>budget/planned_amount</em> for budget_amount, <em>committed/actual_amount</em> for committed_amount.
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────

type Tab = 'capex' | 'analysis' | 'upload'

export function CapexPage() {
  const { entries, addEntry, addEntries, updateEntry, deleteEntry, loading } = useCapex()
  const [activeTab, setActiveTab] = useState<Tab>('capex')

  const TABS: { key: Tab; label: string }[] = [
    { key: 'capex',    label: 'CapEx' },
    { key: 'analysis', label: 'Analysis' },
    { key: 'upload',   label: 'Upload' },
  ]

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>
  }

  return (
    <div className="fade-in" style={{ padding: '1.5rem', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
            <Building2 size={20} style={{ color: 'var(--teal)' }} />
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Capital Expenditure Plans</h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>Track CapEx projects, budgets, committed spend and payment schedules.</p>
        </div>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{entries.length} project{entries.length !== 1 ? 's' : ''}</span>
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
              {tab.key === 'capex' && entries.length > 0 && (
                <span style={{ marginLeft: '0.5rem', fontSize: '0.6875rem', background: 'var(--bg-app)', color: 'var(--text-muted)', padding: '0.1rem 0.4rem', borderRadius: 999, fontWeight: 400 }}>{entries.length}</span>
              )}
            </button>
          ))}
        </div>
        <div style={{ padding: '1.25rem' }}>
          {activeTab === 'capex'    && <CapexTab entries={entries} onAdd={addEntry} onUpdate={updateEntry} onDelete={deleteEntry} onSwitchToUpload={() => setActiveTab('upload')} />}
          {activeTab === 'analysis' && <AnalysisTab entries={entries} />}
          {activeTab === 'upload'   && <UploadTab addEntries={addEntries} onImported={() => setActiveTab('capex')} />}
        </div>
      </div>
    </div>
  )
}
