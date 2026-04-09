import type { ReconciliationVerdictType } from '@/types'

const VERDICT_CONFIG: Record<ReconciliationVerdictType, { label: string; bg: string; border: string; color: string }> = {
  CONSENSUS:              { label: 'Consensus',   bg: '#dcfce7', border: '#86efac', color: '#166534' },
  CONSENSUS_WITH_NUANCE:  { label: 'Nuanced',     bg: '#f0fdfa', border: '#99f6e4', color: '#115e59' },
  CONFLICT:               { label: 'Conflict',    bg: '#fef2f2', border: '#fecaca', color: '#991b1b' },
  RESOLVED_BY_RULES:      { label: 'Rule-based',  bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af' },
  SINGLE_ONLY:            { label: 'Single pass',  bg: '#f9fafb', border: '#e5e7eb', color: '#6b7280' },
  BOTH_UNCERTAIN:         { label: 'Uncertain',   bg: '#fffbeb', border: '#fde68a', color: '#92400e' },
}

interface VerdictBadgeProps {
  verdict: ReconciliationVerdictType
}

export function VerdictBadge({ verdict }: VerdictBadgeProps): React.ReactElement {
  const cfg = VERDICT_CONFIG[verdict]
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: '0.62rem',
        fontWeight: 600,
        padding: '2px 6px',
        borderRadius: 4,
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        color: cfg.color,
        whiteSpace: 'nowrap',
      }}
    >
      {cfg.label}
    </span>
  )
}
