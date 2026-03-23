import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useHedgeCoverage, useHedgePolicy } from '@/hooks/useData'
import { formatCurrency, formatPct, COVERAGE_COLORS, COVERAGE_LABELS, getCoverageStatus, currencyFlag } from '@/lib/utils'
import { Shield, AlertTriangle, CheckCircle, XCircle, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'

export function CoveragePage() {
  const { coverage, loading: l1 } = useHedgeCoverage()
  const { policy, loading: l2 } = useHedgePolicy()
  const loading = l1 || l2

  const enriched = coverage.map(c => ({
    ...c,
    status: getCoverageStatus(c.coverage_pct, policy),
  }))

  const counts = {
    compliant:    enriched.filter(c => c.status === 'compliant').length,
    under_hedged: enriched.filter(c => c.status === 'under_hedged').length,
    over_hedged:  enriched.filter(c => c.status === 'over_hedged').length,
    unhedged:     enriched.filter(c => c.status === 'unhedged').length,
  }

  const chartData = enriched.map(c => ({
    pair: c.currency_pair,
    hedged: c.total_hedged,
    unhedged: Math.max(Math.abs(c.net_exposure) - c.total_hedged, 0),
    coverage: c.coverage_pct,
  }))

  function statusBadgeClass(s: string) {
    return ({ compliant: 'green', under_hedged: 'red', over_hedged: 'amber', unhedged: 'gray' } as any)[s] ?? 'gray'
  }

  return (
    <div style={{ padding: '1.75rem', maxWidth: 1200 }} className="fade-in">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Coverage Analysis</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
            Hedge policy compliance across {coverage.length} currency pair{coverage.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link to="/settings" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
          <Settings size={14} /> Policy Settings
        </Link>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
          <div className="spinner" style={{ width: 28, height: 28 }} />
        </div>
      ) : coverage.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <Shield size={36} />
            <h3>No coverage data yet</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              Upload exposures and add hedge positions to see policy compliance.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Status KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
            {([
              { key: 'compliant',    label: 'Compliant',    Icon: CheckCircle,  color: 'var(--green)', bg: '#10b98112' },
              { key: 'under_hedged', label: 'Under-hedged', Icon: AlertTriangle, color: 'var(--red)',   bg: '#ef444412' },
              { key: 'over_hedged',  label: 'Over-hedged',  Icon: AlertTriangle, color: 'var(--amber)', bg: '#f59e0b12' },
              { key: 'unhedged',     label: 'Unhedged',     Icon: XCircle,      color: 'var(--text-muted)', bg: '#6b728012' },
            ] as const).map(({ key, label, Icon, color, bg }) => (
              <div key={key} className="card" style={{ padding: '1rem', background: bg, borderColor: color + '30' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                  <Icon size={13} color={color} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{label}</span>
                </div>
                <div style={{ fontSize: '1.875rem', fontWeight: 700, color }}>{counts[key]}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>pair{counts[key] !== 1 ? 's' : ''}</div>
              </div>
            ))}
          </div>

          {/* Policy banner */}
          {policy && (
            <div style={{ marginBottom: '1.25rem', background: 'var(--teal-dim)', border: '1px solid #00c8a025', borderRadius: 'var(--r-md)', padding: '0.875rem 1.25rem', display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Shield size={14} color="var(--teal)" />
                <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--teal)' }}>{policy.name}</span>
              </div>
              {[
                ['Coverage target', `${policy.min_coverage_pct}–${policy.max_coverage_pct}%`],
                ['Min threshold', formatCurrency(policy.min_notional_threshold, policy.base_currency, true)],
                ['Min tenor', `${policy.min_tenor_days} days`],
              ].map(([label, value]) => (
                <div key={label} style={{ fontSize: '0.8125rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{label}: </span>
                  <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Chart */}
          <div className="card" style={{ marginBottom: '1.25rem' }}>
            <div style={{ marginBottom: '1rem' }}>
              <h3 style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Hedged vs Unhedged by Currency</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>Stacked notional exposure</p>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} barCategoryGap="35%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="pair" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={v => `${(v / 1_000_000).toFixed(0)}M`} />
                <Tooltip
                  formatter={(val: number, name: string) => [formatCurrency(val, 'USD', true), name === 'hedged' ? 'Hedged' : 'Unhedged']}
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
                />
                <Bar dataKey="hedged"   fill="#00c8a0" radius={[3,3,0,0]} stackId="a" name="Hedged" />
                <Bar dataKey="unhedged" fill="#ef4444" opacity={0.65} radius={[3,3,0,0]} stackId="a" name="Unhedged" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Detail table */}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Coverage Detail</span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Currency Pair</th>
                  <th className="text-right">Net Exposure</th>
                  <th className="text-right">Hedged</th>
                  <th className="text-right">Unhedged</th>
                  <th className="text-right">Coverage</th>
                  <th>vs. Policy</th>
                  <th className="text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {enriched.map(c => {
                  const color = COVERAGE_COLORS[c.status]
                  const policyGap = policy
                    ? c.coverage_pct < policy.min_coverage_pct
                      ? `${(policy.min_coverage_pct - c.coverage_pct).toFixed(1)}% below min`
                      : c.coverage_pct > policy.max_coverage_pct
                        ? `${(c.coverage_pct - policy.max_coverage_pct).toFixed(1)}% above max`
                        : 'Within range'
                    : '—'
                  const policyColor = !policy ? 'var(--text-muted)'
                    : policyGap === 'Within range' ? 'var(--green)'
                      : policyGap.includes('below') ? 'var(--red)' : 'var(--amber)'

                  return (
                    <tr key={c.currency_pair}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span>{currencyFlag(c.currency_pair.split('/')[0])}</span>
                          <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{c.currency_pair}</span>
                        </div>
                      </td>
                      <td className="text-right mono">{formatCurrency(Math.abs(c.net_exposure), 'USD', true)}</td>
                      <td className="text-right mono" style={{ color: 'var(--teal)' }}>{formatCurrency(c.total_hedged, 'USD', true)}</td>
                      <td className="text-right mono" style={{ color: c.unhedged_amount > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                        {formatCurrency(Math.max(c.unhedged_amount, 0), 'USD', true)}
                      </td>
                      <td className="text-right">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem' }}>
                          <div style={{ width: 56, height: 4, background: 'var(--bg-surface)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.min(c.coverage_pct, 100)}%`, background: color, borderRadius: 2 }} />
                          </div>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, minWidth: 48, color }}>{formatPct(c.coverage_pct)}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: '0.8125rem', color: policyColor }}>{policyGap}</td>
                      <td className="text-center">
                        <span className={`badge badge-${statusBadgeClass(c.status)}`}>{COVERAGE_LABELS[c.status]}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
