import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useCommodityData } from '@/hooks/useCommodityData'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

export function CommodityExposurePage() {
  const { user } = useAuth()
  const { exposures, loading, refetch } = useCommodityData()
  const [showForm, setShowForm] = useState(false)

  const handleAddDemoData = async () => {
    if (!user?.organisation?.id) return
    await supabase.from('commodity_exposures').insert([
      {
        org_id: user.organisation.id,
        commodity_type: 'Brent Crude',
        unit_of_measure: 'bbl',
        direction: 'consume',
        volume: 100000,
        price_index_reference: 'ICE Brent',
        delivery_start_date: '2026-07-01',
        delivery_end_date: '2026-09-30',
        description: 'Q3 Jet Fuel proxy',
      }
    ])
    refetch()
  }

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Commodity Exposures</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>Manage forecasted consumption and production volumes</p>
        </div>
        <button className="btn btn-primary" onClick={handleAddDemoData}><Plus size={16} /> Add Demo Exposure</button>
      </div>

      <div className="page-content">
        <div className="card">
          <div style={{ padding: '0' }}>
            {loading ? (
              <div style={{ padding: '3rem', textAlign: 'center' }}>Loading exposures...</div>
            ) : exposures.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--sidebar-text)' }}>
                <h3>No commodity exposures found</h3>
                <p style={{ marginTop: '1rem', maxWidth: 400, margin: '1rem auto 0' }}>
                  Upload your volumetric forecasts or connect your ERP to begin tracking commodity risk.
                </p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--sidebar-border)', color: '#64748b' }}>
                    <th style={{ padding: '1rem 1.5rem', fontWeight: 600 }}>Commodity</th>
                    <th style={{ padding: '1rem 1.5rem', fontWeight: 600 }}>Direction</th>
                    <th style={{ padding: '1rem 1.5rem', fontWeight: 600 }}>Volume</th>
                    <th style={{ padding: '1rem 1.5rem', fontWeight: 600 }}>Delivery Period</th>
                    <th style={{ padding: '1rem 1.5rem', fontWeight: 600 }}>Index</th>
                  </tr>
                </thead>
                <tbody>
                  {exposures.map(exp => (
                    <tr key={exp.id} style={{ borderBottom: '1px solid var(--sidebar-border)' }}>
                      <td style={{ padding: '1rem 1.5rem', fontWeight: 500, color: '#e2e8f0' }}>{exp.commodity_type}</td>
                      <td style={{ padding: '1rem 1.5rem', textTransform: 'capitalize' }}>
                        <span style={{ 
                          padding: '0.25rem 0.5rem', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
                          background: exp.direction === 'consume' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(0, 194, 168, 0.1)',
                          color: exp.direction === 'consume' ? '#ef4444' : '#00C2A8'
                        }}>
                          {exp.direction}
                        </span>
                      </td>
                      <td style={{ padding: '1rem 1.5rem' }}>{exp.volume.toLocaleString()} {exp.unit_of_measure}</td>
                      <td style={{ padding: '1rem 1.5rem' }}>{exp.delivery_start_date} to {exp.delivery_end_date}</td>
                      <td style={{ padding: '1rem 1.5rem', color: '#94a3b8' }}>{exp.price_index_reference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
