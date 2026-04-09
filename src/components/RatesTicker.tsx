import { RefreshCw } from 'lucide-react'
import type { LiveRate } from '@/hooks/useLiveFxRates'
import { formatRate } from '@/lib/frankfurter'

// The 8 pairs displayed in the ticker
const TICKER_PAIRS = [
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CAD',
  'AUD/USD', 'USD/CHF', 'EUR/GBP', 'GBP/JPY',
]

interface RatesTickerProps {
  rates: LiveRate[]
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  onRefresh: () => void
}

function ChangeArrow({ change }: { change: 'up' | 'down' | 'flat' }) {
  if (change === 'up') return <span style={{ color: '#10b981', fontSize: '0.625rem', marginLeft: 2 }}>▲</span>
  if (change === 'down') return <span style={{ color: '#ef4444', fontSize: '0.625rem', marginLeft: 2 }}>▼</span>
  return <span style={{ color: '#475569', fontSize: '0.625rem', marginLeft: 2 }}>—</span>
}

function SkeletonItem() {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
      <div style={{
        width: 52, height: 10, borderRadius: 3,
        background: 'linear-gradient(90deg, #1e293b 25%, #2d3f55 50%, #1e293b 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.4s infinite',
      }} />
      <div style={{
        width: 38, height: 10, borderRadius: 3,
        background: 'linear-gradient(90deg, #1e293b 25%, #2d3f55 50%, #1e293b 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.4s infinite 0.2s',
      }} />
    </div>
  )
}

export function RatesTicker({
  rates, loading, error, lastUpdated, onRefresh,
}: RatesTickerProps) {
  // Build a map for quick lookup
  const ratesMap = new Map<string, LiveRate>()
  rates.forEach(r => ratesMap.set(r.pair, r))

  const tickerItems = TICKER_PAIRS.map(pair => ({
    pair,
    live: ratesMap.get(pair) ?? null,
  }))

  const updatedStr = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <>
      {/* Keyframe for shimmer — injected once */}
      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>

      <div style={{
        height: 32,
        minHeight: 32,
        background: '#0f172a',
        borderBottom: '1px solid #1e293b',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: '1rem',
        paddingRight: '0.75rem',
        overflow: 'hidden',
        flexShrink: 0,
        gap: '0.5rem',
      }}>

        {/* Rate items */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, flex: 1, overflow: 'hidden' }}>
          {error ? (
            <span style={{ fontSize: '0.6875rem', color: '#f59e0b', fontFamily: 'monospace' }}>
              Rates unavailable
            </span>
          ) : loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
              {TICKER_PAIRS.slice(0, 6).map(p => <SkeletonItem key={p} />)}
            </div>
          ) : (
            tickerItems.map(({ pair, live }, idx) => (
              <span key={pair} style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', fontSize: '0.6875rem', fontFamily: 'monospace' }}>
                {idx > 0 && (
                  <span style={{ color: '#334155', margin: '0 0.625rem' }}>·</span>
                )}
                <span style={{ color: '#64748b', marginRight: '0.25rem' }}>{pair}</span>
                {live ? (
                  <>
                    <span style={{ color: '#f1f5f9', fontWeight: 600 }}>
                      {formatRate(pair, live.rate)}
                    </span>
                    <ChangeArrow change={live.change} />
                  </>
                ) : (
                  <span style={{ color: '#475569' }}>—</span>
                )}
              </span>
            ))
          )}
        </div>

        {/* Right side: Live indicator + time + refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0, marginLeft: '0.75rem' }}>
          {!error && !loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              {/* Green live dot */}
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: '#10b981',
                display: 'inline-block',
                boxShadow: '0 0 4px #10b981',
              }} />
              <span style={{ fontSize: '0.625rem', color: '#475569', fontFamily: 'monospace' }}>
                ECB{updatedStr ? ` · ${updatedStr}` : ''}
              </span>
            </div>
          )}

          <button
            onClick={onRefresh}
            title="Refresh rates"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#475569',
              padding: '0.125rem',
              display: 'flex',
              alignItems: 'center',
              lineHeight: 1,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#94a3b8' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#475569' }}
          >
            <RefreshCw size={11} />
          </button>
        </div>

      </div>
    </>
  )
}
