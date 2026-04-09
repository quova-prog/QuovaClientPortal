import { Loader2, CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react'
import { format } from 'date-fns'
import type { DiscoveryFeedEvent } from '@/types'

const STAGE_LABELS: Record<DiscoveryFeedEvent['stage'], string> = {
  schema_pull:    'Schema',
  candidate_id:   'Scan',
  sample_pull:    'Sample',
  ai_analysis:    'AI',
  validation:     'Validate',
  preview:        'Preview',
  // ERP path stages
  triage:         'Triage',
  analysis_a:     'Model A',
  analysis_b:     'Model B',
  reconciliation: 'Reconcile',
}

const STATUS_COLOR: Record<DiscoveryFeedEvent['status'], string> = {
  running:   'var(--blue)',
  completed: 'var(--green)',
  warning:   'var(--amber)',
  error:     'var(--red)',
}

interface DiscoveryEventRowProps {
  event: DiscoveryFeedEvent
}

export function DiscoveryEventRow({ event }: DiscoveryEventRowProps): React.ReactElement {
  const Icon = {
    running:   Loader2,
    completed: CheckCircle2,
    warning:   AlertTriangle,
    error:     XCircle,
  }[event.status]

  const color = STATUS_COLOR[event.status]

  // Extract chip data (column names, etc.)
  const chips: string[] = []
  if (Array.isArray(event.data?.columns)) chips.push(...(event.data.columns as string[]).slice(0, 6))
  if (Array.isArray(event.data?.currency_columns)) chips.push(...(event.data.currency_columns as string[]).slice(0, 4))

  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start',
      padding: '0.55rem 0',
      borderBottom: '1px solid var(--border-dim)',
      animation: 'fadeIn 0.2s ease',
    }}>
      <div style={{ marginTop: 1, flexShrink: 0 }}>
        <Icon
          size={14}
          color={color}
          style={event.status === 'running' ? { animation: 'spin 1s linear infinite' } : undefined}
        />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Stage + timestamp */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{
            fontSize: '0.65rem', fontWeight: 700, color,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {STAGE_LABELS[event.stage]}
          </span>
          <span style={{
            fontSize: '0.65rem', color: 'var(--text-muted)',
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            <Clock size={9} />
            {format(new Date(event.timestamp), 'HH:mm:ss')}
          </span>
        </div>

        {/* Message */}
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.45 }}>
          {event.message}
        </p>

        {/* Data chips */}
        {chips.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 5 }}>
            {chips.map((chip, i) => (
              <span key={i} className="badge badge-gray" style={{ fontSize: '0.62rem', padding: '1px 5px' }}>
                {chip}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
