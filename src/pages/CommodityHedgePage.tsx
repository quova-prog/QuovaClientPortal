import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useCommodityData } from '@/hooks/useCommodityData'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

export function CommodityHedgePage() {
  const { user } = useAuth()
  const { hedges, loading } = useCommodityData()

  const handleAddDemoData = async () => {
    if (!user?.organisation?.id) return
    await supabase.from('commodity_hedges').insert([
      {
        org_id: user.organisation.id,
        instrument_type: 'swap',
        commodity_type: 'Brent Crude',
        price_index_reference: 'ICE Brent',
        unit_of_measure: 'bbl',
        direction: 'buy',
        volume: 50000,
        contracted_price: 75.50,
        trade_date: new Date().toISOString().split('T')[0],
        settlement_date: '2026-09-30',
        counterparty_bank: 'JPMorgan',
        status: 'active'
      }
    ])
    window.location.reload()
  }

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Commodity Hedges</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>Track active futures, swaps, and options</p>
        </div>
        <button className="btn btn-primary" onClick={handleAddDemoData}><Plus size={16} /> Add Demo Hedge</button>
      </div>

      <div className="page-content">
        <div className="card">
          <div style={{ padding: '0' }}>
            {loading ? (
              <div style={{ padding: '3rem', textAlign: 'center' }}>Loading hedges...</div>
            ) : hedges.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--sidebar-text)' }}>
                <h3>No hedge positions found</h3>
                <p style={{ marginTop: '1rem', maxWidth: 400, margin: '1rem auto 0' }}>
                  Record your financial derivatives used to manage commodity price risk.
                </p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--sidebar-border)', color: '#64748b' }}>
                    <th style={{ padding: '1rem 1.5rem', fontWeight: 600 }}>Instrument</th>
                    <th style={{ padding: '1rem 1.5rem', fontWeight: 600 }}>Commodity</th>
                    <th style={{ padding: '1rem 1.5rem', fontWeight: 600 }}>Volume</th>
                    <th style={{ padding: '1rem 1.5rem', fontWeight: 600 }}>Price</th>
                    <th style={{ padding: '1rem 1.5rem', fontWeight: 600 }}>Settlement</th>
                    <th style={{ padding: '1rem 1.5rem', fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {hedges.map(hedge => (
                    <tr key={hedge.id} style={{ borderBottom: '1px solid var(--sidebar-border)' }}>
                      <td style={{ padding: '1rem 1.5rem', fontWeight: 500, color: '#e2e8f0', textTransform: 'capitalize' }}>
                        {hedge.direction} {hedge.instrument_type}
                      </td>
                      <td style={{ padding: '1rem 1.5rem' }}>{hedge.commodity_type}</td>
                      <td style={{ padding: '1rem 1.5rem' }}>{hedge.volume.toLocaleString()} {hedge.unit_of_measure}</td>
                      <td style={{ padding: '1rem 1.5rem', fontFamily: 'monospace' }}>${hedge.contracted_price.toFixed(2)}</td>
                      <td style={{ padding: '1rem 1.5rem' }}>{hedge.settlement_date}</td>
                      <td style={{ padding: '1rem 1.5rem' }}>
                        <span style={{ 
                          padding: '0.25rem 0.5rem', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
                          background: hedge.status === 'active' ? 'rgba(0, 194, 168, 0.1)' : 'rgba(148, 163, 184, 0.1)',
                          color: hedge.status === 'active' ? '#00C2A8' : '#94a3b8'
                        }}>
                          {hedge.status}
                        </span>
                      </td>
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
