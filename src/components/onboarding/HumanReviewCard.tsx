import type { OnboardingHumanReviewItem } from '@/types'

const PRIORITY_CONFIG: Record<string, { bg: string; border: string; color: string; label: string }> = {
  critical: { bg: '#fef2f2', border: '#fecaca', color: '#991b1b', label: 'Critical' },
  high:     { bg: '#fff7ed', border: '#fed7aa', color: '#9a3412', label: 'High' },
  medium:   { bg: '#fffbeb', border: '#fde68a', color: '#92400e', label: 'Medium' },
  low:      { bg: '#f9fafb', border: '#e5e7eb', color: '#6b7280', label: 'Low' },
}

interface HumanReviewCardProps {
  item: OnboardingHumanReviewItem
  selectedOption?: string
  onSelectOption?: (label: string) => void
}

export function HumanReviewCard({ item, selectedOption, onSelectOption }: HumanReviewCardProps): React.ReactElement {
  const pri = PRIORITY_CONFIG[item.priority] ?? PRIORITY_CONFIG.low

  return (
    <div style={{
      padding: '0.875rem 1rem',
      background: 'var(--bg-card)',
      borderRadius: 'var(--r-md)',
      border: `1px solid ${pri.border}`,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{
          fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px',
          borderRadius: 3, background: pri.bg, color: pri.color,
          border: `1px solid ${pri.border}`, textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {pri.label}
        </span>
        <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          {item.sourceTable}.{item.sourceColumn}
        </span>
      </div>

      {/* Question */}
      <p style={{ margin: '0 0 8px', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 }}>
        {item.question}
      </p>

      {/* Context */}
      {item.context && (
        <p style={{ margin: '0 0 10px', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {item.context}
        </p>
      )}

      {/* Options */}
      {item.options.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {item.options.map(opt => {
            const isSelected = selectedOption === opt.label
            return (
              <label
                key={opt.label}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '6px 8px', borderRadius: 'var(--r-sm)',
                  border: `1px solid ${isSelected ? 'var(--teal)' : 'var(--border)'}`,
                  background: isSelected ? 'var(--teal-dim)' : 'transparent',
                  cursor: onSelectOption ? 'pointer' : 'default',
                }}
                onClick={() => onSelectOption?.(opt.label)}
              >
                <input
                  type="radio"
                  name={`review-${item.sourceTable}-${item.sourceColumn}`}
                  checked={isSelected}
                  readOnly
                  style={{ marginTop: 2, accentColor: 'var(--teal)' }}
                />
                <div>
                  <span style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {opt.label}
                  </span>
                  {opt.proposedBy !== 'system' && (
                    <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginLeft: 6 }}>
                      (proposed by Model {opt.proposedBy})
                    </span>
                  )}
                  {opt.description && (
                    <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                      {opt.description}
                    </p>
                  )}
                </div>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
