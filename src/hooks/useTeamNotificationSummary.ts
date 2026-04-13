import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'

export interface TeamNotifEntry {
  user_id: string
  full_name: string | null
  role: string
  email_urgent: boolean
  email_digest: boolean
  digest_frequency: 'daily' | 'weekly'
}

export function useTeamNotificationSummary() {
  const { user, db } = useAuth()
  const orgId = user?.profile?.org_id
  const isAdmin = user?.profile?.role === 'admin'

  const [entries, setEntries] = useState<TeamNotifEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!orgId || !isAdmin) { setLoading(false); return }
    setLoading(true)

    // Admin can read all notification_preferences in org (via admin SELECT policy)
    const { data: prefs } = await db
      .from('notification_preferences')
      .select('user_id, email_urgent, email_digest, digest_frequency')
      .eq('org_id', orgId)

    // Get profiles for names/roles
    const { data: profiles } = await db
      .from('profiles')
      .select('id, full_name, role')
      .eq('org_id', orgId)

    if (!prefs || !profiles) { setLoading(false); return }

    const profileMap = new Map(profiles.map((p: any) => [p.id, p]))

    const merged: TeamNotifEntry[] = profiles.map((p: any) => {
      const pref = prefs.find((pr: any) => pr.user_id === p.id)
      return {
        user_id: p.id,
        full_name: p.full_name,
        role: p.role,
        email_urgent: pref?.email_urgent ?? false,
        email_digest: pref?.email_digest ?? false,
        digest_frequency: pref?.digest_frequency ?? 'daily',
      }
    })

    setEntries(merged)
    setLoading(false)
  }, [orgId, isAdmin, db])

  useEffect(() => { load() }, [load])

  const noOneHasUrgent = entries.length > 0 && !entries.some(e => e.email_urgent)

  return { entries, loading, isAdmin, noOneHasUrgent, reload: load }
}
