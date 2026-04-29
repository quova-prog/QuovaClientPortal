import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'
import { canAccess, normalizePlan } from '@/lib/tierService'

export interface NotificationPreferences {
  id: string
  email_urgent: boolean
  email_digest: boolean
  digest_frequency: 'daily' | 'weekly'
  digest_time: number
  alert_types: string[]
}

const ALL_ALERT_TYPES = ['policy_breach', 'maturing_position', 'cash_flow_due', 'unhedged_exposure']

function getDefaultPrefs(role?: string): Omit<NotificationPreferences, 'id'> {
  // Convert 8 AM local time to UTC hour for the database
  const tzOffsetMinutes = new Date().getTimezoneOffset()
  const tzOffsetHours = -tzOffsetMinutes / 60
  const localToUtc = (localHour: number) => ((localHour + 24 - Math.round(tzOffsetHours)) % 24)
  const defaultDigestTime = localToUtc(8)

  switch (role) {
    case 'admin':
      return { email_urgent: true, email_digest: true, digest_frequency: 'daily', digest_time: defaultDigestTime, alert_types: ALL_ALERT_TYPES }
    case 'editor':
      return { email_urgent: true, email_digest: false, digest_frequency: 'daily', digest_time: defaultDigestTime, alert_types: ALL_ALERT_TYPES }
    case 'viewer':
    default:
      return { email_urgent: false, email_digest: false, digest_frequency: 'daily', digest_time: defaultDigestTime, alert_types: ['policy_breach'] }
  }
}

export function useNotificationPreferences() {
  const { user, db } = useAuth()
  const orgId = user?.profile?.org_id
  const userId = user?.id

  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const userRole = user?.profile?.role
  const orgPlan = normalizePlan(user?.organisation?.plan)
  const isGated = !canAccess(orgPlan, 'email_notifications')

  const load = useCallback(async () => {
    if (!userId || !orgId) { setLoading(false); return }
    setLoading(true)

    const { data, error: fetchError } = await db
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (fetchError) {
      // Graceful fallback if table doesn't exist yet (migration not applied)
      if (fetchError.message.includes('schema cache') || fetchError.code === '42P01') {
        setPrefs({ id: 'pending', ...getDefaultPrefs(userRole) })
        setError(null)
        setLoading(false)
        return
      }
      setError(fetchError.message)
      setLoading(false)
      return
    }

    if (data) {
      setPrefs(data as NotificationPreferences)
    } else {
      // Auto-create default row
      const { data: inserted, error: insertError } = await db
        .from('notification_preferences')
        .insert({ user_id: userId, org_id: orgId, ...getDefaultPrefs(userRole) })
        .select('*')
        .single()

      if (insertError) {
        // Graceful fallback if table doesn't exist yet
        if (insertError.message.includes('schema cache') || insertError.code === '42P01') {
          setPrefs({ id: 'pending', ...getDefaultPrefs(userRole) })
          setError(null)
          setLoading(false)
          return
        }
        setError(insertError.message)
      } else {
        setPrefs(inserted as NotificationPreferences)
      }
    }
    setLoading(false)
  }, [userId, orgId, userRole, db])

  useEffect(() => { load() }, [load])

  async function update(partial: Partial<Omit<NotificationPreferences, 'id'>>): Promise<boolean> {
    if (!userId || !prefs) return false

    // Optimistic update (also handles pre-migration graceful mode)
    setPrefs(prev => prev ? { ...prev, ...partial } : prev)

    // If table doesn't exist yet, just update locally
    if (prefs.id === 'pending') return true

    setSaving(true)
    setError(null)

    const { error: updateError } = await db
      .from('notification_preferences')
      .update(partial)
      .eq('user_id', userId)

    if (updateError) {
      // Graceful fallback — keep local state
      if (updateError.message.includes('schema cache') || updateError.code === '42P01') {
        setSaving(false)
        return true
      }
      setError(updateError.message)
      setSaving(false)
      return false
    }

    setSaving(false)
    return true
  }

  return { prefs, loading, saving, error, isGated, update, reload: load }
}
