import { useState, useMemo } from 'react'
import { Plus, Shield, Trash2, Search, X } from 'lucide-react'
import { useHedgePositions, useExposureSummary } from '@/hooks/useData'
import { formatCurrency, formatDate, formatRate, daysUntil, currencyFlag } from '@/lib/utils'
import type { HedgePositionForm } from '@/types'

const CURRENCY_PAIRS = ['EUR/USD','GBP/USD','USD/CAD','USD/JPY','AUD/USD','USD/CHF','EUR/GBP','EUR/CAD','GBP/CAD','USD/SEK']
const INSTRUMENT_TYPES = [{ value: 'forward', label: 'Forward' },{ value: 'swap', label: 'FX Swap' },{ value: 'option', label: 'Option' },{ value: 'spot', label: 'Spot' }]
const BANKS = ['JPMorgan Chase','Goldman Sachs','Citibank','BMO Capital Markets','TD Securities','RBC Capital Markets','HSBC','Barclays','Deutsche Bank','BNP Paribas','Other']

function freshForm(): HedgePositionForm {
  return {
    instrument_type: 'forward', currency_pair: 'EUR/USD', direction: 'sell',
    notional_base: 0, contracted_rate: 0, trade_date: new Date().toISOString().split('T')[0],
    value_date: '', counterparty_bank: '', reference_number: '', notes: '',
  }
}

export function HedgesPage() {
  const { positions, loading, addPosition, deletePosition } = useHedgePositions()
  const { summary } = useExposureSummary()
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<HedgePositionForm>(freshForm)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [step, setStep] = useState<'entry' | 'review'>('entry')

  const [baseCcy, quoteCcy] = form.currency_pair.split('/')
  const quotedNotional = form.notional_base && form.contracted_rate ? form.notional_base * form.contracted_rate : 0

  function set<K extends keyof HedgePositionForm>(k: K, v: HedgePositionForm[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  const filtered = useMemo(() => positions.filter(p =>
    !search || [p.currency_pair, p.counterparty_bank ?? '', p.reference_number ?? '']
      .some(s => s.toLowerCase().includes(search.toLowerCase()))
  ), [positions, search])

  const totalHedged = useMemo(() => positions.reduce((s, p) => s + p.notional_base, 0), [positions])
  const byPair = useMemo(() => {
    const map: Record<string, number> = {}
    positions.forEach(p => { map[p.currency_pair] = (map[p.currency_pair] ?? 0) + p.notional_base })
    return map
  }, [positions])

  async function handleSubmit() {
    setFormError('')
    if (!form.notional_base || form.notional_base <= 0) { setFormError('Enter a valid notional amount'); return }
    if (!form.contracted_rate || form.contracted_rate <= 0) { setFormError('Enter a valid contracted rate'); return }
    if (!form.value_date) { setFormError('Settlement date is required'); return }
    if (new Date(form.value_date) <= new Date(form.trade_date)) { setFormError('Settlement date must be after trade date'); return }
    if (step === 'entry') { setStep('review'); return }
    setSubmitting(true)
    const [base, quote] = form.currency_pair.split('/')
    const { error } = await addPosition({ ...form, base_currency: base, quote_currency: quote, notional_usd: null, status: 'active' } as any)
    setSubmitting(false)
    if (error) { setFormError(error); return }
    setShowForm(false); setForm(freshForm()); setStep('entry')
  }

  function openForm() { setShowForm(true); setStep('entry'); setForm(freshForm()); setFormError('') }
  function closeForm() { setShowForm(false); setStep('entry'); setFormError('') }

  return (
    <div style={{ padding: '1.75rem', maxWidth: 1200 }} className="fade-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Hedge Positions</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
            {positions.length} active position{positions.length !== 1 ? 's' : ''} · Total hedged {formatCurrency(totalHedged, 'USD', true)}
          </p>
        </div>
        <button className="btn btn-primary" onClick={openForm}>
          <Plus size={15} /> New Hedge Position
        </button>
      </div>

      {/* Coverage strip by currency */}
      {summary.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          {summary.slice(0, 5).map(s => {
            const hedged = byPair[s.currency_pair] ?? 0
            const pct = Math.abs(s.net_exposure) > 0 ? Math.min((hedged / Math.abs(s.net_exposure)) * 100, 100) : 0
            const color = pct >= 60 ? 'var(--teal)' : pct > 0 ? 'var(--amber)' : 'var(--red)'
            return (
              <div key={s.currency_pair} className="card" style={{ padding: '0.875rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                  <span>{currencyFlag(s.base_currency)}</span>
                  <span style={{ fontWeight: 600, fontSize: '0.875rem', fontFamily: 'var(--font-mono)' }}>{s.currency_pair}</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Coverage</div>
                <div style={{ fontWeight: 700, fontSize: '1.125rem', color }}>{pct.toFixed(0)}%</div>
                <div style={{ height: 3, background: 'var(--bg-surface)', borderRadius: 2, marginTop: '0.375rem' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.4s' }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Search */}
      <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '1rem' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
          <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input className="input" style={{ paddingLeft: '2.25rem' }} placeholder="Search currency, bank, reference…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.8125rem', display: 'flex', alignItems: 'center' }}>
          {filtered.length} position{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Positions table */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="spinner" style={{ width: 24, height: 24 }} /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <Shield size={36} />
            <h3>No hedge positions{search ? ' matching your search' : ''}</h3>
            {!search && <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Add your first forward or swap to start tracking coverage.</p>}
            {!search && <button className="btn btn-primary" onClick={openForm} style={{ marginTop: '0.5rem' }}><Plus size={14} /> New Position</button>}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Currency Pair</th>
                  <th>Direction</th>
                  <th className="text-right">Notional</th>
                  <th className="text-right">Rate</th>
                  <th>Trade Date</th>
                  <th>Settlement</th>
                  <th>Days</th>
                  <th>Counterparty</th>
                  <th>Reference</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const days = daysUntil(p.value_date)
                  return (
                    <tr key={p.id}>
                      <td><span className="badge badge-teal">{p.instrument_type}</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                          <span>{currencyFlag(p.base_currency)}</span>
                          <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{p.currency_pair}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge badge-${p.direction === 'buy' ? 'green' : 'blue'}`}>
                          {p.direction === 'buy' ? '↑ Buy' : '↓ Sell'} {p.base_currency}
                        </span>
                      </td>
                      <td className="text-right mono" style={{ fontWeight: 500 }}>{formatCurrency(p.notional_base, p.base_currency)}</td>
                      <td className="text-right mono">{formatRate(p.contracted_rate)}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{formatDate(p.trade_date)}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{formatDate(p.value_date)}</td>
                      <td>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: days < 0 ? 'var(--text-muted)' : days <= 7 ? 'var(--red)' : days <= 30 ? 'var(--amber)' : 'var(--teal)' }}>
                          {days < 0 ? 'Expired' : `${days}d`}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{p.counterparty_bank || '—'}</td>
                      <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>{p.reference_number || '—'}</td>
                      <td>
                        {confirmDeleteId === p.id ? (
                          <div style={{ display: 'flex', gap: '0.25rem' }}>
                            <button className="btn btn-danger btn-sm" onClick={() => { deletePosition(p.id); setConfirmDeleteId(null) }}>Delete</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDeleteId(null)}>Keep</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDeleteId(p.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem', borderRadius: 'var(--r-sm)' }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal — Screen 13 + 16 */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto' }}>
            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ fontWeight: 600 }}>{step === 'entry' ? 'New Hedge Position' : 'Review & Confirm'}</h3>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                  {step === 'entry' ? 'FX Forward / Swap entry' : 'Verify details before saving'}
                </p>
              </div>
              <button onClick={closeForm} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>

            {/* Steps */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', fontSize: '0.8125rem' }}>
              {(['Entry', 'Review'] as const).map((s, i) => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, background: (i === 0 && step === 'entry') || (i === 1 && step === 'review') ? 'var(--teal)' : 'var(--bg-surface)', color: (i === 0 && step === 'entry') || (i === 1 && step === 'review') ? '#080f1a' : 'var(--text-muted)' }}>{i + 1}</div>
                  <span style={{ color: (i === 0 && step === 'entry') || (i === 1 && step === 'review') ? 'var(--text-primary)' : 'var(--text-muted)' }}>{s}</span>
                  {i < 1 && <span style={{ color: 'var(--border)', margin: '0 0.125rem' }}>›</span>}
                </div>
              ))}
            </div>

            {step === 'entry' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Instrument */}
                <div>
                  <label className="label">Instrument</label>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {INSTRUMENT_TYPES.map(t => (
                      <button key={t.value} onClick={() => set('instrument_type', t.value as any)} className={`btn btn-sm ${form.instrument_type === t.value ? 'btn-primary' : 'btn-ghost'}`}>{t.label}</button>
                    ))}
                  </div>
                </div>
                {/* Pair */}
                <div>
                  <label className="label">Currency Pair</label>
                  <select className="input" value={form.currency_pair} onChange={e => set('currency_pair', e.target.value)}>
                    {CURRENCY_PAIRS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                {/* Sell / Buy display */}
                <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--r-md)', padding: '0.875rem', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '0.5rem', alignItems: 'end' }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Selling</div>
                      <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-app)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', fontSize: '0.875rem', fontWeight: 500 }}>
                        {currencyFlag(form.direction === 'sell' ? baseCcy : quoteCcy)} {form.direction === 'sell' ? baseCcy : quoteCcy}
                      </div>
                    </div>
                    <button onClick={() => set('direction', form.direction === 'buy' ? 'sell' : 'buy')}
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '0.4rem 0.5rem', cursor: 'pointer', color: 'var(--text-secondary)', marginBottom: '1px' }}>⇅</button>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Buying</div>
                      <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-app)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', fontSize: '0.875rem', fontWeight: 500 }}>
                        {currencyFlag(form.direction === 'buy' ? baseCcy : quoteCcy)} {form.direction === 'buy' ? baseCcy : quoteCcy}
                      </div>
                    </div>
                  </div>
                </div>
                {/* Notional */}
                <div>
                  <label className="label">Notional Amount ({baseCcy})</label>
                  <input className="input" type="number" placeholder="e.g. 2500000" value={form.notional_base || ''} onChange={e => set('notional_base', parseFloat(e.target.value) || 0)} />
                </div>
                {/* Rate */}
                <div>
                  <label className="label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Contracted Rate</span>
                    {quotedNotional > 0 && <span style={{ color: 'var(--teal)', fontWeight: 400, fontSize: '0.75rem' }}>= {formatCurrency(quotedNotional, quoteCcy, true)} {quoteCcy}</span>}
                  </label>
                  <input className="input" type="number" step="0.0001" placeholder="e.g. 1.0850" value={form.contracted_rate || ''} onChange={e => set('contracted_rate', parseFloat(e.target.value) || 0)} />
                </div>
                {/* Dates */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="label">Trade Date</label>
                    <input className="input" type="date" value={form.trade_date} onChange={e => set('trade_date', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Settlement Date</label>
                    <input className="input" type="date" value={form.value_date} onChange={e => set('value_date', e.target.value)} />
                  </div>
                </div>
                {/* Bank + Ref */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="label">Counterparty Bank</label>
                    <select className="input" value={form.counterparty_bank ?? ''} onChange={e => set('counterparty_bank', e.target.value)}>
                      <option value="">Select…</option>
                      {BANKS.map(b => <option key={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Reference #</label>
                    <input className="input" placeholder="Bank conf. ref" value={form.reference_number ?? ''} onChange={e => set('reference_number', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="label">Notes (optional)</label>
                  <input className="input" placeholder="e.g. Q2 EUR revenue hedge" value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
                </div>
              </div>
            ) : (
              /* Review — Screen 16 */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {/* Sell row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '1.75rem' }}>{currencyFlag(form.direction === 'sell' ? baseCcy : quoteCcy)}</span>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Selling</div>
                    <div style={{ fontWeight: 700, fontSize: '1.25rem', fontFamily: 'var(--font-mono)' }}>{formatCurrency(form.notional_base, form.direction === 'sell' ? baseCcy : quoteCcy)}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '1.125rem' }}>⇅</div>
                {/* Buy row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '1.75rem' }}>{currencyFlag(form.direction === 'buy' ? baseCcy : quoteCcy)}</span>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Buying</div>
                    <div style={{ fontWeight: 700, fontSize: '1.25rem', fontFamily: 'var(--font-mono)' }}>{quotedNotional > 0 ? formatCurrency(quotedNotional, form.direction === 'buy' ? baseCcy : quoteCcy) : '—'}</div>
                  </div>
                </div>
                {/* Metrics grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.25rem' }}>
                  {[
                    { label: 'Contracted Rate', value: formatRate(form.contracted_rate) },
                    { label: 'Instrument', value: form.instrument_type },
                    { label: 'Trade Date', value: formatDate(form.trade_date) },
                    { label: 'Settlement Date', value: form.value_date ? formatDate(form.value_date) : '—' },
                  ].map(m => (
                    <div key={m.label} style={{ background: 'var(--bg-surface)', borderRadius: 'var(--r-sm)', padding: '0.75rem', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{m.label}</div>
                      <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{m.value}</div>
                    </div>
                  ))}
                </div>
                {(form.counterparty_bank || form.notes) && (
                  <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--r-sm)', padding: '0.75rem', border: '1px solid var(--border)', fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    {form.counterparty_bank && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>Counterparty</span><span style={{ fontWeight: 500 }}>{form.counterparty_bank}</span></div>}
                    {form.reference_number && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>Reference</span><span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>{form.reference_number}</span></div>}
                    {form.notes && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>Notes</span><span style={{ color: 'var(--text-secondary)' }}>{form.notes}</span></div>}
                  </div>
                )}
              </div>
            )}

            {formError && (
              <div className="error-banner" style={{ marginTop: '0.75rem' }}>{formError}</div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
              {step === 'review' && <button className="btn btn-ghost" onClick={() => setStep('entry')}>← Back</button>}
              <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={handleSubmit} disabled={submitting}>
                {submitting ? <span className="spinner" style={{ width: 16, height: 16 }} /> : step === 'entry' ? 'Review →' : '✓ Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
