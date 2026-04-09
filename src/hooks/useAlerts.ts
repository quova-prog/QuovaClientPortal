import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'

export interface Alert {
  id: string
  alert_key: string
  type: string
  severity: 'urgent' | 'warning' | 'info'
  title: string
  body: string
  href: string | null
  metadata: Record<string, unknown>
  is_read: boolean
  is_dismissed: boolean
  resolved_at: string | null
  created_at: string
}

export function useAlerts() {
  const { user, db } = useAuth()
  const orgId = user?.profile?.org_id
  const canWrite = user?.profile?.role === 'admin' || user?.profile?.role === 'editor'

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    const { data } = await db
      .from('alerts')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_dismissed', false)
      .order('created_at', { ascending: false })
    setAlerts(data ?? [])
    setLoading(false)
  }, [orgId, db])

  useEffect(() => { load() }, [load])

  // Upsert an alert (insert or update if alert_key already exists)
  async function upsertAlert(alert: Omit<Alert, 'id' | 'is_read' | 'is_dismissed' | 'resolved_at' | 'created_at'>): Promise<void> {
    if (!orgId || !canWrite) return
    await db
      .from('alerts')
      .upsert(
        { ...alert, org_id: orgId, updated_at: new Date().toISOString() },
        { onConflict: 'org_id,alert_key', ignoreDuplicates: false }
      )
    // Don't reload here — caller manages reloading
  }

  // Resolve an alert (the condition is gone — mark resolved but keep visible until dismissed)
  async function resolveAlert(alertKey: string): Promise<void> {
    if (!orgId || !canWrite) return
    await db
      .from('alerts')
      .update({ resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('org_id', orgId)
      .eq('alert_key', alertKey)
      .is('resolved_at', null)
  }

  async function markRead(id: string): Promise<void> {
    if (!canWrite) return
    await db.from('alerts').update({ is_read: true }).eq('id', id)
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, is_read: true } : a))
  }

  async function markAllRead(): Promise<void> {
    if (!orgId || !canWrite) return
    await db.from('alerts').update({ is_read: true }).eq('org_id', orgId).eq('is_dismissed', false)
    setAlerts(prev => prev.map(a => ({ ...a, is_read: true })))
  }

  async function dismiss(id: string): Promise<void> {
    if (!canWrite) return
    await db.from('alerts').update({ is_dismissed: true, is_read: true }).eq('id', id)
    setAlerts(prev => prev.filter(a => a.id !== id))
  }

  async function dismissAll(): Promise<void> {
    if (!orgId || !canWrite) return
    await db.from('alerts').update({ is_dismissed: true, is_read: true }).eq('org_id', orgId)
    setAlerts([])
  }

  const unreadCount = alerts.filter(a => !a.is_read).length

  return { alerts, loading, unreadCount, canWrite, upsertAlert, resolveAlert, markRead, markAllRead, dismiss, dismissAll, reload: load }
}
