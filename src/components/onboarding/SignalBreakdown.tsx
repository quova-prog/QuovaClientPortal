import type { ReconciliationSignalSummary } from '@/types'

const SIGNAL_ICONS: Record<string, string> = {
  model_agreement:        '✓',
  model_disagreement:     '✗',
  confidence_spread:      '↕',
  data_type_match:        '≡',
  data_type_mismatch:     '≠',
  sample_data_validation: '◉',
  sample_data_conflict:   '⊘',
  erp_profile_match:      '⛁',
  naming_convention:      '∿',
  cardinality_check:      '#',
  null_rate_check:        '∅',
  historical_precedent:   '⌚',
  rule_based_override:    '⚙',
}

interface SignalBreakdownProps {
  signals: ReconciliationSignalSummary[]
  reasoning?: string
  proposalAField?: string
  proposalBField?: string
  proposalAConfidence?: number
  proposalBConfidence?: number
  humanReviewPrompt?: string
}

export function SignalBreakdown({
  signals, reasoning, proposalAField, proposalBField,
  proposalAConfidence, proposalBConfidence, humanReviewPrompt,
}: SignalBreakdownProps): React.ReactElement {
  const showModelComparison = proposalAField && proposalBField && proposalAField !== proposalBField

  return (
    <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)' }}>

      {/* Model comparison */}
      {showModelComparison && (
        <div style={{ marginBottom: 10 }}>
          <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Model Comparison
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <ModelChip label="Model A" field={proposalAField!} confidence={proposalAConfidence} />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', alignSelf: 'center' }}>vs</span>
            <ModelChip label="Model B" field={proposalBField!} confidence={proposalBConfidence} />
          </div>
        </div>
      )}

      {/* Reasoning */}
      {reasoning && (
        <div style={{ marginBottom: 10 }}>
          <p style={{ margin: '0 0 3px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Reasoning
          </p>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
            {reasoning}
          </p>
        </div>
      )}

      {/* Human review prompt */}
      {humanReviewPrompt && (
        <div style={{
          marginBottom: 10, padding: '0.5rem 0.625rem',
          background: '#fffbeb', borderRadius: 'var(--r-sm)', border: '1px solid #fde68a',
        }}>
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#92400e', fontWeight: 500 }}>
            ⚠ {humanReviewPrompt}
          </p>
        </div>
      )}

      {/* Signals */}
      {signals.length > 0 && (
        <div>
          <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Signals ({signals.length})
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {signals.map((signal, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 16, textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {SIGNAL_ICONS[signal.type] ?? '•'}
                </span>
                <div style={{ width: 50, height: 3, borderRadius: 999, background: 'var(--border)', overflow: 'hidden', flexShrink: 0 }}>
                  <div style={{
                    width: `${Math.round(signal.weight * 100)}%`,
                    height: '100%',
                    background: signal.weight >= 0.7 ? 'var(--green)' : signal.weight >= 0.4 ? 'var(--amber)' : 'var(--text-muted)',
                    borderRadius: 999,
                  }} />
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', flex: 1 }}>
                  {signal.description}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ModelChip({ label, field, confidence }: { label: string; field: string; confidence?: number }) {
  return (
    <div style={{
      padding: '4px 8px', borderRadius: 'var(--r-sm)',
      background: 'var(--bg-card)', border: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block' }}>{label}</span>
      <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>
        {field}
      </span>
      {confidence != null && (
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 4 }}>
          ({Math.round(confidence * 100)}%)
        </span>
      )}
    </div>
  )
}
