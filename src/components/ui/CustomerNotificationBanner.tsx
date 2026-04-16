import { useNavigate } from 'react-router-dom'
import { X, ArrowRight } from 'lucide-react'
import { useCustomerNotifications } from '../../hooks/useCustomerNotifications'

export function CustomerNotificationBanner() {
  const { notifications, dismiss } = useCustomerNotifications()
  const navigate = useNavigate()

  if (notifications.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
      {notifications.map(n => (
        <div
          key={n.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            background: 'var(--teal-dim)',
            border: '1px solid var(--teal)',
            borderRadius: 'var(--r-md)',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', marginBottom: 2 }}>{n.title}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{n.message}</div>
          </div>
          {n.cta_url && (
            <button className="btn btn-primary btn-sm" onClick={() => navigate(n.cta_url!)}>
              Take Action <ArrowRight size={12} />
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => dismiss(n.id)}
            style={{ padding: 4 }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
