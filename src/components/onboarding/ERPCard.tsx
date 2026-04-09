import type { ERPConnectorConfig } from '@/lib/erpConnectorConfig'

interface ERPCardProps {
  config:   ERPConnectorConfig
  selected: boolean
  onClick:  () => void
}

const BADGE: Record<string, { bg: string; color: string; border: string }> = {
  Cloud:   { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  'On-prem': { bg: '#f5f3ff', color: '#7c3aed', border: '#ddd6fe' },
  File:    { bg: '#f0fdfa', color: '#0f766e', border: '#99f6e4' },
  Custom:  { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
}

export function ERPCard({ config, selected, onClick }: ERPCardProps): React.ReactElement {
  const badge = BADGE[config.badge] ?? BADGE.Cloud

  return (
    <button
      onClick={config.available ? onClick : undefined}
      disabled={!config.available}
      style={{
        all: 'unset',
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: '0.875rem',
        borderRadius: 'var(--r-lg)',
        border: `${selected ? 2 : 1}px solid ${selected ? 'var(--teal)' : 'var(--border)'}`,
        background: selected ? 'var(--teal-dim)' : 'var(--bg-card)',
        cursor: config.available ? 'pointer' : 'default',
        opacity: config.available ? 1 : 0.55,
        transition: 'all 0.15s',
        boxShadow: selected ? '0 0 0 1px var(--teal)' : 'none',
        position: 'relative', textAlign: 'left',
      }}
    >
      {/* "Soon" pill for unavailable adapters */}
      {!config.available && (
        <span style={{
          position: 'absolute', top: 7, right: 8,
          fontSize: '0.62rem', fontWeight: 600, color: 'var(--text-muted)',
          background: 'var(--bg-surface)', padding: '1px 5px',
          borderRadius: 4, border: '1px solid var(--border)',
        }}>Soon</span>
      )}

      {/* Name */}
      <span style={{
        fontSize: '0.8rem', fontWeight: 600,
        color: config.erp_type === 'flat_file' ? 'var(--teal-dark)' : 'var(--text-primary)',
        lineHeight: 1.3,
      }}>
        {config.label}
      </span>

      {/* Badge */}
      <span style={{
        display: 'inline-block', alignSelf: 'flex-start',
        padding: '2px 7px', borderRadius: 999,
        fontSize: '0.62rem', fontWeight: 600,
        background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
      }}>
        {config.badge}
      </span>

      {/* Description */}
      <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
        {config.description}
      </p>

      {/* Time */}
      <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        ⏱ {config.estimated_setup_time}
      </p>
    </button>
  )
}
