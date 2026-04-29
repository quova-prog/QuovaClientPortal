import { useState, useMemo } from 'react'
import {
  Plus, Pencil, Trash2, X, Check,
  AlertCircle, Waves, ChevronDown,
} from 'lucide-react'
import { useCashFlows } from '@/hooks/useCashFlows'
import type { CashFlowEntry } from '@/hooks/useCashFlows'
import { useHedgeCoverage } from '@/hooks/useData'
import { parseCashFlowCsv, downloadCashFlowTemplate } from '@/lib/cashFlowParser'
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

// ── Confidence Badge ──────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: CashFlowEntry['confidence'] }) {
  const styleMap: Record<CashFlowEntry['confidence'], string> = {
    confirmed:  'badge-teal',
    forecast:   'badge-blue',
    indicative: 'badge-amber',
  }
  return (
    <span className={`badge ${styleMap[confidence]}`} style={{ fontSize: '0.6875rem', textTransform: 'capitalize' }}>
      {confidence}
    </span>
  )
}

// ── Flow Type Badge ───────────────────────────────────────────

function FlowTypeBadge({ type }: { type: CashFlowEntry['flow_type'] }) {
  const styleMap: Record<CashFlowEntry['flow_type'], string> = {
    inflow:  'badge-teal',
    outflow: 'badge-red',
    net:     'badge-blue',
  }
  return (
    <span className={`badge ${styleMap[type]}`} style={{ fontSize: '0.6875rem', textTransform: 'capitalize' }}>
      {type}
    </span>
  )
}

// ── Amount Display ────────────────────────────────────────────

function AmountDisplay({ amount, currency }: { amount: number; currency: string }) {
  if (amount >= 0) {
    return (
      <span style={{ color: 'var(--teal)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
        +{formatAmount(amount, currency)}
      </span>
    )
  }
  return (
    <span style={{ color: 'var(--red, #ef4444)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
      -{formatAmount(Math.abs(amount), currency)}
    </span>
  )
}

// ── Flow Modal ────────────────────────────────────────────────

interface FlowModalProps {
  initial?: CashFlowEntry | null
  onSave: (data: Omit<CashFlowEntry, 'id' | 'uploaded_at'>) => void
  onClose: () => void
}

function FlowModal({ initial, onSave, onClose }: FlowModalProps) {
  const [flowDate, setFlowDate]       = useState(initial?.flow_date ?? '')
  const [currency, setCurrency]       = useState(initial?.currency ?? 'USD')
  const [amount, setAmount]           = useState(initial?.amount?.toString() ?? '')
  const [flowType, setFlowType]       = useState<CashFlowEntry['flow_type']>(initial?.flow_type ?? 'inflow')
  const [category, setCategory]       = useState(initial?.category ?? '')
  const [entity, setEntity]           = useState(initial?.entity ?? '')
  const [account, setAccount]         = useState(initial?.account ?? '')
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? '')
  const [description, setDesc]        = useState(initial?.description ?? '')
  const [confidence, setConfidence]   = useState<CashFlowEntry['confidence']>(initial?.confidence ?? 'forecast')
  const [formError, setFormError]     = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')

    if (!flowDate) { setFormError('Flow Date is required'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(flowDate)) {
      setFormError('Flow Date must be in YYYY-MM-DD format')
      return
    }

    const currencyClean = currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(currencyClean)) {
      setFormError('Currency must be a 3-letter ISO code (e.g. EUR, GBP, USD)')
      return
    }

    const amountNum = parseFloat(amount.replace(/,/g, ''))
    if (isNaN(amountNum)) {
      setFormError('Amount must be a valid number (positive for inflows, negative for outflows)')
      return
    }

    // Auto-derive flow_type from amount sign if not net
    let derivedFlowType = flowType
    if (derivedFlowType !== 'net') {
      derivedFlowType = amountNum >= 0 ? 'inflow' : 'outflow'
    }

    onSave({
      flow_date: flowDate,
      currency: currencyClean,
      amount: amountNum,
      flow_type: derivedFlowType,
      category: category.trim(),
      entity: entity.trim(),
      account: account.trim(),
      counterparty: counterparty.trim(),
      description: description.trim(),
      confidence,
    })
  }

  const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box' }
  const monoStyle: React.CSSProperties = { ...inputStyle, fontFamily: 'var(--font-mono)' }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: '1rem',
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 600, background: 'var(--bg-card)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            {initial ? 'Edit Cash Flow Entry' : 'Add Cash Flow Entry'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {/* Row 1: Date, Currency, Amount */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1.5fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Flow Date *</label>
              <input
                className="input"
                type="date"
                value={flowDate}
                onChange={e => setFlowDate(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label className="label">Currency *</label>
              <input
                className="input"
                placeholder="USD"
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                style={{ ...monoStyle, textTransform: 'uppercase' }}
                maxLength={3}
              />
            </div>
            <div>
              <label className="label">Amount *</label>
              <input
                className="input"
                placeholder="500000 or -250000"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                style={monoStyle}
              />
            </div>
          </div>

          {/* Row 2: Flow Type, Confidence */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Flow Type</label>
              <div style={{ position: 'relative' }}>
                <select
                  className="input"
                  value={flowType}
                  onChange={e => setFlowType(e.target.value as CashFlowEntry['flow_type'])}
                  style={{ ...inputStyle, appearance: 'none', paddingRight: '2rem' }}
                >
                  <option value="inflow">Inflow</option>
                  <option value="outflow">Outflow</option>
                  <option value="net">Net</option>
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
              </div>
            </div>
            <div>
              <label className="label">Confidence</label>
              <div style={{ position: 'relative' }}>
                <select
                  className="input"
                  value={confidence}
                  onChange={e => setConfidence(e.target.value as CashFlowEntry['confidence'])}
                  style={{ ...inputStyle, appearance: 'none', paddingRight: '2rem' }}
                >
                  <option value="confirmed">Confirmed</option>
                  <option value="forecast">Forecast</option>
                  <option value="indicative">Indicative</option>
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
              </div>
            </div>
          </div>

          {/* Row 3: Category, Entity */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Category</label>
              <input
                className="input"
                placeholder="Operations, Financing, FX Settlement…"
                value={category}
                onChange={e => setCategory(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label className="label">Entity</label>
              <input
                className="input"
                placeholder="Legal entity or subsidiary"
                value={entity}
                onChange={e => setEntity(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Row 4: Account, Counterparty */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Account</label>
              <input
                className="input"
                placeholder="Bank account or cost centre"
                value={account}
                onChange={e => setAccount(e.target.value)}
                style={monoStyle}
              />
            </div>
            <div>
              <label className="label">Counterparty</label>
              <input
                className="input"
                placeholder="Counterparty name"
                value={counterparty}
                onChange={e => setCounterparty(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="label">Description</label>
            <input
              className="input"
              placeholder="Optional notes or memo"
              value={description}
              onChange={e => setDesc(e.target.value)}
              style={inputStyle}
            />
          </div>

          {formError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--red, #ef4444)', fontSize: '0.8125rem' }}>
              <AlertCircle size={14} />
              {formError}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">
              <Check size={14} /> {initial ? 'Save Changes' : 'Add Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Tab 1: Cash Flows ─────────────────────────────────────────

type FlowTypeFilter = 'all' | 'inflow' | 'outflow'
type HorizonFilter = 'all' | '7d' | '30d' | '90d' | 'past'
type ConfidenceFilter = 'all' | 'confirmed' | 'forecast' | 'indicative'

interface CashFlowsTabProps {
  flows: CashFlowEntry[]
  onAdd: (data: Omit<CashFlowEntry, 'id' | 'uploaded_at'>) => void
  onUpdate: (id: string, updates: Partial<CashFlowEntry>) => void
  onDelete: (id: string) => void
}

function CashFlowsTab({ flows, onAdd, onUpdate, onDelete }: CashFlowsTabProps) {
  const [typeFilter, setTypeFilter]         = useState<FlowTypeFilter>('all')
  const [currencyFilter, setCurrencyFilter] = useState('all')
  const [horizonFilter, setHorizonFilter]   = useState<HorizonFilter>('all')
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all')
  const [editEntry, setEditEntry]           = useState<CashFlowEntry | null>(null)
  const [showModal, setShowModal]           = useState(false)
  const [deleteConfirm, setDeleteConfirm]   = useState<string | null>(null)

  const today = useMemo(() => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    return date
  }, [])

  const currencies = useMemo(() => {
    const set = new Set(flows.map(f => f.currency))
    return ['all', ...Array.from(set).sort()]
  }, [flows])

  const filtered = useMemo(() => {
    return flows.filter(f => {
      if (typeFilter !== 'all' && f.flow_type !== typeFilter) return false
      if (currencyFilter !== 'all' && f.currency !== currencyFilter) return false
      if (confidenceFilter !== 'all' && f.confidence !== confidenceFilter) return false

      if (horizonFilter !== 'all') {
        const fDate = new Date(f.flow_date + 'T00:00:00')
        if (horizonFilter === 'past') {
          if (fDate >= today) return false
        } else {
          if (fDate < today) return false
          const days = horizonFilter === '7d' ? 7 : horizonFilter === '30d' ? 30 : 90
          const cutoff = new Date(today.getTime() + days * 86400000)
          if (fDate > cutoff) return false
        }
      }

      return true
    }).sort((a, b) => a.flow_date.localeCompare(b.flow_date))
  }, [flows, typeFilter, currencyFilter, horizonFilter, confidenceFilter, today])

  // Net positions by currency for filtered view
  const netByCurrency = useMemo(() => {
    const map: Record<string, { inflow: number; outflow: number }> = {}
    filtered.forEach(f => {
      if (!map[f.currency]) map[f.currency] = { inflow: 0, outflow: 0 }
      if (f.amount >= 0) map[f.currency].inflow += f.amount
      else map[f.currency].outflow += Math.abs(f.amount)
    })
    return map
  }, [filtered])

  function handleSave(data: Omit<CashFlowEntry, 'id' | 'uploaded_at'>) {
    if (editEntry) {
      onUpdate(editEntry.id, data)
    } else {
      onAdd(data)
    }
    setShowModal(false)
    setEditEntry(null)
  }

  const pillBase: React.CSSProperties = {
    padding: '0.3125rem 0.75rem',
    borderRadius: 'var(--r-full)',
    fontSize: '0.8125rem',
    fontWeight: 500,
    cursor: 'pointer',
    border: '1px solid transparent',
    transition: 'all 0.15s',
  }

  function pillStyle(active: boolean): React.CSSProperties {
    return {
      ...pillBase,
      background: active ? 'var(--teal)' : 'var(--bg-input)',
      color: active ? '#fff' : 'var(--text-secondary)',
      borderColor: active ? 'var(--teal)' : 'var(--border)',
    }
  }

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
        {/* Flow type pills */}
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          {(['all', 'inflow', 'outflow'] as FlowTypeFilter[]).map(t => (
            <button key={t} style={pillStyle(typeFilter === t)} onClick={() => setTypeFilter(t)}>
              {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1) + 's'}
            </button>
          ))}
        </div>

        {/* Currency filter */}
        <div style={{ position: 'relative' }}>
          <select
            className="input"
            value={currencyFilter}
            onChange={e => setCurrencyFilter(e.target.value)}
            style={{ appearance: 'none', paddingRight: '1.75rem', fontSize: '0.8125rem', height: '2rem' }}
          >
            {currencies.map(c => (
              <option key={c} value={c}>{c === 'all' ? 'All Currencies' : c}</option>
            ))}
          </select>
          <ChevronDown size={12} style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
        </div>

        {/* Time horizon pills */}
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          {([
            { value: 'all', label: 'All' },
            { value: '7d', label: 'Next 7 Days' },
            { value: '30d', label: 'Next 30 Days' },
            { value: '90d', label: 'Next 90 Days' },
            { value: 'past', label: 'Past' },
          ] as { value: HorizonFilter; label: string }[]).map(h => (
            <button key={h.value} style={pillStyle(horizonFilter === h.value)} onClick={() => setHorizonFilter(h.value)}>
              {h.label}
            </button>
          ))}
        </div>

        {/* Confidence filter */}
        <div style={{ position: 'relative' }}>
          <select
            className="input"
            value={confidenceFilter}
            onChange={e => setConfidenceFilter(e.target.value as ConfidenceFilter)}
            style={{ appearance: 'none', paddingRight: '1.75rem', fontSize: '0.8125rem', height: '2rem' }}
          >
            <option value="all">All Confidence</option>
            <option value="confirmed">Confirmed</option>
            <option value="forecast">Forecast</option>
            <option value="indicative">Indicative</option>
          </select>
          <ChevronDown size={12} style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
          </span>
          <button
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            onClick={() => { setEditEntry(null); setShowModal(true) }}
          >
            <Plus size={14} /> Add Entry
          </button>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <Waves size={32} style={{ marginBottom: '0.75rem', opacity: 0.3 }} />
          <p style={{ fontSize: '0.9375rem', marginBottom: '0.375rem' }}>No cash flow entries found</p>
          <p style={{ fontSize: '0.8125rem' }}>Adjust filters or add entries manually / via CSV upload.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Date', 'Currency', 'Amount', 'Type', 'Category', 'Entity', 'Confidence', 'Description', 'Actions'].map(col => (
                  <th key={col} style={{ textAlign: col === 'Amount' ? 'right' : 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => (
                <tr key={f.id} style={{ borderBottom: '1px solid var(--border-subtle, var(--border))', transition: 'background 0.1s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-row-hover, rgba(255,255,255,0.02))'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
                  <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatDate(f.flow_date)}</td>
                  <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{f.currency}</td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <AmountDisplay amount={f.amount} currency={f.currency} />
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem' }}><FlowTypeBadge type={f.flow_type} /></td>
                  <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)' }}>{f.category || '—'}</td>
                  <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)' }}>{f.entity || '—'}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}><ConfidenceBadge confidence={f.confidence} /></td>
                  <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.description || '—'}</td>
                  <td style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>
                    {deleteConfirm === f.id ? (
                      <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Delete?</span>
                        <button
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red, #ef4444)', padding: '0.125rem' }}
                          onClick={() => { onDelete(f.id); setDeleteConfirm(null) }}
                        ><Check size={13} /></button>
                        <button
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.125rem' }}
                          onClick={() => setDeleteConfirm(null)}
                        ><X size={13} /></button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem', borderRadius: 'var(--r-sm)' }}
                          title="Edit"
                          onClick={() => { setEditEntry(f); setShowModal(true) }}
                        ><Pencil size={13} /></button>
                        <button
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem', borderRadius: 'var(--r-sm)' }}
                          title="Delete"
                          onClick={() => setDeleteConfirm(f.id)}
                        ><Trash2 size={13} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer: net positions by currency */}
      {filtered.length > 0 && (
        <div style={{ marginTop: '1rem', paddingTop: '0.875rem', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 500 }}>
            Net Position (filtered view)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.625rem' }}>
            {Object.entries(netByCurrency).map(([ccy, { inflow, outflow }]) => {
              const net = inflow - outflow
              return (
                <div key={ccy} style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                  padding: '0.375rem 0.75rem',
                  fontSize: '0.8125rem',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{ccy}</span>
                  <span style={{ margin: '0 0.375rem', color: 'var(--text-muted)' }}>net</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: net >= 0 ? 'var(--teal)' : 'var(--red, #ef4444)' }}>
                    {net >= 0 ? '+' : ''}{formatAmount(net, ccy)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {(showModal || editEntry) && (
        <FlowModal
          initial={editEntry}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditEntry(null) }}
        />
      )}
    </div>
  )
}

// ── Tab 2: Analysis ───────────────────────────────────────────

interface AnalysisTabProps {
  flows: CashFlowEntry[]
}

function AnalysisTab({ flows }: AnalysisTabProps) {
  const { coverage } = useHedgeCoverage()

  const today = useMemo(() => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    return date
  }, [])

  const futureFlows = useMemo(() =>
    flows.filter(f => new Date(f.flow_date + 'T00:00:00') >= today),
    [flows, today]
  )

  // ── Summary tiles ──────────────────────────────────────────
  const totalInflowUsd = useMemo(() =>
    futureFlows.filter(f => f.amount >= 0).reduce((s, f) => s + toUsd(f.amount, f.currency), 0),
    [futureFlows]
  )

  const totalOutflowUsd = useMemo(() =>
    futureFlows.filter(f => f.amount < 0).reduce((s, f) => s + Math.abs(toUsd(f.amount, f.currency)), 0),
    [futureFlows]
  )

  const netPositionUsd = totalInflowUsd - totalOutflowUsd

  const currencyCount = useMemo(() => {
    const set = new Set(flows.map(f => f.currency))
    return set.size
  }, [flows])

  // ── Time buckets ──────────────────────────────────────────
  const buckets = useMemo(() => {
    const week7 = new Date(today.getTime() + 7 * 86400000)
    const day30 = new Date(today.getTime() + 30 * 86400000)
    const day90 = new Date(today.getTime() + 90 * 86400000)

    function buildBucket(label: string, test: (d: Date) => boolean) {
      const entries = futureFlows.filter(f => test(new Date(f.flow_date + 'T00:00:00')))
      const inflowUsd = entries.filter(e => e.amount >= 0).reduce((s, e) => s + toUsd(e.amount, e.currency), 0)
      const outflowUsd = entries.filter(e => e.amount < 0).reduce((s, e) => s + Math.abs(toUsd(e.amount, e.currency)), 0)
      const netUsd = inflowUsd - outflowUsd
      const top3 = [...entries].sort((a, b) => Math.abs(toUsd(b.amount, b.currency)) - Math.abs(toUsd(a.amount, a.currency))).slice(0, 3)
      return { label, entries, inflowUsd, outflowUsd, netUsd, top3 }
    }

    return [
      buildBucket('This Week', d => d < week7),
      buildBucket('Next 30 Days', d => d >= week7 && d <= day30),
      buildBucket('30–90 Days', d => d > day30 && d <= day90),
      buildBucket('Beyond 90 Days', d => d > day90),
    ]
  }, [futureFlows, today])

  // ── Currency exposure ─────────────────────────────────────
  const currencyExposures = useMemo(() => {
    const map: Record<string, { inflow: number; outflow: number }> = {}
    futureFlows.forEach(f => {
      if (!map[f.currency]) map[f.currency] = { inflow: 0, outflow: 0 }
      if (f.amount >= 0) map[f.currency].inflow += f.amount
      else map[f.currency].outflow += Math.abs(f.amount)
    })

    return Object.entries(map).map(([ccy, { inflow, outflow }]) => {
      const net = inflow - outflow
      const inflowUsd = toUsd(inflow, ccy)
      const outflowUsd = toUsd(outflow, ccy)
      const netUsd = inflowUsd - outflowUsd
      const total = inflow + outflow
      const pct = total > 0 ? (inflow / total) * 100 : 50

      const hedgeCov = coverage.find(c => c.base_currency === ccy)
      const coveragePct = hedgeCov?.coverage_pct ?? null

      let coverageLabel = 'Exposed'
      let coverageBadge = 'badge-red'
      if (coveragePct !== null) {
        if (coveragePct >= 75) { coverageLabel = 'Covered'; coverageBadge = 'badge-teal' }
        else if (coveragePct >= 30) { coverageLabel = 'Partial'; coverageBadge = 'badge-amber' }
      }

      return { ccy, net, netUsd, inflowUsd, outflowUsd, pct, coveragePct, coverageLabel, coverageBadge }
    }).sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd))
  }, [futureFlows, coverage])

  // ── Category breakdown ────────────────────────────────────
  const categoryBreakdown = useMemo(() => {
    const map: Record<string, { inflow: number; outflow: number }> = {}
    futureFlows.forEach(f => {
      const cat = f.category || 'Uncategorised'
      if (!map[cat]) map[cat] = { inflow: 0, outflow: 0 }
      if (f.amount >= 0) map[cat].inflow += toUsd(f.amount, f.currency)
      else map[cat].outflow += Math.abs(toUsd(f.amount, f.currency))
    })

    const totalAbsNet = Object.values(map).reduce((s, { inflow, outflow }) => s + Math.abs(inflow - outflow), 0)

    return Object.entries(map).map(([cat, { inflow, outflow }]) => {
      const net = inflow - outflow
      const pct = totalAbsNet > 0 ? (Math.abs(net) / totalAbsNet) * 100 : 0
      return { cat, inflow, outflow, net, pct }
    }).sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
  }, [futureFlows])

  const tileStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-lg)',
    padding: '1.25rem',
    flex: 1,
    minWidth: 0,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Summary tiles */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={tileStyle}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.375rem', fontWeight: 500 }}>Net Cash Position</div>
          <div style={{ fontSize: '1.375rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: netPositionUsd >= 0 ? 'var(--teal)' : 'var(--red, #ef4444)' }}>
            {netPositionUsd >= 0 ? '+' : ''}{formatUsd(netPositionUsd)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>USD equiv · future flows</div>
        </div>
        <div style={tileStyle}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.375rem', fontWeight: 500 }}>Total Inflows</div>
          <div style={{ fontSize: '1.375rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--teal)' }}>
            +{formatUsd(totalInflowUsd)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>USD equiv · future flows</div>
        </div>
        <div style={tileStyle}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.375rem', fontWeight: 500 }}>Total Outflows</div>
          <div style={{ fontSize: '1.375rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--red, #ef4444)' }}>
            {formatUsd(totalOutflowUsd)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>USD equiv · future flows</div>
        </div>
        <div style={tileStyle}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.375rem', fontWeight: 500 }}>Currencies Tracked</div>
          <div style={{ fontSize: '1.375rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {currencyCount}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>across all entries</div>
        </div>
      </div>

      {/* Cash Flow Timeline */}
      <div>
        <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.875rem' }}>
          Cash Flow Timeline
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {buckets.map(bucket => (
            <div key={bucket.label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{bucket.label}</span>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--teal)', fontFamily: 'var(--font-mono)' }}>
                    ↑ {formatUsd(bucket.inflowUsd)}
                  </span>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--red, #ef4444)', fontFamily: 'var(--font-mono)' }}>
                    ↓ {formatUsd(bucket.outflowUsd)}
                  </span>
                  <span style={{ fontSize: '0.9375rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: bucket.netUsd >= 0 ? 'var(--teal)' : 'var(--red, #ef4444)' }}>
                    Net: {bucket.netUsd >= 0 ? '+' : ''}{formatUsd(bucket.netUsd)}
                  </span>
                </div>
              </div>
              {bucket.top3.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  {bucket.top3.map(entry => (
                    <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8125rem', padding: '0.375rem 0.625rem', background: 'var(--bg-input)', borderRadius: 'var(--r-md)', flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDate(entry.flow_date)}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{entry.currency}</span>
                      <AmountDisplay amount={entry.amount} currency={entry.currency} />
                      {entry.category && <span className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>{entry.category}</span>}
                      {entry.counterparty && <span style={{ color: 'var(--text-muted)' }}>{entry.counterparty}</span>}
                    </div>
                  ))}
                  {bucket.entries.length > 3 && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', paddingLeft: '0.625rem' }}>
                      +{bucket.entries.length - 3} more entries
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No entries in this period</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Currency Exposure */}
      {currencyExposures.length > 0 && (
        <div>
          <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.875rem' }}>
            Currency Exposure
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {currencyExposures.map(({ ccy, net, netUsd, inflowUsd, outflowUsd, pct, coveragePct, coverageLabel, coverageBadge }) => (
              <div key={ccy} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '0.875rem 1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.625rem' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', minWidth: 40 }}>{ccy}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: net >= 0 ? 'var(--teal)' : 'var(--red, #ef4444)', fontSize: '0.9375rem' }}>
                    {net >= 0 ? '+' : ''}{formatAmount(net, ccy)}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>{formatUsd(netUsd)} USD equiv</span>
                  <span className={`badge ${net >= 0 ? 'badge-teal' : 'badge-red'}`} style={{ fontSize: '0.6875rem' }}>
                    {net >= 0 ? 'Net Inflow' : 'Net Outflow'}
                  </span>
                  <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                    Hedge coverage:
                    {coveragePct !== null ? (
                      <>
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>{coveragePct.toFixed(0)}%</span>
                        <span className={`badge ${coverageBadge}`} style={{ fontSize: '0.6875rem' }}>{coverageLabel}</span>
                      </>
                    ) : (
                      <span className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>No hedge data</span>
                    )}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.375rem' }}>
                  <span>↑ {formatUsd(inflowUsd)}</span>
                  <span>·</span>
                  <span>↓ {formatUsd(outflowUsd)}</span>
                </div>
                {/* Proportional bar */}
                <div style={{ height: 6, background: 'var(--bg-input)', borderRadius: 999, overflow: 'hidden', position: 'relative' }}>
                  <div style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: 'var(--teal)',
                    borderRadius: 999,
                    transition: 'width 0.4s ease',
                  }} />
                  {pct < 100 && (
                    <div style={{
                      position: 'absolute', top: 0, left: `${pct}%`, right: 0, height: '100%',
                      background: 'var(--red, #ef4444)',
                      borderRadius: '0 999px 999px 0',
                    }} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category Breakdown */}
      {categoryBreakdown.length > 0 && (
        <div>
          <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.875rem' }}>
            Category Breakdown
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Category', 'Inflows (USD)', 'Outflows (USD)', 'Net (USD)', '% of Total'].map((col, i) => (
                    <th key={col} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categoryBreakdown.map(({ cat, inflow, outflow, net, pct }) => (
                  <tr key={cat} style={{ borderBottom: '1px solid var(--border-subtle, var(--border))' }}>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-primary)', fontWeight: 500 }}>{cat}</td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--teal)' }}>+{formatUsd(inflow)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--red, #ef4444)' }}>{formatUsd(outflow)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: net >= 0 ? 'var(--teal)' : 'var(--red, #ef4444)' }}>
                      {net >= 0 ? '+' : ''}{formatUsd(net)}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: 'var(--text-secondary)' }}>{pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {futureFlows.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <Waves size={32} style={{ marginBottom: '0.75rem', opacity: 0.3 }} />
          <p style={{ fontSize: '0.9375rem', marginBottom: '0.375rem' }}>No future cash flows to analyse</p>
          <p style={{ fontSize: '0.8125rem' }}>Upload or add entries with future dates to see analysis.</p>
        </div>
      )}
    </div>
  )
}

// ── Tab 3: Upload ─────────────────────────────────────────────

interface UploadTabProps {
  addFlows: (rows: Omit<CashFlowEntry, 'id' | 'uploaded_at'>[]) => Promise<void>
  onSwitchToFlows: () => void
}

function UploadTab({ addFlows, onSwitchToFlows }: UploadTabProps) {
  return (
    <UploadWizard
      label="Cash Flow Projections"
      icon={Waves}
      color="#0ea5e9"
      parse={parseCashFlowCsv}
      columns={[
        { key: 'flow_date',    label: 'Date' },
        { key: 'currency',    label: 'Currency' },
        { key: 'amount',      label: 'Amount', format: (v) => v?.toLocaleString() ?? '—' },
        { key: 'flow_type',   label: 'Type' },
        { key: 'category',    label: 'Category' },
        { key: 'entity',      label: 'Entity' },
        { key: 'confidence',  label: 'Confidence' },
      ]}
      onImport={async (rows, entityId) => {
        try {
          const enriched = rows.map(r => ({ ...r, entity_id: entityId ?? undefined }))
          await addFlows(enriched)
          onSwitchToFlows()
          return { error: null }
        } catch (err: any) {
          return { error: err?.message ?? 'Import failed' }
        }
      }}
      downloadTemplate={downloadCashFlowTemplate}
      onDone={onSwitchToFlows}
    />
  )
}

// ── Main Page ─────────────────────────────────────────────────

export function CashFlowPage() {
  const { flows, addFlow, addFlows, updateFlow, deleteFlow } = useCashFlows()
  const [activeTab, setActiveTab] = useState<'flows' | 'analysis' | 'upload'>('flows')

  const tabs = [
    { key: 'flows',    label: 'Cash Flows' },
    { key: 'analysis', label: 'Analysis' },
    { key: 'upload',   label: 'Upload' },
  ] as const

  function tabStyle(active: boolean): React.CSSProperties {
    return {
      padding: '0.5rem 1rem',
      fontSize: '0.875rem',
      fontWeight: active ? 600 : 400,
      color: active ? 'var(--text-primary)' : 'var(--text-muted)',
      background: 'none',
      border: 'none',
      borderBottom: active ? '2px solid var(--teal)' : '2px solid transparent',
      cursor: 'pointer',
      transition: 'all 0.15s',
      whiteSpace: 'nowrap',
    }
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div style={{ width: 36, height: 36, background: 'rgba(0,200,160,0.12)', borderRadius: 'var(--r-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Waves size={18} color="var(--teal)" />
        </div>
        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Treasury Cash Flow Projections
          </h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: 0 }}>
            Track, analyse, and forecast your organisation's cash flows across currencies and entities.
          </p>
        </div>
      </div>

      {/* Card with tabs */}
      <div className="card" style={{ padding: 0 }}>
        {/* Tab bar */}
        <div style={{ borderBottom: '1px solid var(--border)', padding: '0 1.25rem', display: 'flex', gap: '0.125rem', overflowX: 'auto' }}>
          {tabs.map(t => (
            <button key={t.key} style={tabStyle(activeTab === t.key)} onClick={() => setActiveTab(t.key)}>
              {t.label}
              {t.key === 'flows' && flows.length > 0 && (
                <span style={{
                  marginLeft: '0.375rem',
                  background: 'var(--bg-input)',
                  color: 'var(--text-muted)',
                  borderRadius: 'var(--r-full)',
                  padding: '0.0625rem 0.4375rem',
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                }}>
                  {flows.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ padding: '1.25rem' }}>
          {activeTab === 'flows' && (
            <CashFlowsTab
              flows={flows}
              onAdd={data => addFlow(data)}
              onUpdate={updateFlow}
              onDelete={deleteFlow}
            />
          )}
          {activeTab === 'analysis' && (
            <AnalysisTab flows={flows} />
          )}
          {activeTab === 'upload' && (
            <UploadTab
              addFlows={addFlows}
              onSwitchToFlows={() => setActiveTab('flows')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
