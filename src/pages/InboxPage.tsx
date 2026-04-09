import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell, AlertTriangle, Clock, CheckCircle2, X, ChevronRight, Info,
} from 'lucide-react'
import { useAlerts } from '@/hooks/useAlerts'
import { useAlertGenerator } from '@/hooks/useAlertGenerator'
import type { Alert } from '@/hooks/useAlerts'

type FilterKey = 'all' | 'urgent' | 'warning' | 'info'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7)  return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function typeBadgeLabel(type: string): string {
  const map: Record<string, string> = {
    policy_breach:      'Policy Breach',
    maturing_position:  'Maturing Position',
    cash_flow_due:      'Cash Flow',
    unhedged_exposure:  'Unhedged Exposure',
  }
  return map[type] ?? 'Alert'
}

function SeverityIcon({ severity }: { severity: Alert['severity'] }) {
  const props = { size: 15, style: { flexShrink: 0 } as React.CSSProperties }
  if (severity === 'urgent')  return <AlertTriangle {...props} color="var(--red)"   />
  if (severity === 'warning') return <Clock         {...props} color="var(--amber)" />
  return                              <Info          {...props} color="var(--teal)"  />
}

function severityBorderColor(severity: Alert['severity']): string {
  if (severity === 'urgent')  return 'var(--red)'
  if (severity === 'warning') return 'var(--amber)'
  return 'var(--teal)'
}

export function InboxPage() {
  // Trigger alert generation when Inbox is visited
  useAlertGenerator()

  const { alerts, loading, unreadCount, canWrite, markRead, markAllRead, dismiss, dismissAll } = useAlerts()
  const [filter, setFilter] = useState<FilterKey>('all')

  const urgentCount  = alerts.filter(a => a.severity === 'urgent').length
  const warningCount = alerts.filter(a => a.severity === 'warning').length
  const infoCount    = alerts.filter(a => a.severity === 'info').length

  const filtered = filter === 'all'
    ? alerts
    : alerts.filter(a => a.severity === filter)

  const resolvedAlerts = alerts.filter(a => a.resolved_at !== null)

  const filterTabs: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all',     label: 'All',     count: alerts.length  },
    { key: 'urgent',  label: 'Urgent',  count: urgentCount    },
    { key: 'warning', label: 'Warning', count: warningCount   },
    { key: 'info',    label: 'Info',    count: infoCount       },
  ]

  return (
    <div className="fade-in">
      {/* Page header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <Bell size={18} color="var(--teal)" />
          <div>
            <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Inbox
            </h1>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: 0 }}>
              Action items requiring your attention
            </p>
          </div>
        </div>
        {canWrite && unreadCount > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={markAllRead}>
            Mark all read
          </button>
        )}
      </div>

      <div className="page-content">
        <div style={{
          display: 'grid',
          gridTemplateColumns: '200px 1fr',
          gap: '1rem',
          alignItems: 'start',
        }}>

          {/* Left sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {/* Filter tabs */}
            <div className="card" style={{ padding: '0.5rem' }}>
              <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.25rem 0.5rem 0.375rem' }}>
                Filter
              </div>
              {filterTabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setFilter(tab.key)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.4rem 0.625rem',
                    borderRadius: 'var(--r-sm)',
                    border: 'none',
                    cursor: 'pointer',
                    background: filter === tab.key ? 'rgba(0,200,160,0.1)' : 'transparent',
                    color: filter === tab.key ? 'var(--teal)' : 'var(--text-primary)',
                    fontSize: '0.8125rem',
                    fontWeight: filter === tab.key ? 600 : 400,
                    textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                >
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <span style={{
                      background: filter === tab.key ? 'var(--teal)' : 'var(--border)',
                      color: filter === tab.key ? '#fff' : 'var(--text-muted)',
                      borderRadius: '999px',
                      fontSize: '0.625rem',
                      fontWeight: 700,
                      minWidth: 18,
                      height: 18,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 5px',
                    }}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Stats */}
            <div className="card" style={{ padding: '0.75rem' }}>
              <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                Summary
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Unread</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: unreadCount > 0 ? 'var(--red)' : 'var(--text-muted)' }}>{unreadCount}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Urgent</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: urgentCount > 0 ? 'var(--red)' : 'var(--text-muted)' }}>{urgentCount}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Warning</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: warningCount > 0 ? 'var(--amber)' : 'var(--text-muted)' }}>{warningCount}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Resolved</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>{resolvedAlerts.length}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right content — alert list */}
          <div>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Card header */}
              <div style={{
                padding: '0.75rem 1.25rem',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                  {filter === 'all' ? 'All Alerts' : filter === 'urgent' ? 'Urgent' : filter === 'warning' ? 'Warnings' : 'Info'}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.375rem', fontSize: '0.8125rem' }}>
                    ({filtered.length})
                  </span>
                </span>
                {loading && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Loading…</span>
                )}
              </div>

              {/* Empty state */}
              {!loading && filtered.length === 0 && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '4rem 2rem',
                  gap: '0.75rem',
                }}>
                  <div style={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background: 'rgba(0,200,160,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <Bell size={24} color="var(--teal)" />
                  </div>
                  <h3 style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)', margin: 0 }}>
                    All clear
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0, textAlign: 'center' }}>
                    No action items at this time
                  </p>
                </div>
              )}

              {/* Alert list */}
              {filtered.length > 0 && (
                <div>
                  {filtered.map((alert, i) => (
                    <AlertCard
                      key={alert.id}
                      alert={alert}
                      isLast={i === filtered.length - 1}
                      onRead={canWrite ? () => markRead(alert.id) : undefined}
                      onDismiss={canWrite ? () => dismiss(alert.id) : undefined}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Dismiss all resolved */}
            {canWrite && resolvedAlerts.length > 0 && (
              <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    resolvedAlerts.forEach(a => dismiss(a.id))
                  }}
                  style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}
                >
                  Dismiss all resolved ({resolvedAlerts.length})
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Responsive: stack on mobile */}
      <style>{`
        @media (max-width: 640px) {
          .inbox-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}

// ── Alert Card ────────────────────────────────────────────────────────────────

interface AlertCardProps {
  alert: Alert
  isLast: boolean
  onRead?: () => void
  onDismiss?: () => void
}

function AlertCard({ alert, isLast, onRead, onDismiss }: AlertCardProps) {
  const borderColor = severityBorderColor(alert.severity)

  return (
    <div
      style={{
        borderBottom: isLast ? 'none' : '1px solid var(--border)',
        borderLeft: `3px solid ${borderColor}`,
        background: alert.is_read ? 'transparent' : 'rgba(14,165,233,0.025)',
        transition: 'background 0.2s',
        cursor: 'pointer',
      }}
      onClick={onRead}
    >
      <div style={{
        padding: '0.875rem 1rem 0.875rem 1rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.75rem',
      }}>
        {/* Unread dot + severity icon */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.375rem', paddingTop: '0.125rem', flexShrink: 0 }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: alert.is_read ? 'transparent' : 'var(--teal)',
            border: alert.is_read ? '1.5px solid var(--border)' : 'none',
            flexShrink: 0,
          }} />
          <SeverityIcon severity={alert.severity} />
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
            <span style={{
              fontWeight: alert.is_read ? 500 : 700,
              fontSize: '0.875rem',
              color: 'var(--text-primary)',
            }}>
              {alert.title}
            </span>
            <span style={{
              fontSize: '0.6875rem',
              fontWeight: 600,
              padding: '0.125rem 0.5rem',
              borderRadius: '999px',
              background: 'var(--bg-surface, rgba(255,255,255,0.05))',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}>
              {typeBadgeLabel(alert.type)}
            </span>
            {alert.resolved_at && (
              <span style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                padding: '0.125rem 0.5rem',
                borderRadius: '999px',
                background: 'rgba(34,197,94,0.1)',
                color: '#22c55e',
                border: '1px solid rgba(34,197,94,0.25)',
              }}>
                Resolved
              </span>
            )}
          </div>
          <p style={{
            fontSize: '0.8125rem',
            color: 'var(--text-muted)',
            margin: '0 0 0.5rem',
            lineHeight: 1.5,
          }}>
            {alert.body}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {relativeTime(alert.created_at)}
            </span>
            {alert.href && (
              <Link
                to={alert.href}
                onClick={e => e.stopPropagation()}
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  color: 'var(--teal)',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.2rem',
                }}
              >
                View <ChevronRight size={12} />
              </Link>
            )}
          </div>
        </div>

        {/* Dismiss button */}
        {onDismiss && (
          <button
            onClick={e => { e.stopPropagation(); onDismiss() }}
            title="Dismiss"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '0.25rem',
              borderRadius: 'var(--r-sm)',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
