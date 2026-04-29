import { BarChart2 } from 'lucide-react'

export function CommodityAnalyticsPage() {
  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Commodity Analytics</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>Volumetric coverage and price sensitivity analysis</p>
        </div>
      </div>

      <div className="page-content">
        <div className="card">
          <div style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--sidebar-text)' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--sidebar-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
              <BarChart2 size={24} color="var(--teal)" />
            </div>
            <h3>Analytics Engine</h3>
            <p style={{ marginTop: '0.5rem', maxWidth: 400, margin: '0.5rem auto 0' }}>
              We'll calculate your volumetric coverage ratio and estimate Value-at-Risk (VaR) once you add commodity exposures and hedges.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
