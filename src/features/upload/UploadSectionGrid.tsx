import { UPLOAD_CARD_GROUPS, formatUploadDate } from './uploadCatalog'
import type { UploadSectionId } from './uploadCatalog'

interface UploadSectionGridProps {
  counts: Record<UploadSectionId, number>
  lastUploads: Record<UploadSectionId, string | null>
  onSelect: (sectionId: UploadSectionId) => void
}

export function UploadSectionGrid({
  counts,
  lastUploads,
  onSelect,
}: UploadSectionGridProps) {
  return (
    <div className="page-content">
      {UPLOAD_CARD_GROUPS.map(group => (
        <div key={group.section} style={{ marginBottom: '0.625rem' }}>
          <div className="section-label" style={{ marginBottom: '0.25rem' }}>{group.section}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.375rem' }}>
            {group.cards.map(card => {
              const Icon = card.icon
              const count = counts[card.id] ?? 0
              const lastUpload = formatUploadDate(lastUploads[card.id] ?? null)

              return (
                <div
                  key={card.id}
                  onClick={() => onSelect(card.id)}
                  style={{
                    background: 'var(--card-bg)',
                    border: `1.5px solid ${card.color}40`,
                    borderRadius: 'var(--r-md)',
                    padding: '0.375rem 0.5rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.transform = 'translateY(-1px)'
                    el.style.borderColor = `${card.color}aa`
                    el.style.boxShadow = `0 2px 8px ${card.color}22`
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.transform = ''
                    el.style.borderColor = `${card.color}40`
                    el.style.boxShadow = ''
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <div style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      backgroundColor: `${card.color}22`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <Icon size={9} color={card.color} />
                    </div>

                    {count > 0 ? (
                      <span style={{
                        fontSize: '0.5625rem',
                        fontWeight: 600,
                        padding: '0.0625rem 0.25rem',
                        borderRadius: 999,
                        background: '#dcfce7',
                        color: '#16a34a',
                      }}>
                        {count}
                      </span>
                    ) : (
                      <span style={{
                        fontSize: '0.5625rem',
                        fontWeight: 600,
                        padding: '0.0625rem 0.25rem',
                        borderRadius: 999,
                        background: 'var(--bg-surface)',
                        color: 'var(--text-muted)',
                        border: '1px solid var(--border)',
                      }}>
                        —
                      </span>
                    )}
                  </div>

                  <div style={{
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    lineHeight: 1.2,
                    marginBottom: '0.125rem',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {card.label}
                  </div>

                  <div style={{
                    fontSize: '0.5625rem',
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {lastUpload ?? 'No data yet'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
