import { Box, TrendingUp, Shield, AlertTriangle } from 'lucide-react'
import { useCommodityData } from '@/hooks/useCommodityData'

export function CommodityDashboardPage() {
  const { metrics, loading } = useCommodityData()

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Commodity Dashboard</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>Overview of commodity exposures and hedges</p>
        </div>
      </div>
      <div className="page-content">

      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem' }}>Loading commodity metrics...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginTop: '1.5rem' }}>
          <MetricCard title="Total Volume Exposed" value={metrics.totalExposedVolume.toLocaleString()} icon={TrendingUp} />
          <MetricCard title="Total Volume Hedged" value={metrics.totalHedgedVolume.toLocaleString()} icon={Shield} />
          <MetricCard title="Coverage Ratio" value={`${metrics.overallCoveragePct.toFixed(1)}%`} icon={Box} />
          <MetricCard title="Active Hedges" value={metrics.activeHedgeCount.toString()} icon={AlertTriangle} color="var(--teal)" />
        </div>
      )}

      <div style={{ marginTop: '2rem' }}>
        <div className="card">
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--sidebar-text)' }}>
            <h3>Commodity Risk Analytics</h3>
            <p style={{ marginTop: '1rem' }}>Detailed charts and volumetric breakdown will appear here once exposure data is onboarded.</p>
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}

function MetricCard({ title, value, unit, icon: Icon, color = 'var(--teal)' }: { title: string, value: string, unit?: string, icon: React.FC<any>, color?: string }) {
  return (
    <div className="card">
      <div style={{ padding: '1.5rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '0.8125rem', color: '#64748b', fontWeight: 500, marginBottom: '0.5rem' }}>{title}</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#e2e8f0', display: 'flex', alignItems: 'baseline', gap: '0.25rem' }}>
            {value}
            {unit && <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#94a3b8' }}>{unit}</span>}
          </div>
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 'var(--r-md)', background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  )
}
