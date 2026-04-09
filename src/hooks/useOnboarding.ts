import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { OnboardingSession, OnboardingStatus, OrganizationProfile } from '@/types'

export interface UseOnboardingResult {
  session: OnboardingSession | null
  profile: OrganizationProfile | null
  loading: boolean
  error: string | null
  advanceStatus: (newStatus: OnboardingStatus, reason?: string) => Promise<boolean>
  reload: () => void
}

export function useOnboarding(): UseOnboardingResult {
  const { user } = useAuth()
  const orgId = user?.profile?.org_id

  const [session, setSession] = useState<OnboardingSession | null>(null)
  const [profile, setProfile] = useState<OrganizationProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId || !user) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      // Fetch or create onboarding session
      let { data: sess, error: sessErr } = await supabase
        .from('onboarding_sessions')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle()

      if (sessErr) throw new Error(sessErr.message)

      if (!sess) {
        const { data: newSess, error: createErr } = await supabase
          .from('onboarding_sessions')
          .insert({ org_id: orgId, status: 'setup', created_by: user.id })
          .select()
          .single()
        if (createErr) throw new Error(createErr.message)
        sess = newSess
      }

      setSession(sess as OnboardingSession)

      // Fetch org profile if it exists
      const { data: prof } = await supabase
        .from('organization_profiles')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle()

      setProfile(prof as OrganizationProfile | null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load onboarding session')
    } finally {
      setLoading(false)
    }
  }, [orgId, user])

  useEffect(() => { void load() }, [load])

  const advanceStatus = useCallback(async (
    newStatus: OnboardingStatus,
    reason = '',
  ): Promise<boolean> => {
    if (!session) return false
    try {
      const { error: rpcErr } = await supabase.rpc('advance_onboarding_status', {
        p_session_id: session.id,
        p_new_status:  newStatus,
        p_reason:      reason,
      })

      if (rpcErr) throw new Error(rpcErr.message)

      setSession(prev => prev ? {
        ...prev,
        status:                  newStatus,
        current_step_started_at: new Date().toISOString(),
        updated_at:              new Date().toISOString(),
        completed_at:            newStatus === 'live' ? new Date().toISOString() : null,
      } : prev)

      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance status')
      return false
    }
  }, [session])

  return { session, profile, loading, error, advanceStatus, reload: load }
}
