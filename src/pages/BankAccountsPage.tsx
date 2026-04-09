import { useState, useMemo } from 'react'
import { Plus, X, RefreshCw, CheckCircle, Building2 } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { useBankAccounts, useFxRates } from '@/hooks/useData'
import type { BankAccount, BankAccountForm } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const KNOWN_COLORS: Record<string, string> = {
  BMO: '#c41d1d', TD: '#2d8d34', CIBC: '#7b1c2e', RBC: '#005daa',
  HSBC: '#cc1111', Scotia: '#c8002d', NBC: '#e30613',
  'Bank of America': '#e31937', Chase: '#117bb8', Citibank: '#0066cc',
}
const COLOR_PALETTE = ['#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#84cc16']

function bankColor(name: string): string {
  return KNOWN_COLORS[name] ?? COLOR_PALETTE[name.charCodeAt(0) % COLOR_PALETTE.length]
}

function bankAbbr(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return name.slice(0, 3).toUpperCase()
  return words.map(w => w[0]).join('').slice(0, 3).toUpperCase()
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1)   return 'Just now'
  if (mins < 60)  return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24)   return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`
  const days = Math.round(hrs / 24)
  return `${days} day${days !== 1 ? 's' : ''} ago`
}

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CHF', 'CNY']
const ACCOUNT_TYPES = ['Chequing', 'Savings', 'Foreign Currency', 'Money Market']

const EMPTY_FORM: BankAccountForm = {
  bank_name: '', account_name: '', account_number_masked: '', currency: 'CAD',
  balance: 0, account_type: 'Chequing', swift_bic: '', iban: '', notes: '',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BankAccountsPage() {
  const { accounts, loading, addAccount, syncAccount, disconnectAccount } = useBankAccounts()
  const { rates: fxRates } = useFxRates()

  const [selectedBank,       setSelectedBank      ] = useState<string | null>(null)
  const [managingAccount,    setManagingAccount   ] = useState<BankAccount | null>(null)
  const [showAddForm,        setShowAddForm       ] = useState(false)
  const [form,               setForm             ] = useState<BankAccountForm>(EMPTY_FORM)
  const [formError,          setFormError        ] = useState('')
  const [submitting,         setSubmitting       ] = useState(false)
  const [syncing,            setSyncing          ] = useState(false)
  const [syncDone,           setSyncDone         ] = useState(false)
  const [disconnectConfirm,  setDisconnectConfirm] = useState(false)

  // Derive per-currency CAD rate (fallback for missing pairs)
  function toCad(amount: number, ccy: string): number {
    if (ccy === 'CAD') return amount
    const rate = fxRates[`${ccy}/CAD`] ?? ({ USD: 1.36, EUR: 1.49, GBP: 1.73, JPY: 0.0091, AUD: 0.88, CHF: 1.52, CNY: 0.19 } as Record<string, number>)[ccy] ?? 1
    return amount * rate
  }

  // Unique bank names from real data, sorted
  const uniqueBanks = useMemo(() =>
    [...new Set(accounts.map(a => a.bank_name))].sort()
  , [accounts])

  const filtered = selectedBank
    ? accounts.filter(a => a.bank_name === selectedBank)
    : accounts

  const totalCAD = accounts.reduce((s, a) => s + toCad(a.balance, a.currency), 0)

  function setField<K extends keyof BankAccountForm>(k: K, v: BankAccountForm[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function handleAdd() {
    setFormError('')
    if (!form.bank_name.trim())        { setFormError('Bank name is required'); return }
    if (!form.account_name.trim())     { setFormError('Account name is required'); return }
    if (!form.account_number_masked.trim()) { setFormError('Account number is required'); return }
    if (form.balance < 0)              { setFormError('Balance cannot be negative'); return }
    setSubmitting(true)
    const { error } = await addAccount(form)
    setSubmitting(false)
    if (error) { setFormError(error); return }
    setShowAddForm(false)
    setForm(EMPTY_FORM)
  }

  async function handleSync(id: string) {
    setSyncing(true)
    setSyncDone(false)
    await syncAccount(id)
    setSyncing(false)
    setSyncDone(true)
    setTimeout(() => setSyncDone(false), 4000)
  }

  async function handleDisconnect(id: string) {
    await disconnectAccount(id)
    setDisconnectConfirm(false)
    setManagingAccount(null)
  }

  function openManage(acc: BankAccount) {
    setManagingAccount(acc)
    setSyncDone(false)
    setDisconnectConfirm(false)
  }

  function closeManage() {
    setManagingAccount(null)
    setSyncDone(false)
    setDisconnectConfirm(false)
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Bank Accounts</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>Manage connected bank accounts and balances</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowAddForm(true); setForm(EMPTY_FORM); setFormError('') }}>
          <Plus size={13} /> Add Account
        </button>
      </div>

      <div className="page-content">

        {/* Bank filter tiles */}
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* All banks */}
          <button
            onClick={() => setSelectedBank(null)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none', cursor: 'pointer' }}>
            <div style={{ width: 56, height: 56, borderRadius: 'var(--r-lg)', background: selectedBank === null ? 'var(--teal)' : 'var(--bg-surface)', border: `2px solid ${selectedBank === null ? 'var(--teal)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: selectedBank === null ? '#fff' : 'var(--text-muted)', fontWeight: 700, fontSize: '0.75rem', transition: 'all 0.15s' }}>
              All
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>All Banks</span>
          </button>

          {uniqueBanks.map(bank => {
            const color = bankColor(bank)
            const abbr  = bankAbbr(bank)
            const isActive = selectedBank === bank
            return (
              <button key={bank} onClick={() => setSelectedBank(isActive ? null : bank)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none', cursor: 'pointer' }}>
                <div style={{ width: 56, height: 56, borderRadius: 'var(--r-lg)', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: abbr.length > 2 ? '0.8rem' : '1rem', boxShadow: isActive ? `0 0 0 3px ${color}40` : '0 2px 8px rgba(0,0,0,0.12)', opacity: selectedBank && !isActive ? 0.5 : 1, transition: 'all 0.15s' }}>
                  {abbr}
                </div>
                <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{bank}</span>
              </button>
            )
          })}

          {/* Add bank tile */}
          <button onClick={() => { setShowAddForm(true); setForm(EMPTY_FORM); setFormError('') }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none', cursor: 'pointer' }}>
            <div style={{ width: 56, height: 56, borderRadius: 'var(--r-lg)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--border)' }}>
              <Plus size={20} color="var(--text-muted)" />
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>Add Bank</span>
          </button>
        </div>

        {/* Accounts table */}
        <div className="card" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div className="spinner" style={{ margin: '0 auto 0.75rem' }} />
              Loading accounts…
            </div>
          ) : accounts.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <Building2 size={32} color="var(--text-muted)" style={{ opacity: 0.4, marginBottom: '0.75rem' }} />
              <p style={{ fontWeight: 600, marginBottom: '0.375rem' }}>No bank accounts connected</p>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>Add your first account to track balances and exposure.</p>
              <button className="btn btn-primary btn-sm" onClick={() => { setShowAddForm(true); setForm(EMPTY_FORM); setFormError('') }}>
                <Plus size={13} /> Add Account
              </button>
            </div>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Bank</th>
                    <th>Account Name</th>
                    <th>Account Number</th>
                    <th>Currency</th>
                    <th className="text-right">Balance</th>
                    <th>Type</th>
                    <th>Last Sync</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(acc => (
                    <tr key={acc.id}>
                      <td>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: bankColor(acc.bank_name), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.7rem' }}>
                          {bankAbbr(acc.bank_name).slice(0, 2)}
                        </div>
                      </td>
                      <td style={{ fontWeight: 600 }}>{acc.account_name}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{acc.account_number_masked}</td>
                      <td><span className="badge badge-blue">{acc.currency}</span></td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>{formatCurrency(acc.balance, acc.currency, true)}</td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>{acc.account_type}</td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <RefreshCw size={11} /> {relativeTime(acc.last_synced_at)}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${acc.status === 'active' ? 'badge-green' : acc.status === 'error' ? 'badge-red' : 'badge-gray'}`}>
                          {acc.status.charAt(0).toUpperCase() + acc.status.slice(1)}
                        </span>
                      </td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => openManage(acc)}>Manage</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  {filtered.length} account{filtered.length !== 1 ? 's' : ''}{selectedBank ? ` · ${selectedBank}` : ` across ${uniqueBanks.length} bank${uniqueBanks.length !== 1 ? 's' : ''}`}
                </span>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'right' }}>Total Balance (CAD equiv.)</div>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', textAlign: 'right' }}>
                    {formatCurrency(totalCAD, 'CAD', true)}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Add Account Modal ─────────────────────────────────── */}
      {showAddForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: 480, background: '#fff', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <span style={{ fontWeight: 700, fontSize: '0.9375rem' }}>Add Bank Account</span>
              <button onClick={() => setShowAddForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {[
                { label: 'Bank Name *', key: 'bank_name' as const, placeholder: 'e.g. BMO, TD, RBC' },
                { label: 'Account Name *', key: 'account_name' as const, placeholder: 'e.g. BMO Operating CAD' },
                { label: 'Account Number *', key: 'account_number_masked' as const, placeholder: 'e.g. ****8421' },
                { label: 'SWIFT / BIC', key: 'swift_bic' as const, placeholder: 'e.g. BOFMCAM2' },
                { label: 'IBAN', key: 'iban' as const, placeholder: 'e.g. CA29 BOFM 0014 ...' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>{label}</label>
                  <input
                    className="input"
                    style={{ width: '100%' }}
                    placeholder={placeholder}
                    value={form[key] as string}
                    onChange={e => setField(key, e.target.value)}
                  />
                </div>
              ))}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>Currency *</label>
                  <select className="input" style={{ width: '100%' }} value={form.currency} onChange={e => setField('currency', e.target.value)}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>Account Type *</label>
                  <select className="input" style={{ width: '100%' }} value={form.account_type} onChange={e => setField('account_type', e.target.value)}>
                    {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>Current Balance *</label>
                <input
                  className="input"
                  style={{ width: '100%' }}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.balance || ''}
                  onChange={e => setField('balance', parseFloat(e.target.value) || 0)}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>Notes</label>
                <textarea
                  className="input"
                  style={{ width: '100%', minHeight: 60, resize: 'vertical' }}
                  placeholder="Optional notes…"
                  value={form.notes}
                  onChange={e => setField('notes', e.target.value)}
                />
              </div>
            </div>

            {formError && (
              <p style={{ color: 'var(--red)', fontSize: '0.8125rem', marginTop: '0.75rem' }}>{formError}</p>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowAddForm(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }} disabled={submitting} onClick={handleAdd}>
                {submitting ? 'Adding…' : 'Add Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Manage Account Modal ──────────────────────────────── */}
      {managingAccount && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: 440, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: bankColor(managingAccount.bank_name), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.8rem' }}>
                  {bankAbbr(managingAccount.bank_name).slice(0, 2)}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>{managingAccount.account_name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{managingAccount.account_number_masked}</div>
                </div>
              </div>
              <button onClick={closeManage} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: '1.25rem' }}>
              {([
                ['Bank',          managingAccount.bank_name],
                ['Account Type',  managingAccount.account_type],
                ['Currency',      managingAccount.currency],
                ['Balance',       formatCurrency(managingAccount.balance, managingAccount.currency, true)],
                ['SWIFT / BIC',   managingAccount.swift_bic ?? '—'],
                ['IBAN',          managingAccount.iban ?? '—'],
                ['Status',        managingAccount.status.charAt(0).toUpperCase() + managingAccount.status.slice(1)],
                ['Last Sync',     relativeTime(managingAccount.last_synced_at)],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.625rem 0', borderBottom: '1px solid var(--border-dim)', fontSize: '0.875rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                  <span style={{ fontWeight: 500, fontFamily: ['Balance', 'SWIFT / BIC', 'IBAN'].includes(label) ? 'var(--font-mono)' : 'inherit', fontSize: label === 'IBAN' ? '0.8rem' : '0.875rem' }}>{value}</span>
                </div>
              ))}
              {managingAccount.notes && (
                <div style={{ padding: '0.625rem 0', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  {managingAccount.notes}
                </div>
              )}
            </div>

            {syncDone && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--green)', fontSize: '0.8125rem', marginBottom: '0.75rem' }}>
                <CheckCircle size={14} /> Sync timestamp updated
              </div>
            )}

            {disconnectConfirm ? (
              <div>
                <p style={{ fontSize: '0.8125rem', color: 'var(--red)', marginBottom: '0.75rem' }}>
                  Are you sure you want to disconnect <strong>{managingAccount.account_name}</strong>? This cannot be undone.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setDisconnectConfirm(false)}>Cancel</button>
                  <button className="btn btn-sm" style={{ flex: 1, justifyContent: 'center', background: 'var(--red)', color: '#fff', border: 'none' }}
                    onClick={() => handleDisconnect(managingAccount.id)}>
                    Confirm Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }} disabled={syncing}
                  onClick={() => handleSync(managingAccount.id)}>
                  <RefreshCw size={13} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
                  {syncing ? 'Syncing…' : 'Sync Now'}
                </button>
                <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center', color: 'var(--red)', borderColor: 'var(--red)' }}
                  onClick={() => setDisconnectConfirm(true)}>
                  Disconnect
                </button>
                <button className="btn btn-ghost btn-sm" onClick={closeManage}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
