import { useState } from 'react'
import { Plus, Search, X, TrendingUp, Shield, Phone } from 'lucide-react'

type Counterparty = {
  name: string
  tier: 'Tier 1' | 'Tier 2'
  status: string
  creditLimit: string
  utilized: string
  rating: string
  contact: string
  color: string
  phone?: string
  address?: string
}

const COUNTERPARTIES: Counterparty[] = [
  {
    name: 'Goldman Sachs',
    tier: 'Tier 1',
    status: 'Active',
    creditLimit: '$50,000,000',
    utilized: '$12,500,000',
    rating: 'AA-',
    contact: 'fx.desk@gs.com',
    color: '#3d6be8',
    phone: '+1 212 902 1000',
    address: '200 West Street, New York, NY 10282',
  },
  {
    name: 'JPMorgan Chase',
    tier: 'Tier 1',
    status: 'Active',
    creditLimit: '$75,000,000',
    utilized: '$8,200,000',
    rating: 'AA-',
    contact: 'fx.markets@jpmorgan.com',
    color: '#00a0dc',
    phone: '+1 212 270 6000',
    address: '383 Madison Avenue, New York, NY 10179',
  },
  {
    name: 'Citibank',
    tier: 'Tier 1',
    status: 'Active',
    creditLimit: '$40,000,000',
    utilized: '$5,750,000',
    rating: 'A+',
    contact: 'g10.fx@citi.com',
    color: '#ee1c25',
    phone: '+1 212 559 1000',
    address: '388 Greenwich Street, New York, NY 10013',
  },
  {
    name: 'BMO Capital Markets',
    tier: 'Tier 2',
    status: 'Active',
    creditLimit: '$25,000,000',
    utilized: '$3,100,000',
    rating: 'A+',
    contact: 'fx.sales@bmo.com',
    color: '#c41d1d',
    phone: '+1 416 867 4444',
    address: '100 King Street West, Toronto, ON M5X 1H3',
  },
  {
    name: 'TD Securities',
    tier: 'Tier 2',
    status: 'Active',
    creditLimit: '$20,000,000',
    utilized: '$2,900,000',
    rating: 'AA-',
    contact: 'fxdesk@tdsecurities.com',
    color: '#2d8d34',
    phone: '+1 416 983 2300',
    address: 'TD Centre, 66 Wellington Street West, Toronto, ON M5K 1A2',
  },
]

function parseMoney(s: string) {
  return parseFloat(s.replace(/[$,M]/g, ''))
}

export function CounterpartiesPage() {
  const [search, setSearch]         = useState('')
  const [tierFilter, setTierFilter] = useState<'all' | 'Tier 1' | 'Tier 2'>('all')
  const [managingCp, setManagingCp] = useState<Counterparty | null>(null)
  const [addingCp, setAddingCp]     = useState(false)
  const [newCp, setNewCp]           = useState({ name: '', tier: 'Tier 2', rating: '', contact: '', creditLimit: '' })

  const filtered = COUNTERPARTIES.filter(cp => {
    const matchSearch = !search || [cp.name, cp.contact, cp.rating]
      .some(s => s.toLowerCase().includes(search.toLowerCase()))
    const matchTier = tierFilter === 'all' || cp.tier === tierFilter
    return matchSearch && matchTier
  })

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Counterparties</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>Manage your bank and dealer relationships</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setAddingCp(true)}><Plus size={13} /> Add Counterparty</button>
      </div>

      <div className="page-content">
        {/* Filters */}
        <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '1rem', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
            <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input className="input" style={{ paddingLeft: '2.25rem' }} placeholder="Search counterparty, rating, contact…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {(['all', 'Tier 1', 'Tier 2'] as const).map(t => (
            <button key={t} onClick={() => setTierFilter(t)} className={`btn btn-sm ${tierFilter === t ? 'btn-primary' : 'btn-ghost'}`}>
              {t === 'all' ? 'All Tiers' : t}
            </button>
          ))}
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{filtered.length} counterpart{filtered.length !== 1 ? 'ies' : 'y'}</span>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Counterparty</th>
                <th>Tier</th>
                <th>Status</th>
                <th className="text-right">Credit Limit</th>
                <th className="text-right">Utilized</th>
                <th>Rating</th>
                <th>Contact</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((cp, i) => {
                const utilPct = parseMoney(cp.utilized) / parseMoney(cp.creditLimit) * 100
                return (
                  <tr key={i}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: cp.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.75rem', flexShrink: 0 }}>
                          {cp.name[0]}
                        </div>
                        <span style={{ fontWeight: 600 }}>{cp.name}</span>
                      </div>
                    </td>
                    <td><span className={`badge badge-${cp.tier === 'Tier 1' ? 'teal' : 'blue'}`}>{cp.tier}</span></td>
                    <td><span className="badge badge-green">{cp.status}</span></td>
                    <td className="text-right mono" style={{ fontWeight: 500 }}>{cp.creditLimit}</td>
                    <td className="text-right">
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, marginBottom: '0.25rem' }}>{cp.utilized}</div>
                        <div style={{ height: 3, background: '#e2e8f0', borderRadius: 2, width: 80 }}>
                          <div style={{ height: '100%', width: `${utilPct}%`, background: utilPct > 70 ? 'var(--amber)' : 'var(--teal)', borderRadius: 2 }} />
                        </div>
                      </div>
                    </td>
                    <td><span className="badge badge-purple">{cp.rating}</span></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>{cp.contact}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => setManagingCp(cp)}>Manage</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              {filtered.length} of {COUNTERPARTIES.length} counterparties
              {(search || tierFilter !== 'all') && filtered.length !== COUNTERPARTIES.length ? ' (filtered)' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* ── Manage Counterparty Modal ────────────────────────────────── */}
      {managingCp && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: 480, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: managingCp.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.875rem' }}>
                  {managingCp.name[0]}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>{managingCp.name}</div>
                  <span className={`badge badge-${managingCp.tier === 'Tier 1' ? 'teal' : 'blue'}`} style={{ marginTop: '0.25rem' }}>{managingCp.tier}</span>
                </div>
              </div>
              <button onClick={() => setManagingCp(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            {/* Credit utilization bar */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--r-md)', padding: '0.875rem', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.8125rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Credit Utilization</span>
                <span style={{ fontWeight: 600 }}>
                  {managingCp.utilized} / {managingCp.creditLimit}
                  <span style={{ marginLeft: '0.375rem', color: 'var(--text-muted)' }}>
                    ({(parseMoney(managingCp.utilized) / parseMoney(managingCp.creditLimit) * 100).toFixed(0)}%)
                  </span>
                </span>
              </div>
              <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3 }}>
                <div style={{
                  height: '100%',
                  width: `${parseMoney(managingCp.utilized) / parseMoney(managingCp.creditLimit) * 100}%`,
                  background: parseMoney(managingCp.utilized) / parseMoney(managingCp.creditLimit) > 0.7 ? 'var(--amber)' : 'var(--teal)',
                  borderRadius: 3,
                  transition: 'width 0.4s ease',
                }} />
              </div>
            </div>

            {/* Details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: '1.25rem' }}>
              {[
                ['Status',        managingCp.status],
                ['Credit Rating', managingCp.rating],
                ['FX Contact',    managingCp.contact],
                ...(managingCp.phone   ? [['Phone', managingCp.phone]]   : []),
                ...(managingCp.address ? [['Address', managingCp.address]] : []),
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border-dim)', fontSize: '0.875rem', gap: '1rem' }}>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
                  <span style={{ fontWeight: 500, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }}>
                <TrendingUp size={13} /> View Trades
              </button>
              <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }}>
                <Shield size={13} /> Edit Limits
              </button>
              <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }}>
                <Phone size={13} /> Contact
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setManagingCp(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Counterparty Modal ───────────────────────────────────── */}
      {addingCp && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: 440, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h3 style={{ fontWeight: 700 }}>Add Counterparty</h3>
              <button onClick={() => setAddingCp(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={e => { e.preventDefault(); setAddingCp(false) }} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <div>
                <label className="label">Institution Name</label>
                <input className="input" value={newCp.name} onChange={e => setNewCp(p => ({ ...p, name: e.target.value }))} placeholder="e.g. HSBC Securities" required />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="label">Tier</label>
                  <select className="input" value={newCp.tier} onChange={e => setNewCp(p => ({ ...p, tier: e.target.value }))}>
                    <option>Tier 1</option>
                    <option>Tier 2</option>
                  </select>
                </div>
                <div>
                  <label className="label">Credit Rating</label>
                  <input className="input" value={newCp.rating} onChange={e => setNewCp(p => ({ ...p, rating: e.target.value }))} placeholder="e.g. AA-" />
                </div>
              </div>
              <div>
                <label className="label">FX Contact Email</label>
                <input className="input" type="email" value={newCp.contact} onChange={e => setNewCp(p => ({ ...p, contact: e.target.value }))} placeholder="fx.desk@bank.com" />
              </div>
              <div>
                <label className="label">Credit Limit (USD)</label>
                <input className="input" type="number" value={newCp.creditLimit} onChange={e => setNewCp(p => ({ ...p, creditLimit: e.target.value }))} placeholder="e.g. 25000000" />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', paddingTop: '0.25rem' }}>
                <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setAddingCp(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>Add Counterparty</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
