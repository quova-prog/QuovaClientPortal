import { useEffect, useState, useCallback } from 'react'
import { useAuth } from './useAuth'

interface CustomerNotification {
  id: string
  org_id: string
  gap_type: string
  title: string
  message: string
  cta_url: string | null
  created_at: string
  acknowledged_at: string | null
}

export function useCustomerNotifications() {
  const { user, db } = useAuth()
  const orgId = user?.profile?.org_id
  const [notifications, setNotifications] = useState<CustomerNotification[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!orgId || !db) return

    const { data } = await db
      .from('customer_notifications')
      .select('*')
      .eq('org_id', orgId)
      .is('acknowledged_at', null)
      .order('created_at', { ascending: false })
      .limit(5)

    setNotifications(data ?? [])
    setLoading(false)
  }, [orgId, db])

  useEffect(() => {
    reload()
  }, [reload])

  const dismiss = useCallback(async (id: string) => {
    if (!db) return
    await db
      .from('customer_notifications')
      .update({ acknowledged_at: new Date().toISOString() })
      .eq('id', id)

    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [db])

  return { notifications, loading, dismiss, reload }
}
