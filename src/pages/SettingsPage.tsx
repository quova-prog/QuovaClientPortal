import { useState, useEffect } from 'react'
import { useHedgePolicy } from '@/hooks/useData'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { Shield, Save, CheckCircle } from 'lucide-react'

export function SettingsPage() {
  const { policy, loading, refresh } = useHedgePolicy()
  const { user } = useAuth()
  const [form, setForm] = useState({ name: '', min_coverage_pct: 60, max_coverage_pct: 90, min_notional_threshold: 500000, min_tenor_days: 30, base_currency: 'USD' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (policy) setForm({ name: policy.name, min_coverage_pct: policy.min_coverage_pct, max_coverage_pct: policy.max_coverage_pct, min_notional_threshold: policy.min_notional_threshold, min_tenor_days: policy.min_tenor_days, base_currency: policy.base_currency })
  }, [policy])

  function set(k: string) { return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: ['min_coverage_pct','max_coverage_pct','min_notional_threshold','min_tenor_days'].includes(k) ? Number(e.target.value) : e.target.value })) }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user?.profile?.org_id) return
    setSaving(true)
    if (policy) {
      await supabase.from('hedge_policies').update(form).eq('id', policy.id)
    } else {
      await supabase.from('hedge_policies').insert({ ...form, org_id: user.profile.org_id })
    }
    await refresh()
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div style={{ padding: '1.75rem', maxWidth: 640 }} className="fade-in">
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Settings</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>Configure your hedge policy and organisation preferences</p>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <Shield size={16} color="var(--teal)" />
          <h3 style={{ fontWeight: 600 }}>Hedge Policy</h3>
        </div>

        {loading ? <div className="spinner" style={{ width: 20, height: 20 }} /> : (
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label className="label">Policy Name</label>
              <input className="input" value={form.name} onChange={set('name')} placeholder="Default Policy" required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="label">Min Coverage %</label>
                <input className="input" type="number" min={0} max={100} value={form.min_coverage_pct} onChange={set('min_coverage_pct')} />
              </div>
              <div>
                <label className="label">Max Coverage %</label>
                <input className="input" type="number" min={0} max={150} value={form.max_coverage_pct} onChange={set('max_coverage_pct')} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="label">Min Notional Threshold ($)</label>
                <input className="input" type="number" value={form.min_notional_threshold} onChange={set('min_notional_threshold')} />
              </div>
              <div>
                <label className="label">Min Tenor (days)</label>
                <input className="input" type="number" value={form.min_tenor_days} onChange={set('min_tenor_days')} />
              </div>
            </div>
            <div>
              <label className="label">Base Currency</label>
              <select className="input" value={form.base_currency} onChange={set('base_currency')}>
                {['USD','CAD','EUR','GBP','AUD','CHF','JPY'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', paddingTop: '0.25rem' }}>
              <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving…</>
                  : <><Save size={14} /> Save Policy</>}
              </button>
              {saved && <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--green)', fontSize: '0.875rem' }}><CheckCircle size={14} /> Saved</div>}
            </div>
          </form>
        )}
      </div>

      <div className="card">
        <h3 style={{ fontWeight: 600, marginBottom: '1rem' }}>Organisation</h3>
        <div style={{ fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {[
            ['Organisation', user?.organisation?.name ?? '—'],
            ['Plan', user?.organisation?.plan ?? '—'],
            ['Email', user?.email ?? '—'],
            ['Role', user?.profile?.role ?? '—'],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-dim)' }}>
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span style={{ fontWeight: 500 }}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
