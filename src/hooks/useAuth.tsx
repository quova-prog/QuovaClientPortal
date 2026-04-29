import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { reportMonitoringEvent, reportException } from '@/lib/monitoring'
import type { AuthUser, Organisation, Profile } from '@/types'

type DbClient = SupabaseClient<any, any, any>

interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  db: DbClient
  signIn: (email: string, password: string) => Promise<{
    error: string | null
    mfaRequired?: boolean
    mfaEnforcedSetupRequired?: boolean
    mfaFactorId?: string
    pendingToken?: string
    pendingRefreshToken?: string
    pendingEmail?: string
  }>
  completeMfaSignIn: (
    factorId: string,
    code: string,
    pendingToken?: string,
    pendingRefreshToken?: string,
  ) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, orgName: string, fullName: string) => Promise<{ error: string | null; confirmationRequired?: boolean }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

async function sessionSatisfiesRequiredAal(_session: Session): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error || !data) return false
  // SOC2 requirement: all users MUST have AAL2 (meaning they must enroll in MFA).
  if (data.currentLevel !== 'aal2') return false
  return true
}

function fireAuditLog(_orgId: string, _userId: string, _email: string, action: string, summary: string) {
  void supabase.rpc('write_audit_log', {
    p_action: action,
    p_resource: 'session',
    p_summary: summary,
    p_metadata: {},
  }).then(() => {}, () => {})
}

async function buildAuthUser(session: Session): Promise<AuthUser | null> {
  if (!(await sessionSatisfiesRequiredAal(session))) return null

  const userId = session.user.id
  const email = session.user.email ?? ''

  let { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  // No profile yet — user confirmed their email but onboarding hasn't run.
  // Pull org/name from the metadata stored at signup and complete it now.
  if (profileError || !profile) {
    const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>
    const orgName = typeof meta.org_name === 'string' ? meta.org_name : null
    const fullName = typeof meta.full_name === 'string' ? meta.full_name : null
    if (!orgName || !fullName) return null

    const { error: onboardingError } = await supabase.rpc('onboard_new_user', {
      p_org_name: orgName,
      p_full_name: fullName,
    })
    if (onboardingError) return null

    const { data: retried, error: retriedError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (retriedError || !retried) return null
    profile = retried
  }

  const { data: organisation, error: orgError } = await supabase
    .from('organisations')
    .select('*')
    .eq('id', (profile as Profile).org_id)
    .single()

  if (orgError || !organisation) return null

  return {
    id: userId,
    email,
    profile,
    organisation: organisation as Organisation,
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const syncVersionRef = useRef(0)

  async function syncFromSession(session: Session | null) {
    const syncId = ++syncVersionRef.current

    if (!session) {
      setUser(null)
      setLoading(false)
      return
    }

    const authUser = await buildAuthUser(session)
    if (syncVersionRef.current !== syncId) return
    setUser(authUser)
    setLoading(false)
  }

  useEffect(() => {
    let active = true

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!active) return
        return syncFromSession(session)
      })
      .catch(() => {
        void reportMonitoringEvent({
          category: 'auth',
          severity: 'error',
          message: 'Initial session bootstrap failed',
        })
        if (!active) return
        setUser(null)
        setLoading(false)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      queueMicrotask(() => {
        if (!active) return
        void syncFromSession(session)
      })
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return { error: error.message }
      if (!data.user || !data.session) return { error: 'Invalid email or password' }

      const verifiedFactor = (data.user.factors ?? []).find(
        f => f.status === 'verified' && f.factor_type === 'totp'
      )

      if (verifiedFactor) {
        return {
          error: null,
          mfaRequired: true,
          mfaFactorId: verifiedFactor.id,
          pendingToken: data.session.access_token,
          pendingRefreshToken: data.session.refresh_token,
          pendingEmail: data.user.email ?? email,
        }
      }

      // No verified factor found -> Enforced Setup Required
      return { error: null, mfaEnforcedSetupRequired: true }

    } catch (error) {
      void reportException(error, {
        category: 'auth',
        severity: 'error',
        message: 'Sign-in request failed unexpectedly',
      })
      return { error: 'Sign in failed' }
    }
  }, [])

  const signUp = useCallback(async (email: string, password: string, orgName: string, fullName: string) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { org_name: orgName, full_name: fullName } },
      })
      if (error) return { error: error.message }
      if (!data.user) return { error: 'Sign up failed — please try again' }
      if (!data.session) {
        // Email confirmation is enabled. The confirmation email has been sent;
        // onboarding will complete automatically when the user clicks the link
        // (buildAuthUser detects the missing profile and runs onboard_new_user
        // using the org_name / full_name stored in user metadata above).
        return { error: null, confirmationRequired: true }
      }

      const { error: onboardingError } = await supabase.rpc('onboard_new_user', {
        p_org_name: orgName,
        p_full_name: fullName,
      })
      if (onboardingError) {
        void reportMonitoringEvent({
          category: 'auth',
          severity: 'critical',
          message: 'Signup onboarding failed after auth account creation',
          metadata: { reason: onboardingError.message },
        })
        await supabase.auth.signOut({ scope: 'global' })
        return { error: onboardingError.message }
      }

      // Verify the user was onboarded successfully
      const profileCheck = await supabase.from('profiles').select('org_id').eq('id', data.user.id).maybeSingle()
      if (!profileCheck.data) {
        void reportMonitoringEvent({
          category: 'auth',
          severity: 'critical',
          message: 'Signup onboarding produced no usable app user',
        })
        await supabase.auth.signOut({ scope: 'global' })
        return { error: 'Account created but onboarding could not be completed' }
      }

      // Let onAuthStateChange handle setUser to avoid race condition
      return { error: null }
    } catch (error) {
      void reportException(error, {
        category: 'auth',
        severity: 'error',
        message: 'Sign-up request failed unexpectedly',
      })
      await supabase.auth.signOut({ scope: 'global' }).then(() => {}, () => {})
      return { error: 'Sign up failed' }
    }
  }, [])

  const completeMfaSignIn = useCallback(async (
    factorId: string,
    code: string,
    pendingToken?: string,
    pendingRefreshToken?: string,
  ): Promise<{ error: string | null }> => {
    try {
      // Restore the pending session from signIn so MFA verification has a valid context,
      // even if the session was lost (e.g., another tab signed out, token refresh)
      if (pendingToken && pendingRefreshToken) {
        await supabase.auth.setSession({
          access_token: pendingToken,
          refresh_token: pendingRefreshToken,
        })
      }

      const { data, error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
      if (error) return { error: error.message }
      if (!data) return { error: 'MFA verification failed' }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return { error: 'MFA verification failed' }

      // Let onAuthStateChange handle setUser to avoid race condition
      const userId = session.user.id
      const userEmail = session.user.email ?? ''
      const profileResult = await supabase.from('profiles').select('org_id').eq('id', userId).maybeSingle()
      if (profileResult.data?.org_id) {
        fireAuditLog(profileResult.data.org_id, userId, userEmail, 'login', 'User signed in with MFA')
      }

      return { error: null }
    } catch (error) {
      void reportException(error, {
        category: 'auth',
        severity: 'warning',
        message: 'MFA verification request failed unexpectedly',
      })
      return { error: 'MFA verification failed' }
    }
  }, [])

  const signOut = useCallback(async () => {
    if (user?.profile?.org_id) {
      fireAuditLog(user.profile.org_id, user.id, user.email ?? '', 'logout', 'User signed out')
    }

    await supabase.auth.signOut({ scope: 'global' })
    setUser(null)
  }, [user])

  const contextValue = useMemo(() => ({
    user,
    loading,
    db: supabase as DbClient,
    signIn,
    completeMfaSignIn,
    signUp,
    signOut,
  }), [user, loading, signIn, completeMfaSignIn, signUp, signOut])

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
