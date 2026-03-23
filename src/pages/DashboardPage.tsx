import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { useDashboardMetrics } from '@/hooks/useData'
import { formatCurrency, formatPct, formatDate, formatDateShort, daysUntil,
         COVERAGE_COLORS, COVERAGE_LABELS, COVERAGE_BG, chartColor, currencyFlag } from '@/lib/utils'
import { AlertTriangle, TrendingUp, Shield, Clock, ChevronRight, Activity } from 'lucide-react'

export function DashboardPage() {
  const { metrics, loading, policy } = useDashboardMetrics()

  if (loading) return <PageLoader />

  if (!metrics || metrics.open_exposure_count === 0) return <EmptyDashboard />

  const {
    total_exposure_usd, total_hedged_usd, overall_coverage_pct,
    coverage_status, currency_count, open_exposure_count, active_hedge_count,
    exposures_by_currency, coverage_by_currency, upcoming_settlements, maturing_hedges,
  } = metrics

  const unhedged = total_exposure_usd - total_hedged_usd
  const hedgedPct = overall_coverage_pct

  // Donut chart data — by currency
  const donutData = exposures_by_currency.slice(0, 6).map((e, i) => ({
    name: e.currency_pair,
    value: Math.abs(e.net_exposure),
    color: chartColor(i),
  }))

  return (
    <div style={{ padding: '1.75rem', maxWidth: 1200 }} className="fade-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.02em' }}>
            My Hedge Portal
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
            Last updated {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <CoverageStatusBadge status={coverage_status} />
        </div>
      </div>

      {/* Top row: Exposure Summary + Balances */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>

        {/* Exposure Summary — matches Figma left card */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Exposure Summary</span>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>USD</span>
          </div>

          {/* Net Exposure row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', padding: '0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--r-md)', marginBottom: '0.625rem' }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: 'var(--teal-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <TrendingUp size={15} color="var(--teal)" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.125rem' }}>Net Exposure</div>
              <div style={{ fontWeight: 700, fontSize: '1.25rem', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>
                {formatCurrency(total_exposure_usd, 'USD', true)}
              </div>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'right' }}>
              <div>{currency_count} pairs</div>
              <div>{open_exposure_count} items</div>
            </div>
          </div>

          {/* Hedge Ratio row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', padding: '0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--r-md)', marginBottom: '1rem' }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: `${COVERAGE_COLORS[coverage_status]}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shield size={15} color={COVERAGE_COLORS[coverage_status]} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.125rem' }}>Hedge Ratio</div>
              <div style={{ fontWeight: 700, fontSize: '1.25rem', fontFamily: 'var(--font-mono)', color: COVERAGE_COLORS[coverage_status] }}>
                {formatPct(hedgedPct)}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                Hedged / Net Exposure
              </div>
            </div>
            {policy && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'right' }}>
                <div>Target</div>
                <div style={{ color: 'var(--text-secondary)' }}>{policy.min_coverage_pct}–{policy.max_coverage_pct}%</div>
              </div>
            )}
          </div>

          {/* Hedged vs Unhedged bar */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Hedged</div>
                <div style={{ fontWeight: 600, fontSize: '0.9375rem', fontFamily: 'var(--font-mono)' }}>
                  {formatCurrency(total_hedged_usd, 'USD', true)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Unhedged</div>
                <div style={{ fontWeight: 600, fontSize: '0.9375rem', fontFamily: 'var(--font-mono)', color: unhedged > 0 ? 'var(--red)' : 'var(--green)' }}>
                  {formatCurrency(Math.abs(unhedged), 'USD', true)}
                </div>
              </div>
            </div>
            <div style={{ height: 8, background: 'var(--bg-surface)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.min(hedgedPct, 100)}%`,
                background: `linear-gradient(90deg, var(--teal), ${COVERAGE_COLORS[coverage_status]})`,
                borderRadius: 4,
                transition: 'width 0.6s ease',
              }} />
            </div>
            {policy && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                Target {policy.base_currency} Hedge Ratio: {policy.min_coverage_pct}–{policy.max_coverage_pct}%
              </div>
            )}
          </div>
        </div>

        {/* Balances — donut chart */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Exposure by Currency</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{currency_count} pairs</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'center' }}>
            {/* Donut */}
            <div style={{ position: 'relative', height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={48} outerRadius={72}
                    dataKey="value" paddingAngle={2} strokeWidth={0}>
                    {donutData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v, 'USD', true)}
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Centre label */}
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Total</div>
                <div style={{ fontWeight: 700, fontSize: '1rem', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>
                  {formatCurrency(total_exposure_usd, 'USD', true)}
                </div>
              </div>
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {donutData.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                    <span style={{ color: 'var(--text-secondary)' }}>{d.name}</span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', fontWeight: 500 }}>
                    {formatCurrency(d.value, 'USD', true)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Middle row: Coverage by Currency + Upcoming */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>

        {/* Coverage Status by Currency — like Tasks table in Figma */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Coverage by Currency</span>
            <Activity size={14} color="var(--text-muted)" />
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Currency Pair</th>
                <th className="text-right">Net Exposure</th>
                <th className="text-right">Coverage</th>
                <th className="text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {coverage_by_currency.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No coverage data</td></tr>
              ) : coverage_by_currency.map(c => (
                <tr key={c.currency_pair}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>{currencyFlag(c.base_currency ?? c.currency_pair.split('/')[0])}</span>
                      <span style={{ fontWeight: 500 }}>{c.currency_pair}</span>
                    </div>
                  </td>
                  <td className="text-right mono">{formatCurrency(Math.abs(c.net_exposure), 'USD', true)}</td>
                  <td className="text-right mono" style={{ color: COVERAGE_COLORS[c.status] }}>
                    {formatPct(c.coverage_pct)}
                  </td>
                  <td className="text-center">
                    <span className={`badge badge-${statusBadgeClass(c.status)}`}>
                      {COVERAGE_LABELS[c.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Upcoming Settlements + Maturing Hedges — like Job Status Insights */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Upcoming (30 days)</span>
            <Clock size={14} color="var(--text-muted)" />
          </div>
          {upcoming_settlements.length === 0 && maturing_hedges.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <Clock size={28} />
              <p style={{ fontSize: '0.875rem' }}>No items maturing within 30 days</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Type</th>
                  <th className="text-right">Notional</th>
                  <th className="text-right">Due</th>
                </tr>
              </thead>
              <tbody>
                {upcoming_settlements.map(e => (
                  <tr key={e.id}>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: '0.8125rem' }}>{e.entity}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{e.description || e.currency_pair}</div>
                    </td>
                    <td><span className="badge badge-blue">Exposure</span></td>
                    <td className="text-right mono">{formatCurrency(e.notional_base, e.base_currency, true)}</td>
                    <td className="text-right" style={{ fontSize: '0.8125rem', color: daysUntil(e.settlement_date) <= 7 ? 'var(--red)' : 'var(--text-secondary)' }}>
                      {formatDateShort(e.settlement_date)}
                    </td>
                  </tr>
                ))}
                {maturing_hedges.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: '0.8125rem' }}>{p.counterparty_bank ?? 'Hedge'}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{p.currency_pair} {p.instrument_type}</div>
                    </td>
                    <td><span className="badge badge-teal">Hedge</span></td>
                    <td className="text-right mono">{formatCurrency(p.notional_base, p.base_currency, true)}</td>
                    <td className="text-right" style={{ fontSize: '0.8125rem', color: daysUntil(p.value_date) <= 7 ? 'var(--amber)' : 'var(--text-secondary)' }}>
                      {formatDateShort(p.value_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* KPI stat bar — bottom summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
        {[
          { label: 'Open Exposures', value: open_exposure_count, unit: 'items', icon: TrendingUp, color: 'var(--blue)' },
          { label: 'Active Hedges', value: active_hedge_count, unit: 'positions', icon: Shield, color: 'var(--teal)' },
          { label: 'Currency Pairs', value: currency_count, unit: 'pairs', icon: Activity, color: 'var(--amber)' },
          { label: 'Unhedged Exposure', value: formatCurrency(Math.abs(unhedged), 'USD', true), unit: '', icon: AlertTriangle, color: unhedged > 0 ? 'var(--red)' : 'var(--green)' },
        ].map(({ label, value, unit, icon: Icon, color }) => (
          <div key={label} className="card" style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <Icon size={13} color={color} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{label}</span>
            </div>
            <div style={{ fontWeight: 700, fontSize: '1.375rem', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>
              {value}
            </div>
            {unit && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>{unit}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function statusBadgeClass(status: string) {
  return { compliant: 'green', under_hedged: 'red', over_hedged: 'amber', unhedged: 'gray' }[status] ?? 'gray'
}

function CoverageStatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { compliant: 'Policy Compliant', under_hedged: 'Under-hedged', over_hedged: 'Over-hedged', unhedged: 'Unhedged' }
  const cls = statusBadgeClass(status)
  return <span className={`badge badge-${cls}`}>{labels[status] ?? status}</span>
}

function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: '1rem' }}>
      <div className="spinner" style={{ width: 28, height: 28 }} />
      <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading dashboard…</span>
    </div>
  )
}

function EmptyDashboard() {
  return (
    <div style={{ padding: '1.75rem' }}>
      <h1 style={{ fontSize: '1.375rem', fontWeight: 600, marginBottom: '0.5rem' }}>My Hedge Portal</h1>
      <div className="card" style={{ maxWidth: 480, marginTop: '2rem' }}>
        <div className="empty-state">
          <TrendingUp size={36} />
          <h3>No exposure data yet</h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            Upload a CSV export from Workday to see your FX exposure dashboard.
          </p>
          <a href="/exposure" className="btn btn-primary" style={{ marginTop: '0.5rem', textDecoration: 'none' }}>
            Upload Exposures
          </a>
        </div>
      </div>
    </div>
  )
}
