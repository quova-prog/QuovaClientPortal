import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, Plus, Trash2, ArrowRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useOnboarding } from '@/hooks/useOnboarding'

// ── Constants ─────────────────────────────────────────────────

const CURRENCIES = [
  'USD','EUR','GBP','CAD','AUD','JPY','CHF','CNY','HKD','SGD',
  'NZD','SEK','NOK','DKK','MXN','BRL','INR','KRW','ZAR','AED',
  'SAR','PLN','CZK','HUF','ILS','TWD','THB','MYR','IDR','PHP',
]

const INDUSTRIES = [
  'Technology','Manufacturing','Retail & Consumer','Financial Services',
  'Healthcare','Energy & Resources','Real Estate','Transportation & Logistics',
  'Media & Entertainment','Agriculture','Other',
]

const REVENUE_BANDS = ['<$500M','$500M–$1B','$1B–$5B','$5B–$10B','$10B+']

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

const CADENCES = ['Weekly','Monthly','Quarterly','Annually']

interface EntityRow { name: string; country: string; functional_currency: string }

// ── Section header ─────────────────────────────────────────────

function SectionHeader({
  num, title, subtitle, expanded, done, onClick,
}: {
  num: number; title: string; subtitle: string
  expanded: boolean; done: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset', width: '100%', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 14, padding: '1rem 1.25rem',
        background: expanded ? 'var(--bg-surface)' : 'transparent',
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: done ? 'var(--teal)' : expanded ? 'var(--teal-dim)' : 'var(--bg-surface)',
        border: `2px solid ${done || expanded ? 'var(--teal)' : 'var(--border)'}`,
        color: done ? '#fff' : expanded ? 'var(--teal)' : 'var(--text-muted)',
        fontSize: '0.75rem', fontWeight: 700,
      }}>
        {done ? '✓' : num}
      </div>
      <div style={{ flex: 1, textAlign: 'left' }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{title}</p>
        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{subtitle}</p>
      </div>
      {expanded ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
    </button>
  )
}

// ── Currency chip selector ──────────────────────────────────────

function CurrencySelector({
  label, value, onChange,
}: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (ccy: string) => {
    onChange(value.includes(ccy) ? value.filter(c => c !== ccy) : [...value, ccy])
  }
  return (
    <div>
      <label className="label" style={{ marginBottom: 6 }}>{label}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {CURRENCIES.map(ccy => (
          <button
            key={ccy}
            onClick={() => toggle(ccy)}
            style={{
              all: 'unset', cursor: 'pointer', padding: '3px 10px',
              borderRadius: 999, fontSize: '0.78rem', fontWeight: 500,
              border: `1px solid ${value.includes(ccy) ? 'var(--teal)' : 'var(--border)'}`,
              background: value.includes(ccy) ? 'var(--teal-dim)' : 'var(--bg-surface)',
              color: value.includes(ccy) ? 'var(--teal-dark)' : 'var(--text-secondary)',
              transition: 'all 0.12s',
            }}
          >
            {ccy}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────

export function SetupWizard(): React.ReactElement {
  const { user }          = useAuth()
  const { session, profile, advanceStatus, reload } = useOnboarding()
  const navigate          = useNavigate()

  const [openSection, setOpenSection] = useState(profile ? -1 : 0)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  // Form state — pre-populate from existing profile
  const [funcCcy,        setFuncCcy]        = useState(profile?.functional_currency ?? 'USD')
  const [reportingCcys,  setReportingCcys]  = useState<string[]>(profile?.reporting_currencies ?? [])
  const [fiscalMonth,    setFiscalMonth]    = useState<number>(profile?.fiscal_year_end_month ?? 12)
  const [industry,       setIndustry]       = useState(profile?.industry ?? '')
  const [revBand,        setRevBand]        = useState(profile?.annual_revenue_band ?? '')
  const [txCcys,         setTxCcys]         = useState<string[]>(profile?.transaction_currencies ?? [])
  const [entities,       setEntities]       = useState<EntityRow[]>(() => {
    const existing = profile?.entities as EntityRow[] | undefined
    return existing?.length ? existing : [{ name: '', country: '', functional_currency: 'USD' }]
  })
  const [banks,          setBanks]          = useState<string[]>(profile?.bank_relationships ?? [])
  const [bankInput,      setBankInput]      = useState('')
  const [cadence,        setCadence]        = useState(profile?.reporting_cadence ?? '')
  const [painPoints,     setPainPoints]     = useState(profile?.fx_pain_points ?? '')

  // Sync form state when profile loads from DB (handles back-navigation)
  useEffect(() => {
    if (!profile) return
    setFuncCcy(profile.functional_currency ?? 'USD')
    setReportingCcys(profile.reporting_currencies ?? [])
    setFiscalMonth(profile.fiscal_year_end_month ?? 12)
    setIndustry(profile.industry ?? '')
    setRevBand(profile.annual_revenue_band ?? '')
    setTxCcys(profile.transaction_currencies ?? [])
    const existingEntities = profile.entities as EntityRow[] | undefined
    if (existingEntities?.length) setEntities(existingEntities)
    setBanks(profile.bank_relationships ?? [])
    setCadence(profile.reporting_cadence ?? '')
    setPainPoints(profile.fx_pain_points ?? '')
    // Collapse all sections since data is already filled
    setOpenSection(-1)
  }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps

  // Section completion state
  const sec1Done = !!funcCcy && !!industry && !!revBand
  const sec2Done = txCcys.length > 0
  const sec3Done = entities.length > 0 && entities.every(e => e.name.trim())

  // Generated currency pairs preview
  const pairs = txCcys.map(c => `${funcCcy}/${c}`)

  const addEntity = () => setEntities(prev => [...prev, { name: '', country: '', functional_currency: funcCcy }])
  const removeEntity = (i: number) => setEntities(prev => prev.filter((_, idx) => idx !== i))
  const updateEntity = (i: number, field: keyof EntityRow, value: string) => {
    setEntities(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: value } : e))
  }

  const addBank = () => {
    if (bankInput.trim() && !banks.includes(bankInput.trim())) {
      setBanks(prev => [...prev, bankInput.trim()])
    }
    setBankInput('')
  }

  const handleSubmit = useCallback(async () => {
    if (!user?.profile?.org_id || !session) return
    setSaving(true)
    setError(null)

    try {
      const profileData = {
        org_id:                user.profile.org_id,
        functional_currency:   funcCcy,
        reporting_currencies:  reportingCcys,
        fiscal_year_end_month: fiscalMonth,
        transaction_currencies: txCcys,
        entities:              entities.filter(e => e.name.trim()),
        industry,
        annual_revenue_band:   revBand,
        bank_relationships:    banks,
        reporting_cadence:     cadence || null,
        fx_pain_points:        painPoints || null,
      }

      if (profile) {
        // Update existing
        const { error: upErr } = await supabase
          .from('organization_profiles')
          .update({ ...profileData, updated_at: new Date().toISOString() })
          .eq('org_id', user.profile.org_id)
        if (upErr) throw new Error(upErr.message)
      } else {
        // Insert new
        const { error: insErr } = await supabase
          .from('organization_profiles')
          .insert(profileData)
        if (insErr) throw new Error(insErr.message)
      }

      // ── Create entities in the entities table ──────────────────
      const validEntities = entities.filter(e => e.name.trim())
      if (validEntities.length > 0) {
        // Fetch existing entity names to avoid duplicates on re-visit
        const { data: existing } = await supabase
          .from('entities')
          .select('name')
          .eq('org_id', user.profile.org_id)
        const existingNames = new Set((existing ?? []).map(e => e.name.toLowerCase()))

        const newEntities = validEntities
          .filter(e => !existingNames.has(e.name.trim().toLowerCase()))
          .map(e => ({
            org_id:              user.profile!.org_id,
            name:                e.name.trim(),
            functional_currency: e.functional_currency,
            jurisdiction:        e.country || null,
            is_active:           true,
          }))

        if (newEntities.length > 0) {
          const { error: entErr } = await supabase.from('entities').insert(newEntities)
          if (entErr) console.warn('Entity creation warning:', entErr.message)
        }
      }

      await advanceStatus('connect', 'Company profile completed')
      reload()
      navigate('/onboarding/connect')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }, [user, session, profile, funcCcy, reportingCcys, fiscalMonth, txCcys, entities, industry, revBand, banks, cadence, painPoints, advanceStatus, reload, navigate])

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 4px' }}>Company Setup</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Tell us about your organisation so Quova can tailor your FX risk profile.
        </p>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>

        {/* ── Section 1: Company Basics ── */}
        <div style={{ borderBottom: '1px solid var(--border)' }}>
          <SectionHeader
            num={1} title="Company Basics" done={sec1Done}
            subtitle="Functional currency, industry, and revenue"
            expanded={openSection === 0}
            onClick={() => setOpenSection(openSection === 0 ? -1 : 0)}
          />
          {openSection === 0 && (
            <div style={{ padding: '0 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
                <div>
                  <label className="label" style={{ marginBottom: 4 }}>Functional Currency *</label>
                  <select className="input" value={funcCcy} onChange={e => setFuncCcy(e.target.value)}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" style={{ marginBottom: 4 }}>Fiscal Year End Month</label>
                  <select className="input" value={fiscalMonth} onChange={e => setFiscalMonth(Number(e.target.value))}>
                    {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" style={{ marginBottom: 4 }}>Industry *</label>
                  <select className="input" value={industry} onChange={e => setIndustry(e.target.value)}>
                    <option value="">— Select —</option>
                    {INDUSTRIES.map(ind => <option key={ind} value={ind}>{ind}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" style={{ marginBottom: 4 }}>Annual Revenue *</label>
                  <select className="input" value={revBand} onChange={e => setRevBand(e.target.value)}>
                    <option value="">— Select —</option>
                    {REVENUE_BANDS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              <CurrencySelector
                label="Additional Reporting Currencies (optional)"
                value={reportingCcys}
                onChange={setReportingCcys}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!sec1Done}
                  onClick={() => setOpenSection(1)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  Continue <ArrowRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Section 2: Currency Exposure Profile ── */}
        <div style={{ borderBottom: '1px solid var(--border)' }}>
          <SectionHeader
            num={2} title="Currency Exposure Profile" done={sec2Done}
            subtitle="Which foreign currencies do you transact in?"
            expanded={openSection === 1}
            onClick={() => setOpenSection(openSection === 1 ? -1 : 1)}
          />
          {openSection === 1 && (
            <div style={{ padding: '0 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <CurrencySelector
                label="Transaction Currencies * (select all that apply)"
                value={txCcys}
                onChange={setTxCcys}
              />

              {txCcys.length > 0 && (
                <div style={{
                  padding: '0.75rem', background: 'var(--teal-dim)',
                  borderRadius: 'var(--r-md)', border: '1px solid rgba(0,200,160,0.2)',
                }}>
                  <p style={{ margin: '0 0 6px', fontSize: '0.78rem', fontWeight: 600, color: 'var(--teal-dark)' }}>
                    Currency pairs Quova will track:
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {pairs.map(p => (
                      <span key={p} className="badge badge-teal" style={{ fontSize: '0.72rem' }}>{p}</span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!sec2Done}
                  onClick={() => setOpenSection(2)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  Continue <ArrowRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Section 3: Entity Structure ── */}
        <div style={{ borderBottom: '1px solid var(--border)' }}>
          <SectionHeader
            num={3} title="Entity Structure" done={sec3Done}
            subtitle="Your legal subsidiaries or business units with FX exposure"
            expanded={openSection === 2}
            onClick={() => setOpenSection(openSection === 2 ? -1 : 2)}
          />
          {openSection === 2 && (
            <div style={{ padding: '0 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {entities.map((entity, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px 32px', gap: '0.5rem', alignItems: 'end' }}>
                  <div>
                    {i === 0 && <label className="label" style={{ marginBottom: 3 }}>Entity Name *</label>}
                    <input className="input" type="text" placeholder="e.g. Quova UK Ltd"
                      value={entity.name}
                      onChange={e => updateEntity(i, 'name', e.target.value)} />
                  </div>
                  <div>
                    {i === 0 && <label className="label" style={{ marginBottom: 3 }}>Country</label>}
                    <input className="input" type="text" placeholder="e.g. United Kingdom"
                      value={entity.country}
                      onChange={e => updateEntity(i, 'country', e.target.value)} />
                  </div>
                  <div>
                    {i === 0 && <label className="label" style={{ marginBottom: 3 }}>Func. Ccy</label>}
                    <select className="input" value={entity.functional_currency}
                      onChange={e => updateEntity(i, 'functional_currency', e.target.value)}>
                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div style={{ marginTop: i === 0 ? 20 : 0 }}>
                    {entities.length > 1 && (
                      <button onClick={() => removeEntity(i)}
                        style={{ all: 'unset', cursor: 'pointer', color: 'var(--red)', display: 'flex', alignItems: 'center' }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={addEntity}
                style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Plus size={13} /> Add Entity
              </button>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!sec3Done}
                  onClick={() => setOpenSection(3)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  Continue <ArrowRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Section 4: Optional Details ── */}
        <div>
          <SectionHeader
            num={4} title="Additional Details" done={false}
            subtitle="Help us personalise your experience (all optional)"
            expanded={openSection === 3}
            onClick={() => setOpenSection(openSection === 3 ? -1 : 3)}
          />
          {openSection === 3 && (
            <div style={{ padding: '0 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <div>
                <label className="label" style={{ marginBottom: 4 }}>Banking Partners</label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input className="input" type="text" placeholder="e.g. TD Bank"
                    value={bankInput}
                    onChange={e => setBankInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addBank()}
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-ghost btn-sm" onClick={addBank}>Add</button>
                </div>
                {banks.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {banks.map(b => (
                      <span key={b} className="badge badge-gray">
                        {b}
                        <button onClick={() => setBanks(prev => prev.filter(x => x !== b))}
                          style={{ all: 'unset', cursor: 'pointer', marginLeft: 4, color: 'var(--text-muted)' }}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="label" style={{ marginBottom: 4 }}>Reporting Cadence</label>
                <select className="input" value={cadence} onChange={e => setCadence(e.target.value)}>
                  <option value="">— Select —</option>
                  {CADENCES.map(c => <option key={c} value={c.toLowerCase()}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="label" style={{ marginBottom: 4 }}>
                  What's the hardest part of managing FX risk today? <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span>
                </label>
                <textarea className="input"
                  style={{ minHeight: 80, resize: 'vertical', fontFamily: 'inherit', fontSize: '0.875rem' }}
                  placeholder="e.g. We struggle with visibility into intercompany positions across 15 entities…"
                  value={painPoints}
                  onChange={e => setPainPoints(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--red-bg)', borderRadius: 'var(--r-md)', border: '1px solid #fecaca' }}>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--red)' }}>{error}</p>
        </div>
      )}

      {/* Submit */}
      <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="btn btn-primary"
          disabled={saving || !sec1Done || !sec2Done || !sec3Done}
          onClick={handleSubmit}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.625rem 1.5rem' }}
        >
          {saving ? (
            <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</>
          ) : (
            <>Next: Connect Your Data <ArrowRight size={14} /></>
          )}
        </button>
      </div>
    </div>
  )
}
