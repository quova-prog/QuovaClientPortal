import { useState, useRef, useMemo, useCallback } from 'react'
import {
  Upload, Download, Plus, Pencil, Trash2, X, Check,
  AlertCircle, CheckCircle, ArrowLeftRight,
} from 'lucide-react'
import { useIntercompanyTransfers } from '@/hooks/useIntercompanyTransfers'
import type { IntercompanyTransfer } from '@/hooks/useIntercompanyTransfers'
import { parseIntercompanyCsv, downloadIntercompanyTemplate } from '@/lib/intercompanyParser'
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

function StatusBadge({ status }: { status: IntercompanyTransfer['status'] }) {
  const map: Record<IntercompanyTransfer['status'], string> = {
    scheduled: 'badge-blue', completed: 'badge-teal', pending: 'badge-amber', cancelled: 'badge-gray',
  }
  return <span className={`badge ${map[status]}`} style={{ fontSize: '0.6875rem', textTransform: 'capitalize' }}>{status}</span>
}

function TypeBadge({ type }: { type: IntercompanyTransfer['transfer_type'] }) {
  const map: Record<IntercompanyTransfer['transfer_type'], string> = {
    dividend: 'badge-teal', loan: 'badge-blue', service: 'badge-amber', goods: 'badge-gray', other: 'badge-gray',
  }
  return <span className={`badge ${map[type]}`} style={{ fontSize: '0.6875rem', textTransform: 'capitalize' }}>{type}</span>
}

// ── Transfer Modal ────────────────────────────────────────────

function TransferModal({ initial, onSave, onClose }: {
  initial?: IntercompanyTransfer | null
  onSave: (data: Omit<IntercompanyTransfer, 'id' | 'uploaded_at'>) => void
  onClose: () => void
}) {
  const [date, setDate]           = useState(initial?.transfer_date ?? '')
  const [fromEntity, setFrom]     = useState(initial?.from_entity ?? '')
  const [toEntity, setTo]         = useState(initial?.to_entity ?? '')
  const [currency, setCurrency]   = useState(initial?.currency ?? '')
  const [amount, setAmount]       = useState(initial?.amount?.toString() ?? '')
  const [tType, setTType]         = useState<IntercompanyTransfer['transfer_type']>(initial?.transfer_type ?? 'other')
  const [status, setStatus]       = useState<IntercompanyTransfer['status']>(initial?.status ?? 'scheduled')
  const [reference, setReference] = useState(initial?.reference ?? '')
  const [description, setDesc]    = useState(initial?.description ?? '')
  const [formError, setFormError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setFormError('')
    if (!date) { setFormError('Transfer date is required'); return }
    const from = fromEntity.trim(); if (!from) { setFormError('From entity is required'); return }
    const to   = toEntity.trim();   if (!to)   { setFormError('To entity is required'); return }
    const cur  = currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(cur)) { setFormError('Currency must be a 3-letter ISO code'); return }
    const amt = parseFloat(amount.replace(/,/g, ''))
    if (isNaN(amt) || amt <= 0) { setFormError('Amount must be a positive number'); return }
    onSave({ transfer_date: date, from_entity: from, to_entity: to, currency: cur, amount: amt, transfer_type: tType, status, reference: reference.trim(), description: description.trim() })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: 560, background: 'var(--bg-card)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{initial ? 'Edit Transfer' : 'Add Transfer'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div>
            <label className="label">Transfer Date *</label>
            <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">From Entity *</label>
              <input className="input" placeholder="Acme Corp USA" value={fromEntity} onChange={e => setFrom(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label className="label">To Entity *</label>
              <input className="input" placeholder="Acme Corp GmbH" value={toEntity} onChange={e => setTo(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Currency *</label>
              <input className="input" placeholder="USD" value={currency} onChange={e => setCurrency(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }} maxLength={3} />
            </div>
            <div>
              <label className="label">Amount *</label>
              <input className="input" type="number" placeholder="5000000" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} min={0} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Transfer Type</label>
              <select className="input" value={tType} onChange={e => setTType(e.target.value as IntercompanyTransfer['transfer_type'])} style={{ width: '100%', boxSizing: 'border-box', height: 36 }}>
                <option value="dividend">Dividend</option>
                <option value="loan">Loan</option>
                <option value="service">Service</option>
                <option value="goods">Goods</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={status} onChange={e => setStatus(e.target.value as IntercompanyTransfer['status'])} style={{ width: '100%', boxSizing: 'border-box', height: 36 }}>
                <option value="scheduled">Scheduled</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Reference</label>
            <input className="input" placeholder="ICT-2025-001" value={reference} onChange={e => setReference(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} />
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" placeholder="Optional notes" value={description} onChange={e => setDesc(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>
          {formError && <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--red)', fontSize: '0.8125rem' }}><AlertCircle size={14} /> {formError}</div>}
          <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm">{initial ? 'Save Changes' : 'Add Transfer'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Transfers Tab ─────────────────────────────────────────────

function TransfersTab({ transfers, onAdd, onUpdate, onDelete, onSwitchToUpload }: {
  transfers: IntercompanyTransfer[]
  onAdd: (d: Omit<IntercompanyTransfer, 'id' | 'uploaded_at'>) => void
  onUpdate: (id: string, u: Partial<IntercompanyTransfer>) => void
  onDelete: (id: string) => void
  onSwitchToUpload: () => void
}) {
  const [statusFilter, setStatusFilter]   = useState<'All' | IntercompanyTransfer['status']>('All')
  const [typeFilter, setTypeFilter]       = useState<'All' | IntercompanyTransfer['transfer_type']>('All')
  const [currencyFilter, setCurrFilter]   = useState('All')
  const [showModal, setShowModal]         = useState(false)
  const [editing, setEditing]             = useState<IntercompanyTransfer | null>(null)
  const [deletingId, setDeletingId]       = useState<string | null>(null)

  const currencies = useMemo(() => ['All', ...Array.from(new Set(transfers.map(t => t.currency))).sort()], [transfers])

  const filtered = useMemo(() => transfers.filter(t => {
    if (statusFilter !== 'All' && t.status !== statusFilter) return false
    if (typeFilter !== 'All' && t.transfer_type !== typeFilter) return false
    if (currencyFilter !== 'All' && t.currency !== currencyFilter) return false
    return true
  }), [transfers, statusFilter, typeFilter, currencyFilter])

  function handleSave(data: Omit<IntercompanyTransfer, 'id' | 'uploaded_at'>) {
    if (editing) { onUpdate(editing.id, data) } else { onAdd(data) }
    setShowModal(false); setEditing(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="pill-tabs" style={{ flexShrink: 0 }}>
          {(['All', 'scheduled', 'completed', 'pending', 'cancelled'] as const).map(s => (
            <button key={s} className={`pill-tab${statusFilter === s ? ' active' : ''}`} onClick={() => setStatusFilter(s)} style={{ textTransform: s === 'All' ? undefined : 'capitalize' }}>{s}</button>
          ))}
        </div>
        <div className="pill-tabs" style={{ flexShrink: 0 }}>
          {(['All', 'dividend', 'loan', 'service', 'goods', 'other'] as const).map(t => (
            <button key={t} className={`pill-tab${typeFilter === t ? ' active' : ''}`} onClick={() => setTypeFilter(t)} style={{ textTransform: t === 'All' ? undefined : 'capitalize' }}>{t}</button>
          ))}
        </div>
        <select className="input" value={currencyFilter} onChange={e => setCurrFilter(e.target.value)} style={{ height: 32, padding: '0 0.625rem', fontSize: '0.8125rem', minWidth: 120 }}>
          {currencies.map(c => <option key={c} value={c}>{c === 'All' ? 'All Currencies' : c}</option>)}
        </select>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 'auto' }}>{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
        <button className="btn btn-ghost btn-sm" onClick={onSwitchToUpload} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Upload size={13} /> Import CSV</button>
        <button className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setShowModal(true) }} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Plus size={13} /> Add Transfer</button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <ArrowLeftRight size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>No intercompany transfers found</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>Import a CSV file or add transfers manually.</div>
          <button className="btn btn-primary btn-sm" onClick={onSwitchToUpload} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Upload size={13} /> Upload CSV</button>
        </div>
      ) : (
        <div className="data-table">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Date', 'From', 'To', 'Currency', 'Amount', 'Type', 'Status', 'Reference', 'Actions'].map(h => (
                  <th key={h} style={{ textAlign: h === 'Amount' ? 'right' : h === 'Actions' ? 'center' : 'left', padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const isDeleting = deletingId === t.id
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                    <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{formatDate(t.transfer_date)}</td>
                    <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{t.from_entity}</td>
                    <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{t.to_entity}</td>
                    <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                      <span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700 }}>{t.currency}</span>
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{formatAmount(t.amount, t.currency)}</td>
                    <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}><TypeBadge type={t.transfer_type} /></td>
                    <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}><StatusBadge status={t.status} /></td>
                    <td style={{ padding: '0.625rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{t.reference || '—'}</td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {isDeleting ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', justifyContent: 'center' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Confirm?</span>
                          <button className="btn btn-sm" style={{ background: 'var(--red)', color: '#fff', border: 'none', padding: '0.2rem 0.5rem' }} onClick={() => { onDelete(t.id); setDeletingId(null) }}><Check size={11} /></button>
                          <button className="btn btn-ghost btn-sm" style={{ padding: '0.2rem 0.5rem' }} onClick={() => setDeletingId(null)}><X size={11} /></button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', justifyContent: 'center' }}>
                          <button className="btn btn-ghost btn-sm" style={{ padding: '0.25rem' }} title="Edit" onClick={() => { setEditing(t); setShowModal(true) }}><Pencil size={13} /></button>
                          <button className="btn btn-ghost btn-sm" style={{ padding: '0.25rem', color: 'var(--red)' }} title="Delete" onClick={() => setDeletingId(t.id)}><Trash2 size={13} /></button>
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

      {showModal && <TransferModal initial={editing} onSave={handleSave} onClose={() => { setShowModal(false); setEditing(null) }} />}
    </div>
  )
}

// ── Analysis Tab ──────────────────────────────────────────────

function AnalysisTab({ transfers }: { transfers: IntercompanyTransfer[] }) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const in30  = useMemo(() => new Date(today.getTime() + 30 * 86400000), [today])

  const totalVolumeUsd    = useMemo(() => transfers.reduce((s, t) => s + toUsd(t.amount, t.currency), 0), [transfers])
  const scheduledUsd      = useMemo(() => transfers.filter(t => t.status === 'scheduled').reduce((s, t) => s + toUsd(t.amount, t.currency), 0), [transfers])
  const pendingUsd        = useMemo(() => transfers.filter(t => t.status === 'pending').reduce((s, t) => s + toUsd(t.amount, t.currency), 0), [transfers])
  const entitiesInvolved  = useMemo(() => new Set([...transfers.map(t => t.from_entity), ...transfers.map(t => t.to_entity)]).size, [transfers])

  // By type
  const typeBreakdown = useMemo(() => {
    const map = new Map<string, { usd: number; count: number }>()
    for (const t of transfers) {
      const cur = map.get(t.transfer_type) ?? { usd: 0, count: 0 }
      cur.usd += toUsd(t.amount, t.currency); cur.count++
      map.set(t.transfer_type, cur)
    }
    return Array.from(map.entries()).map(([type, v]) => ({ type, ...v })).sort((a, b) => b.usd - a.usd)
  }, [transfers])

  const maxTypeUsd = typeBreakdown[0]?.usd ?? 1

  // Entity flow matrix
  const flowMatrix = useMemo(() => {
    const map = new Map<string, { usd: number; count: number }>()
    for (const t of transfers) {
      const key = `${t.from_entity}|||${t.to_entity}|||${t.currency}`
      const cur = map.get(key) ?? { usd: 0, count: 0 }
      cur.usd += toUsd(t.amount, t.currency); cur.count++
      map.set(key, cur)
    }
    return Array.from(map.entries())
      .map(([key, v]) => { const [from, to, ccy] = key.split('|||'); return { from, to, ccy, ...v } })
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 20)
  }, [transfers])

  // Upcoming 30d
  const upcoming = useMemo(() =>
    transfers
      .filter(t => {
        const d = new Date(t.transfer_date + 'T00:00:00')
        return t.status !== 'cancelled' && d >= today && d <= in30
      })
      .sort((a, b) => a.transfer_date.localeCompare(b.transfer_date)),
    [transfers, today, in30]
  )

  if (transfers.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: '2rem' }}>
        <ArrowLeftRight size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>No transfer data</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Add or import transfers to see analysis.</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        {[
          { label: 'Total Volume', value: formatUsd(totalVolumeUsd), sub: 'USD equivalent, all transfers', color: 'var(--teal)' },
          { label: 'Scheduled', value: formatUsd(scheduledUsd), sub: 'status = scheduled', color: '#3b82f6' },
          { label: 'Pending Approval', value: formatUsd(pendingUsd), sub: 'status = pending', color: pendingUsd > 0 ? '#f59e0b' : 'var(--text-muted)' },
          { label: 'Entities Involved', value: entitiesInvolved.toString(), sub: 'distinct from + to entities', color: 'var(--teal)' },
        ].map(tile => (
          <div key={tile.label} className="card" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.375rem', fontWeight: 500 }}>{tile.label}</div>
            <div style={{ fontSize: '1.375rem', fontWeight: 700, color: tile.color, fontFamily: 'var(--font-mono)', lineHeight: 1.2 }}>{tile.value}</div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{tile.sub}</div>
          </div>
        ))}
      </div>

      {/* Flow by Type */}
      {typeBreakdown.length > 0 && (
        <div className="card">
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>Flow by Transfer Type</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            {typeBreakdown.map(row => {
              const pct = totalVolumeUsd > 0 ? (row.usd / totalVolumeUsd * 100).toFixed(1) : '0.0'
              const barWidth = maxTypeUsd > 0 ? (row.usd / maxTypeUsd) * 100 : 0
              return (
                <div key={row.type}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.375rem' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', minWidth: 80, textTransform: 'capitalize' }}>{row.type}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)' }}>{formatUsd(row.usd)}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{row.count} transfer{row.count !== 1 ? 's' : ''}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{pct}%</span>
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

      {/* Entity Flow Matrix */}
      {flowMatrix.length > 0 && (
        <div className="card">
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>Entity Flow Matrix</div>
          <div className="data-table">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['From', 'To', 'Currency', 'Amount (USD)', 'Count'].map((h, i) => (
                    <th key={i} style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', textAlign: i >= 3 ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flowMatrix.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                    <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{row.from}</td>
                    <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{row.to}</td>
                    <td style={{ padding: '0.625rem 0.75rem' }}><span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700 }}>{row.ccy}</span></td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{formatUsd(row.usd)}</td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Upcoming 30d */}
      <div className="card">
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Upcoming Transfers (Next 30 Days)
          <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>{upcoming.length} transfer{upcoming.length !== 1 ? 's' : ''}</span>
        </div>
        {upcoming.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', padding: '0.5rem 0' }}>No upcoming transfers in the next 30 days.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {upcoming.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem', background: 'var(--bg-app)', borderRadius: 'var(--r-md)', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: 90 }}>{formatDate(t.transfer_date)}</span>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', fontWeight: 500 }}>{t.from_entity}</span>
                <ArrowLeftRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', fontWeight: 500 }}>{t.to_entity}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: 600, marginLeft: 'auto' }}>{formatAmount(t.amount, t.currency)}</span>
                <TypeBadge type={t.transfer_type} />
                <StatusBadge status={t.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Upload Tab ────────────────────────────────────────────────

function UploadTab({ onImported, addTransfers }: { onImported: () => void; addTransfers: (rows: Omit<IntercompanyTransfer, 'id' | 'uploaded_at'>[]) => Promise<void> }) {
  const { user, db } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging]           = useState(false)
  const [parsing, setParsing]             = useState(false)
  const [parseResult, setParseResult]     = useState<{ data: Omit<IntercompanyTransfer, 'id' | 'uploaded_at'>[]; errors: string[]; fileName: string } | null>(null)
  const [importing, setImporting]         = useState(false)
  const [importSuccess, setImportSuccess] = useState(false)
  const [selectedFile, setSelectedFile]   = useState<File | null>(null)
  const [importError, setImportError]     = useState<string | null>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) { setParseResult({ data: [], errors: ['Only CSV files are supported.'], fileName: file.name }); return }
    setParsing(true); setParseResult(null); setImportSuccess(false); setImportError(null); setSelectedFile(file)
    const result = await parseIntercompanyCsv(file)
    setParseResult({ ...result, fileName: file.name }); setParsing(false)
  }, [])

  function handleDrop(e: React.DragEvent) { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }
  async function handleImport() {
    if (!parseResult || parseResult.data.length === 0) return
    setImportError(null)
    const orgId = user?.profile?.org_id
    if (orgId && selectedFile) {
      const dupeCheck = await checkFileAlreadyUploaded(db, orgId, selectedFile, 'intercompany_transfers')
      if (dupeCheck.isDuplicate) {
        setImportError(`This file was already uploaded on ${formatUploadDate(dupeCheck.uploadedAt!)}. To re-upload, first clear the existing data.`)
        return
      }
    }
    setImporting(true)
    try {
      await addTransfers(parseResult.data)
      if (orgId && selectedFile) {
        await recordUploadBatch(db, orgId, user?.id, selectedFile, 'intercompany_transfers', parseResult.data.length)
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
            <div className="spinner" style={{ width: 28, height: 28 }} /><span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Parsing CSV…</span>
          </div>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: 'var(--red)', fontWeight: 600, fontSize: '0.8125rem' }}>
                <AlertCircle size={14} />{parseResult.errors.length} error{parseResult.errors.length !== 1 ? 's' : ''}
              </div>
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
                  <thead><tr>
                    {['Date', 'From', 'To', 'Currency', 'Amount', 'Type', 'Status'].map(h => (
                      <th key={h} style={{ padding: '0.5rem 0.625rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {parseResult.data.slice(0, 10).map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                        <td style={{ padding: '0.5rem 0.625rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.transfer_date}</td>
                        <td style={{ padding: '0.5rem 0.625rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{row.from_entity}</td>
                        <td style={{ padding: '0.5rem 0.625rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{row.to_entity}</td>
                        <td style={{ padding: '0.5rem 0.625rem' }}><span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', fontWeight: 700 }}>{row.currency}</span></td>
                        <td style={{ padding: '0.5rem 0.625rem', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{formatAmount(row.amount, row.currency)}</td>
                        <td style={{ padding: '0.5rem 0.625rem' }}><TypeBadge type={row.transfer_type} /></td>
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
                  Import {parseResult.data.length} Transfer{parseResult.data.length !== 1 ? 's' : ''}
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
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Redirecting to transfers…</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>CSV Format Guide</div>
          <button className="btn btn-ghost btn-sm" onClick={downloadIntercompanyTemplate} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Download size={13} /> Download Template</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[
            { col: 'transfer_date', req: true,  ex: '2025-07-01',      desc: 'Transfer / settlement date (YYYY-MM-DD)' },
            { col: 'from_entity',   req: true,  ex: 'Acme Corp USA',   desc: 'Sending / paying entity' },
            { col: 'to_entity',     req: true,  ex: 'Acme Corp GmbH',  desc: 'Receiving entity' },
            { col: 'currency',      req: true,  ex: 'USD',             desc: '3-letter ISO currency code' },
            { col: 'amount',        req: true,  ex: '5000000',         desc: 'Transfer amount in stated currency' },
            { col: 'transfer_type', req: false, ex: 'dividend',        desc: 'dividend / loan / service / goods / other' },
            { col: 'status',        req: false, ex: 'scheduled',       desc: 'scheduled / pending / completed / cancelled' },
            { col: 'reference',     req: false, ex: 'ICT-2025-001',    desc: 'Reference number or ID' },
            { col: 'description',   req: false, ex: 'Q2 upstream div', desc: 'Optional notes' },
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
          Column headers are case-insensitive. Accepted aliases: <em>from/sender</em> for from_entity, <em>to/receiver</em> for to_entity, <em>value/transfer_amount</em> for amount.
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────

type Tab = 'transfers' | 'analysis' | 'upload'

export function IntercompanyPage() {
  const { transfers, addTransfer, addTransfers, updateTransfer, deleteTransfer, loading } = useIntercompanyTransfers()
  const [activeTab, setActiveTab] = useState<Tab>('transfers')

  const TABS: { key: Tab; label: string }[] = [
    { key: 'transfers', label: 'Transfers' },
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
            <ArrowLeftRight size={20} style={{ color: 'var(--teal)' }} />
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Intercompany Transfers</h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>Schedule and track intercompany cash flows, dividends, loans and service charges.</p>
        </div>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{transfers.length} transfer{transfers.length !== 1 ? 's' : ''}</span>
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
              {tab.key === 'transfers' && transfers.length > 0 && (
                <span style={{ marginLeft: '0.5rem', fontSize: '0.6875rem', background: 'var(--bg-app)', color: 'var(--text-muted)', padding: '0.1rem 0.4rem', borderRadius: 999, fontWeight: 400 }}>{transfers.length}</span>
              )}
            </button>
          ))}
        </div>
        <div style={{ padding: '1.25rem' }}>
          {activeTab === 'transfers' && <TransfersTab transfers={transfers} onAdd={addTransfer} onUpdate={updateTransfer} onDelete={deleteTransfer} onSwitchToUpload={() => setActiveTab('upload')} />}
          {activeTab === 'analysis'  && <AnalysisTab transfers={transfers} />}
          {activeTab === 'upload'    && <UploadTab addTransfers={addTransfers} onImported={() => setActiveTab('transfers')} />}
        </div>
      </div>
    </div>
  )
}
