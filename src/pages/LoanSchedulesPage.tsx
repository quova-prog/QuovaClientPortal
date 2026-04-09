import { useState, useRef, useMemo, useCallback } from 'react'
import {
  Upload, Download, Plus, Pencil, Trash2, X, Check,
  AlertCircle, CheckCircle, Banknote,
} from 'lucide-react'
import { useLoanSchedules } from '@/hooks/useLoanSchedules'
import type { LoanSchedule } from '@/hooks/useLoanSchedules'
import { parseLoanScheduleCsv, downloadLoanScheduleTemplate } from '@/lib/loanScheduleParser'
import { useAuth } from '@/hooks/useAuth'
import { checkFileAlreadyUploaded, recordUploadBatch, formatUploadDate } from '@/lib/uploadDedup'

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

function isOverdue(dateStr: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(dateStr + 'T00:00:00') < today
}

function isDueSoon(dateStr: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const in30 = new Date(today.getTime() + 30 * 86400000)
  const d = new Date(dateStr + 'T00:00:00')
  return d >= today && d <= in30
}

// ── Status badge ──────────────────────────────────────────────

function LoanTypeBadge({ type }: { type: LoanSchedule['loan_type'] }) {
  const styleMap: Record<LoanSchedule['loan_type'], string> = {
    term:     'badge-blue',
    revolver: 'badge-teal',
    bond:     'badge-amber',
    other:    'badge-gray',
  }
  return (
    <span className={`badge ${styleMap[type]}`} style={{ fontSize: '0.6875rem', textTransform: 'capitalize' }}>
      {type}
    </span>
  )
}

function PaymentTypeBadge({ type }: { type: LoanSchedule['payment_type'] }) {
  const styleMap: Record<LoanSchedule['payment_type'], string> = {
    principal: 'badge-blue',
    interest:  'badge-amber',
    both:      'badge-teal',
  }
  return (
    <span className={`badge ${styleMap[type]}`} style={{ fontSize: '0.6875rem', textTransform: 'capitalize' }}>
      {type}
    </span>
  )
}

// ── Loan Modal ────────────────────────────────────────────────

interface LoanModalProps {
  initial?: LoanSchedule | null
  onSave: (data: Omit<LoanSchedule, 'id' | 'uploaded_at'>) => void
  onClose: () => void
}

function LoanModal({ initial, onSave, onClose }: LoanModalProps) {
  const [loanId, setLoanId]               = useState(initial?.loan_id ?? '')
  const [lender, setLender]               = useState(initial?.lender ?? '')
  const [currency, setCurrency]           = useState(initial?.currency ?? '')
  const [principal, setPrincipal]         = useState(initial?.principal?.toString() ?? '')
  const [outstanding, setOutstanding]     = useState(initial?.outstanding_balance?.toString() ?? '')
  const [interestRate, setInterestRate]   = useState(initial?.interest_rate?.toString() ?? '')
  const [paymentDate, setPaymentDate]     = useState(initial?.payment_date ?? '')
  const [maturityDate, setMaturityDate]   = useState(initial?.maturity_date ?? '')
  const [paymentType, setPaymentType]     = useState<LoanSchedule['payment_type']>(initial?.payment_type ?? 'both')
  const [paymentAmount, setPaymentAmount] = useState(initial?.payment_amount?.toString() ?? '')
  const [loanType, setLoanType]           = useState<LoanSchedule['loan_type']>(initial?.loan_type ?? 'term')
  const [description, setDesc]            = useState(initial?.description ?? '')
  const [formError, setFormError]         = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')

    const lid = loanId.trim()
    if (!lid) { setFormError('Loan ID is required'); return }
    const len = lender.trim()
    if (!len) { setFormError('Lender is required'); return }
    const cur = currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(cur)) { setFormError('Currency must be a 3-letter ISO code'); return }
    const bal = parseFloat(outstanding.replace(/,/g, ''))
    if (isNaN(bal) || bal < 0) { setFormError('Outstanding balance must be a non-negative number'); return }
    if (!paymentDate) { setFormError('Payment date is required'); return }
    if (!maturityDate) { setFormError('Maturity date is required'); return }

    const principalNum = parseFloat(principal.replace(/,/g, '')) || 0
    const rateNum      = parseFloat(interestRate.replace(/,/g, '')) || 0
    const amtNum       = parseFloat(paymentAmount.replace(/,/g, '')) || 0

    onSave({
      loan_id: lid,
      lender: len,
      currency: cur,
      principal: principalNum,
      outstanding_balance: bal,
      interest_rate: rateNum,
      payment_date: paymentDate,
      maturity_date: maturityDate,
      payment_type: paymentType,
      payment_amount: amtNum,
      loan_type: loanType,
      description: description.trim(),
    })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: '1rem',
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 600, background: 'var(--bg-card)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            {initial ? 'Edit Loan Schedule' : 'Add Loan Schedule'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Loan ID *</label>
              <input className="input" placeholder="LOAN-001" value={loanId} onChange={e => setLoanId(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} />
            </div>
            <div>
              <label className="label">Lender *</label>
              <input className="input" placeholder="First National Bank" value={lender} onChange={e => setLender(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Currency *</label>
              <input className="input" placeholder="USD" value={currency} onChange={e => setCurrency(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }} maxLength={3} />
            </div>
            <div>
              <label className="label">Loan Type</label>
              <select className="input" value={loanType} onChange={e => setLoanType(e.target.value as LoanSchedule['loan_type'])}
                style={{ width: '100%', boxSizing: 'border-box', height: 36 }}>
                <option value="term">Term</option>
                <option value="revolver">Revolver</option>
                <option value="bond">Bond</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="label">Payment Type</label>
              <select className="input" value={paymentType} onChange={e => setPaymentType(e.target.value as LoanSchedule['payment_type'])}
                style={{ width: '100%', boxSizing: 'border-box', height: 36 }}>
                <option value="principal">Principal</option>
                <option value="interest">Interest</option>
                <option value="both">Both</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Principal Amount</label>
              <input className="input" type="number" placeholder="5000000" value={principal} onChange={e => setPrincipal(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} min={0} />
            </div>
            <div>
              <label className="label">Outstanding Balance *</label>
              <input className="input" type="number" placeholder="4200000" value={outstanding} onChange={e => setOutstanding(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} min={0} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Interest Rate (%)</label>
              <input className="input" type="number" placeholder="4.5" value={interestRate} onChange={e => setInterestRate(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} step={0.01} min={0} />
            </div>
            <div>
              <label className="label">Payment Amount</label>
              <input className="input" type="number" placeholder="125000" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} min={0} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Next Payment Date *</label>
              <input className="input" type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} />
            </div>
            <div>
              <label className="label">Maturity Date *</label>
              <input className="input" type="date" value={maturityDate} onChange={e => setMaturityDate(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} />
            </div>
          </div>

          <div>
            <label className="label">Description</label>
            <input className="input" placeholder="Optional notes" value={description} onChange={e => setDesc(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>

          {formError && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--red)', fontSize: '0.8125rem' }}>
              <AlertCircle size={14} /> {formError}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm">
              {initial ? 'Save Changes' : 'Add Loan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Loans Tab ─────────────────────────────────────────────────

type LoanTypeFilter = 'All' | LoanSchedule['loan_type']
type PaymentTypeFilter = 'All' | LoanSchedule['payment_type']

interface LoansTabProps {
  loans: LoanSchedule[]
  onAdd: (data: Omit<LoanSchedule, 'id' | 'uploaded_at'>) => void
  onUpdate: (id: string, updates: Partial<LoanSchedule>) => void
  onDelete: (id: string) => void
  onSwitchToUpload: () => void
}

function LoansTab({ loans, onAdd, onUpdate, onDelete, onSwitchToUpload }: LoansTabProps) {
  const [loanTypeFilter, setLoanTypeFilter]       = useState<LoanTypeFilter>('All')
  const [currencyFilter, setCurrencyFilter]       = useState('All')
  const [paymentTypeFilter, setPaymentTypeFilter] = useState<PaymentTypeFilter>('All')
  const [showModal, setShowModal]                 = useState(false)
  const [editingLoan, setEditingLoan]             = useState<LoanSchedule | null>(null)
  const [deletingId, setDeletingId]               = useState<string | null>(null)

  const currencies = useMemo(() => {
    const distinct = Array.from(new Set(loans.map(l => l.currency))).sort()
    return ['All', ...distinct]
  }, [loans])

  const filtered = useMemo(() => {
    return loans.filter(l => {
      if (loanTypeFilter !== 'All' && l.loan_type !== loanTypeFilter) return false
      if (currencyFilter !== 'All' && l.currency !== currencyFilter) return false
      if (paymentTypeFilter !== 'All' && l.payment_type !== paymentTypeFilter) return false
      return true
    })
  }, [loans, loanTypeFilter, currencyFilter, paymentTypeFilter])

  const footerTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of filtered) {
      map.set(l.currency, (map.get(l.currency) ?? 0) + l.outstanding_balance)
    }
    return Array.from(map.entries()).sort((a, b) => toUsd(b[1], b[0]) - toUsd(a[1], a[0]))
  }, [filtered])

  function handleSave(data: Omit<LoanSchedule, 'id' | 'uploaded_at'>) {
    if (editingLoan) {
      onUpdate(editingLoan.id, data)
    } else {
      onAdd(data)
    }
    setShowModal(false)
    setEditingLoan(null)
  }

  function handleEdit(l: LoanSchedule) {
    setEditingLoan(l)
    setShowModal(true)
  }

  function handleAddNew() {
    setEditingLoan(null)
    setShowModal(true)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="pill-tabs" style={{ flexShrink: 0 }}>
          {(['All', 'term', 'revolver', 'bond', 'other'] as LoanTypeFilter[]).map(t => (
            <button key={t} className={`pill-tab${loanTypeFilter === t ? ' active' : ''}`}
              onClick={() => setLoanTypeFilter(t)}
              style={{ textTransform: t === 'All' ? undefined : 'capitalize' }}>
              {t}
            </button>
          ))}
        </div>

        <select className="input" value={currencyFilter} onChange={e => setCurrencyFilter(e.target.value)}
          style={{ height: 32, padding: '0 0.625rem', fontSize: '0.8125rem', minWidth: 120 }}>
          {currencies.map(c => <option key={c} value={c}>{c === 'All' ? 'All Currencies' : c}</option>)}
        </select>

        <div className="pill-tabs" style={{ flexShrink: 0 }}>
          {(['All', 'principal', 'interest', 'both'] as PaymentTypeFilter[]).map(t => (
            <button key={t} className={`pill-tab${paymentTypeFilter === t ? ' active' : ''}`}
              onClick={() => setPaymentTypeFilter(t)}
              style={{ textTransform: t === 'All' ? undefined : 'capitalize' }}>
              {t}
            </button>
          ))}
        </div>

        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
          {filtered.length} record{filtered.length !== 1 ? 's' : ''}
        </span>

        <button className="btn btn-ghost btn-sm" onClick={onSwitchToUpload} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Upload size={13} /> Import CSV
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleAddNew} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Plus size={13} /> Add Loan
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <Banknote size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>No loan schedules found</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Import a CSV file or add loans manually to get started.
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
                  {['Loan ID', 'Lender', 'Currency', 'Outstanding Balance', 'Payment Amount', 'Payment Date', 'Maturity Date', 'Type', 'Actions'].map(h => (
                    <th key={h} style={{
                      textAlign: h === 'Outstanding Balance' || h === 'Payment Amount' ? 'right' : h === 'Actions' ? 'center' : 'left',
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
                {filtered.map(l => {
                  const isDeleting = deletingId === l.id
                  const overdue    = isOverdue(l.payment_date)
                  const dueSoon    = !overdue && isDueSoon(l.payment_date)
                  return (
                    <tr key={l.id} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                      <td style={{ padding: '0.625rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {l.loan_id}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                        {l.lender}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                        <span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700 }}>
                          {l.currency}
                        </span>
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                        {formatAmount(l.outstanding_balance, l.currency)}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {l.payment_amount > 0 ? formatAmount(l.payment_amount, l.currency) : '—'}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap', fontSize: '0.8125rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                          <span style={{ color: overdue ? 'var(--red)' : 'var(--text-secondary)', fontWeight: overdue ? 600 : 400 }}>
                            {formatDate(l.payment_date)}
                          </span>
                          {overdue && <span className="badge badge-red" style={{ fontSize: '0.6rem' }}>Overdue</span>}
                          {dueSoon && <span className="badge badge-amber" style={{ fontSize: '0.6rem' }}>Due Soon</span>}
                        </div>
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                        {formatDate(l.maturity_date)}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                        <LoanTypeBadge type={l.loan_type} />
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {isDeleting ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', justifyContent: 'center' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Confirm?</span>
                            <button className="btn btn-sm" style={{ background: 'var(--red)', color: '#fff', border: 'none', padding: '0.2rem 0.5rem' }}
                              onClick={() => { onDelete(l.id); setDeletingId(null) }}>
                              <Check size={11} />
                            </button>
                            <button className="btn btn-ghost btn-sm" style={{ padding: '0.2rem 0.5rem' }}
                              onClick={() => setDeletingId(null)}>
                              <X size={11} />
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', justifyContent: 'center' }}>
                            <button className="btn btn-ghost btn-sm" style={{ padding: '0.25rem' }} title="Edit" onClick={() => handleEdit(l)}>
                              <Pencil size={13} />
                            </button>
                            <button className="btn btn-ghost btn-sm" style={{ padding: '0.25rem', color: 'var(--red)' }} title="Delete" onClick={() => setDeletingId(l.id)}>
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

          {footerTotals.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginTop: '0.875rem', padding: '0.75rem 1rem', background: 'var(--bg-app)', borderRadius: 'var(--r-md)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Total outstanding:</span>
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
        <LoanModal
          initial={editingLoan}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingLoan(null) }}
        />
      )}
    </div>
  )
}

// ── Analysis Tab ──────────────────────────────────────────────

interface AnalysisTabProps {
  loans: LoanSchedule[]
}

function AnalysisTab({ loans }: AnalysisTabProps) {
  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  }, [])

  const in30 = useMemo(() => new Date(today.getTime() + 30 * 86400000), [today])
  const in90 = useMemo(() => new Date(today.getTime() + 90 * 86400000), [today])

  const totalDebtUsd = useMemo(() =>
    loans.reduce((s, l) => s + toUsd(l.outstanding_balance, l.currency), 0),
    [loans]
  )

  const upcoming30Usd = useMemo(() =>
    loans
      .filter(l => {
        const d = new Date(l.payment_date + 'T00:00:00')
        return d >= today && d <= in30
      })
      .reduce((s, l) => s + toUsd(l.payment_amount, l.currency), 0),
    [loans, today, in30]
  )

  const weightedAvgRate = useMemo(() => {
    const totalBal = loans.reduce((s, l) => s + l.outstanding_balance, 0)
    if (totalBal === 0) return 0
    const weighted = loans.reduce((s, l) => s + l.interest_rate * l.outstanding_balance, 0)
    return weighted / totalBal
  }, [loans])

  const facilityCount = useMemo(() =>
    new Set(loans.map(l => l.loan_id)).size,
    [loans]
  )

  // Payment timeline buckets
  const thisMonthEnd = useMemo(() => {
    const d = new Date(today)
    d.setMonth(d.getMonth() + 1)
    d.setDate(0)
    d.setHours(23, 59, 59)
    return d
  }, [today])

  const timeBuckets = useMemo(() => {
    const thisMonth: LoanSchedule[] = []
    const next30: LoanSchedule[]    = []
    const nextQtr: LoanSchedule[]   = []
    const beyond: LoanSchedule[]    = []
    const in90d = in90

    for (const l of loans) {
      const d = new Date(l.payment_date + 'T00:00:00')
      if (d <= thisMonthEnd)       thisMonth.push(l)
      else if (d <= in30)          next30.push(l)
      else if (d <= in90d)         nextQtr.push(l)
      else                         beyond.push(l)
    }

    return [
      { label: 'This Month',    items: thisMonth, color: 'var(--teal)' },
      { label: 'Next 30 Days',  items: next30,    color: '#3b82f6' },
      { label: 'Next Quarter',  items: nextQtr,   color: '#f59e0b' },
      { label: 'Beyond',        items: beyond,    color: 'var(--text-muted)' },
    ]
  }, [loans, thisMonthEnd, in30, in90])

  // Debt by currency
  const currencyBreakdown = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of loans) {
      map.set(l.currency, (map.get(l.currency) ?? 0) + l.outstanding_balance)
    }
    const entries = Array.from(map.entries()).map(([ccy, amt]) => ({ ccy, amt, usd: toUsd(amt, ccy) }))
    entries.sort((a, b) => b.usd - a.usd)
    return entries
  }, [loans])

  const maxCurrencyUsd = currencyBreakdown[0]?.usd ?? 1

  // Maturity profile by year
  const maturityProfile = useMemo(() => {
    const map = new Map<string, { balance: number; count: number }>()
    for (const l of loans) {
      const year = l.maturity_date.slice(0, 4)
      const cur = map.get(year) ?? { balance: 0, count: 0 }
      cur.balance += toUsd(l.outstanding_balance, l.currency)
      cur.count++
      map.set(year, cur)
    }
    return Array.from(map.entries())
      .map(([year, v]) => ({ year, ...v }))
      .sort((a, b) => a.year.localeCompare(b.year))
  }, [loans])

  const maxMaturityBalance = maturityProfile[0]?.balance ?? 1
  const sortedMaturity = [...maturityProfile].sort((a, b) => b.balance - a.balance)

  if (loans.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: '2rem' }}>
        <Banknote size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>No loan schedules</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Add or import loan schedules to see debt analysis.</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        {[
          { label: 'Total Debt', value: formatUsd(totalDebtUsd), sub: 'USD equivalent', color: 'var(--teal)' },
          { label: 'Upcoming Payments (30d)', value: formatUsd(upcoming30Usd), sub: 'next 30 days', color: upcoming30Usd > 0 ? '#f59e0b' : 'var(--text-muted)' },
          { label: 'Avg Interest Rate', value: `${weightedAvgRate.toFixed(2)}%`, sub: 'weighted by balance', color: 'var(--teal)' },
          { label: 'Facilities', value: facilityCount.toString(), sub: 'distinct loan IDs', color: 'var(--teal)' },
        ].map(tile => (
          <div key={tile.label} className="card" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.375rem', fontWeight: 500 }}>{tile.label}</div>
            <div style={{ fontSize: '1.375rem', fontWeight: 700, color: tile.color, fontFamily: 'var(--font-mono)', lineHeight: 1.2 }}>{tile.value}</div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{tile.sub}</div>
          </div>
        ))}
      </div>

      {/* Payment Timeline */}
      <div className="card">
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Payment Timeline
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          {timeBuckets.map(bucket => {
            const totalUsd = bucket.items.reduce((s, l) => s + toUsd(l.payment_amount, l.currency), 0)
            const byType = {
              principal: bucket.items.filter(l => l.payment_type === 'principal'),
              interest:  bucket.items.filter(l => l.payment_type === 'interest'),
              both:      bucket.items.filter(l => l.payment_type === 'both'),
            }
            return (
              <div key={bucket.label} style={{ background: 'var(--bg-app)', borderRadius: 'var(--r-md)', padding: '0.875rem', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: bucket.color }}>{bucket.label}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {bucket.items.length} payment{bucket.items.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: bucket.items.length > 0 ? bucket.color : 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  {formatUsd(totalUsd)}
                </div>
                {bucket.items.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    {byType.principal.length > 0 && <div style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>Principal: {byType.principal.length}</div>}
                    {byType.interest.length > 0  && <div style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>Interest: {byType.interest.length}</div>}
                    {byType.both.length > 0      && <div style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>Both: {byType.both.length}</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Debt by Currency */}
      {currencyBreakdown.length > 0 && (
        <div className="card">
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
            Debt by Currency
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            {currencyBreakdown.map(({ ccy, amt, usd }) => {
              const barWidth = maxCurrencyUsd > 0 ? (usd / maxCurrencyUsd) * 100 : 0
              const pct = totalDebtUsd > 0 ? (usd / totalDebtUsd * 100).toFixed(1) : '0.0'
              return (
                <div key={ccy}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.375rem', flexWrap: 'wrap' }}>
                    <span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700, minWidth: 44, textAlign: 'center' }}>
                      {ccy}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {formatAmount(amt, ccy)}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>≈ {formatUsd(usd)}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{pct}% of total</span>
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

      {/* Maturity Profile */}
      {maturityProfile.length > 0 && (
        <div className="card">
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
            Maturity Profile
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            {sortedMaturity.map(({ year, balance, count }) => {
              const barWidth = sortedMaturity[0].balance > 0 ? (balance / sortedMaturity[0].balance) * 100 : 0
              return (
                <div key={year}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.375rem' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', minWidth: 50 }}>{year}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{formatUsd(balance)}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{count} facilit{count !== 1 ? 'ies' : 'y'}</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--border)', borderRadius: 999 }}>
                    <div style={{ height: '100%', width: `${barWidth}%`, background: '#f59e0b', borderRadius: 999, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Upload Tab ────────────────────────────────────────────────

interface UploadTabProps {
  onImported: () => void
  addLoans: (rows: Omit<LoanSchedule, 'id' | 'uploaded_at'>[]) => Promise<void>
}

function UploadTab({ onImported, addLoans }: UploadTabProps) {
  const { user, db } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging]       = useState(false)
  const [parsing, setParsing]         = useState(false)
  const [parseResult, setParseResult] = useState<{
    data: Omit<LoanSchedule, 'id' | 'uploaded_at'>[]
    errors: string[]
    fileName: string
  } | null>(null)
  const [importing, setImporting]       = useState(false)
  const [importSuccess, setImportSuccess] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [importError, setImportError]   = useState<string | null>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      setParseResult({ data: [], errors: ['Only CSV files are supported.'], fileName: file.name })
      return
    }
    setParsing(true)
    setParseResult(null)
    setImportSuccess(false)
    setImportError(null)
    setSelectedFile(file)
    const result = await parseLoanScheduleCsv(file)
    setParseResult({ ...result, fileName: file.name })
    setParsing(false)
  }, [])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  async function handleImport() {
    if (!parseResult || parseResult.data.length === 0) return
    setImportError(null)
    const orgId = user?.profile?.org_id
    if (orgId && selectedFile) {
      const dupeCheck = await checkFileAlreadyUploaded(db, orgId, selectedFile, 'loan_schedules')
      if (dupeCheck.isDuplicate) {
        setImportError(`This file was already uploaded on ${formatUploadDate(dupeCheck.uploadedAt!)}. To re-upload, first clear the existing data.`)
        return
      }
    }
    setImporting(true)
    try {
      await addLoans(parseResult.data)
      if (orgId && selectedFile) {
        await recordUploadBatch(db, orgId, user?.id, selectedFile, 'loan_schedules', parseResult.data.length)
      }
      setImporting(false)
      setImportSuccess(true)
      setTimeout(() => onImported(), 800)
    } catch (err: any) {
      setImporting(false)
      const msg: string = err?.message ?? ''
      if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique')) {
        setImportError(`Some records were skipped — they already exist in the database. ${parseResult.data.length} records were submitted.`)
        setImportSuccess(true)
        setTimeout(() => onImported(), 800)
      } else {
        setImportError(`Import failed: ${msg}`)
      }
    }
  }

  function handleClear() {
    setParseResult(null)
    setImportSuccess(false)
    setSelectedFile(null)
    setImportError(null)
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? 'var(--teal)' : 'var(--border)'}`,
          borderRadius: 'var(--r-lg)',
          padding: '2.5rem 1.5rem',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragging ? 'rgba(0,200,160,0.04)' : 'var(--bg-app)',
          transition: 'all 0.15s',
          marginBottom: '1.5rem',
        }}
      >
        <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleInputChange} />
        {parsing ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
            <div className="spinner" style={{ width: 28, height: 28 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Parsing CSV…</span>
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
                {parseResult.data.length} row{parseResult.data.length !== 1 ? 's' : ''} parsed
                {parseResult.errors.length > 0 && `, ${parseResult.errors.length} error${parseResult.errors.length !== 1 ? 's' : ''}`}
              </span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={handleClear} style={{ padding: '0.25rem' }}>
              <X size={14} />
            </button>
          </div>

          {parseResult.errors.length > 0 && (
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--r-md)', padding: '0.75rem', marginBottom: '0.875rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: 'var(--red)', fontWeight: 600, fontSize: '0.8125rem' }}>
                <AlertCircle size={14} />
                {parseResult.errors.length} parsing error{parseResult.errors.length !== 1 ? 's' : ''}
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {parseResult.errors.slice(0, 10).map((e, i) => (
                  <li key={i} style={{ fontSize: '0.75rem', color: 'var(--red)' }}>{e}</li>
                ))}
                {parseResult.errors.length > 10 && (
                  <li style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>…and {parseResult.errors.length - 10} more</li>
                )}
              </ul>
            </div>
          )}

          {parseResult.data.length > 0 && (
            <>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 500 }}>
                Preview (first {Math.min(parseResult.data.length, 10)} of {parseResult.data.length} rows)
              </div>
              <div className="data-table" style={{ marginBottom: '1rem', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                  <thead>
                    <tr>
                      {['Loan ID', 'Lender', 'Currency', 'Outstanding', 'Payment Date', 'Maturity', 'Type'].map(h => (
                        <th key={h} style={{ padding: '0.5rem 0.625rem', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.75rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parseResult.data.slice(0, 10).map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                        <td style={{ padding: '0.5rem 0.625rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{row.loan_id}</td>
                        <td style={{ padding: '0.5rem 0.625rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{row.lender}</td>
                        <td style={{ padding: '0.5rem 0.625rem' }}>
                          <span className="badge badge-blue" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', fontWeight: 700 }}>{row.currency}</span>
                        </td>
                        <td style={{ padding: '0.5rem 0.625rem', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                          {formatAmount(row.outstanding_balance, row.currency)}
                        </td>
                        <td style={{ padding: '0.5rem 0.625rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{row.payment_date}</td>
                        <td style={{ padding: '0.5rem 0.625rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{row.maturity_date}</td>
                        <td style={{ padding: '0.5rem 0.625rem' }}><LoanTypeBadge type={row.loan_type} /></td>
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
                <button className="btn btn-primary btn-sm" onClick={handleImport} disabled={importing}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  {importing ? <div className="spinner" style={{ width: 13, height: 13 }} /> : <Check size={13} />}
                  Import {parseResult.data.length} Loan{parseResult.data.length !== 1 ? 's' : ''}
                </button>
              </div>
            </>
          )}

          {parseResult.data.length === 0 && parseResult.errors.length > 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center', padding: '1rem 0' }}>
              No valid rows to import. Please fix the errors and try again.
            </div>
          )}
        </div>
      )}

      {importSuccess && (
        <div className="card fade-in" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem' }}>
          <CheckCircle size={20} style={{ color: 'var(--teal)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>Import successful</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Redirecting to loans…</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>CSV Format Guide</div>
          <button className="btn btn-ghost btn-sm" onClick={downloadLoanScheduleTemplate}
            style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <Download size={13} /> Download Template
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[
            { col: 'loan_id',             req: true,  ex: 'LOAN-001',         desc: 'Unique loan reference number' },
            { col: 'lender',              req: true,  ex: 'First National',    desc: 'Lender / bank / creditor name' },
            { col: 'currency',            req: true,  ex: 'USD',              desc: '3-letter ISO currency code' },
            { col: 'outstanding_balance', req: true,  ex: '4200000',          desc: 'Current outstanding balance' },
            { col: 'payment_date',        req: true,  ex: '2025-07-01',       desc: 'Next payment due date (YYYY-MM-DD)' },
            { col: 'maturity_date',       req: true,  ex: '2028-12-31',       desc: 'Final maturity date (YYYY-MM-DD)' },
            { col: 'principal',           req: false, ex: '5000000',          desc: 'Original principal amount' },
            { col: 'interest_rate',       req: false, ex: '4.5',              desc: 'Annual interest rate as percentage' },
            { col: 'payment_amount',      req: false, ex: '125000',           desc: 'Amount of next payment' },
            { col: 'payment_type',        req: false, ex: 'both',             desc: 'principal / interest / both' },
            { col: 'loan_type',           req: false, ex: 'term',             desc: 'term / revolver / bond / other' },
            { col: 'description',         req: false, ex: 'Equipment loan',   desc: 'Optional notes or memo' },
          ].map(({ col, req, ex, desc }) => (
            <div key={col} style={{ display: 'grid', gridTemplateColumns: '180px 60px 160px 1fr', gap: '0.5rem', alignItems: 'center', fontSize: '0.8125rem' }}>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--teal)', background: 'rgba(0,200,160,0.08)', padding: '0.15rem 0.35rem', borderRadius: 4 }}>
                {col}
              </code>
              <span style={{ fontSize: '0.6875rem' }}>
                {req ? <span className="badge badge-red" style={{ fontSize: '0.6rem' }}>required</span>
                      : <span className="badge badge-gray" style={{ fontSize: '0.6rem' }}>optional</span>}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{ex}</span>
              <span style={{ color: 'var(--text-muted)' }}>{desc}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: '0.875rem', padding: '0.625rem', background: 'var(--bg-app)', borderRadius: 'var(--r-md)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Column headers are case-insensitive. Accepted aliases: <em>bank/creditor</em> for lender, <em>balance/outstanding</em> for outstanding_balance, <em>maturity/end_date</em> for maturity_date.
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────

type Tab = 'loans' | 'analysis' | 'upload'

export function LoanSchedulesPage() {
  const { loans, addLoan, addLoans, updateLoan, deleteLoan, loading } = useLoanSchedules()
  const [activeTab, setActiveTab] = useState<Tab>('loans')

  const TABS: { key: Tab; label: string }[] = [
    { key: 'loans',    label: 'Loans' },
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
            <Banknote size={20} style={{ color: 'var(--teal)' }} />
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Loan / Debt Schedules
            </h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>
            Track debt facilities, repayment schedules and maturity profiles.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {loans.length} loan{loans.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

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
              {tab.key === 'loans' && loans.length > 0 && (
                <span style={{ marginLeft: '0.5rem', fontSize: '0.6875rem', background: 'var(--bg-app)', color: 'var(--text-muted)', padding: '0.1rem 0.4rem', borderRadius: 999, fontWeight: 400 }}>
                  {loans.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div style={{ padding: '1.25rem' }}>
          {activeTab === 'loans' && (
            <LoansTab
              loans={loans}
              onAdd={addLoan}
              onUpdate={updateLoan}
              onDelete={deleteLoan}
              onSwitchToUpload={() => setActiveTab('upload')}
            />
          )}
          {activeTab === 'analysis' && <AnalysisTab loans={loans} />}
          {activeTab === 'upload' && (
            <UploadTab
              addLoans={addLoans}
              onImported={() => setActiveTab('loans')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
