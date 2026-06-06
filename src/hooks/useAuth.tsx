import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth as useAuthKit } from '@workos-inc/authkit-react'
import type { User as WorkosUser } from '@workos-inc/authkit-react'
import type { SupabaseClient, Session } from '@supabase/supabase-js'
import { setSupabaseAccessTokenProvider, supabase } from '@/lib/supabase'
import { loadRuntimeWorkosAuthConfig, type WorkosAuthConfig } from '@/lib/workosConfig'
import { reportMonitoringEvent, reportException } from '@/lib/monitoring'
import type { AuthUser, Organisation, Profile } from '@/types'

// Keep the shared client broad because many legacy data hooks still carry
// hand-written row types that do not exactly match the generated schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  signUp: (email: string, password: string, orgName: string, fullName: string, inviteId?: string | null) => Promise<{ error: string | null; confirmationRequired?: boolean }>
  signOut: () => Promise<void>
}

type SyncCurrentUserResult = {
  ok: true
  action: 'created' | 'updated'
  profile_id: string
  org_id: string
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

async function buildSupabaseAuthUser(session: Session): Promise<AuthUser | null> {
  if (!(await sessionSatisfiesRequiredAal(session))) return null

  const userId = session.user.id
  const email = session.user.email ?? ''

  let { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  // No profile yet: user confirmed their email, but onboarding has not run.
  // Use signup metadata to finish the existing Supabase Auth bootstrap path.
  if (profileError || !profile) {
    const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>
    const fullName = typeof meta.full_name === 'string' ? meta.full_name : null
    const inviteId = typeof meta.invite_id === 'string' ? meta.invite_id : null

    if (inviteId && fullName) {
      const { error: inviteError } = await supabase.rpc('accept_invite', {
        p_invite_id: inviteId,
      })
      if (inviteError) return null
    } else {
      const orgName = typeof meta.org_name === 'string' ? meta.org_name : null
      if (!orgName || !fullName) return null

      const { error: onboardingError } = await supabase.rpc('onboard_new_user', {
        p_org_name: orgName,
        p_full_name: fullName,
      })
      if (onboardingError) return null
    }

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
    profile: profile as unknown as Profile,
    organisation: organisation as unknown as Organisation,
  }
}

async function buildWorkosAuthUser(authKitUser: WorkosUser, syncResult: SyncCurrentUserResult): Promise<AuthUser | null> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', syncResult.profile_id)
    .single()

  if (profileError || !profile) return null

  const { data: organisation, error: orgError } = await supabase
    .from('organisations')
    .select('*')
    .eq('id', (profile as Profile).org_id)
    .single()

  if (orgError || !organisation) return null

  return {
    id: (profile as Profile).id,
    email: authKitUser.email,
    profile: profile as unknown as Profile,
    organisation: organisation as unknown as Organisation,
  }
}

export function AuthProvider({
  children,
  config = loadRuntimeWorkosAuthConfig(),
}: {
  children: React.ReactNode
  config?: WorkosAuthConfig
}) {
  if (config.provider === 'workos') return <WorkosAuthProvider>{children}</WorkosAuthProvider>
  return <SupabaseAuthProvider>{children}</SupabaseAuthProvider>
}

function SupabaseAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const syncVersionRef = useRef(0)

  useEffect(() => {
    setSupabaseAccessTokenProvider(null)
  }, [])

  async function syncFromSession(session: Session | null) {
    const syncId = ++syncVersionRef.current

    if (!session) {
      setUser(null)
      setLoading(false)
      return
    }

    const authUser = await buildSupabaseAuthUser(session)
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

  const signUp = useCallback(async (email: string, password: string, orgName: string, fullName: string, inviteId?: string | null) => {
    try {
      if (!inviteId && !orgName.trim()) return { error: 'Organization name is required' }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: inviteId
            ? { invite_id: inviteId, full_name: fullName }
            : { org_name: orgName, full_name: fullName },
        },
      })
      if (error) return { error: error.message }
      if (!data.user) return { error: 'Sign up failed — please try again' }
      if (!data.session) {
        return { error: null, confirmationRequired: true }
      }

      const setupResult = inviteId
        ? await supabase.rpc('accept_invite', { p_invite_id: inviteId })
        : await supabase.rpc('onboard_new_user', {
          p_org_name: orgName,
          p_full_name: fullName,
        })
      const onboardingError = setupResult.error
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

function WorkosAuthProvider({ children }: { children: React.ReactNode }) {
  const {
    getAccessToken,
    isLoading: authKitLoading,
    signIn: authKitSignIn,
    signOut: authKitSignOut,
    signUp: authKitSignUp,
    user: authKitUser,
  } = useAuthKit()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [dbClient, setDbClient] = useState<DbClient>(supabase as DbClient)
  const syncVersionRef = useRef(0)

  useEffect(() => {
    setSupabaseAccessTokenProvider(async () => {
      try {
        return await getAccessToken()
      } catch {
        return null
      }
    })
    setDbClient(supabase as DbClient)

    return () => {
      setSupabaseAccessTokenProvider(null)
    }
  }, [getAccessToken])

  const syncWorkosUser = useCallback(async () => {
    const syncId = ++syncVersionRef.current

    if (authKitLoading) {
      setLoading(true)
      return
    }

    if (!authKitUser) {
      setUser(null)
      setLoading(false)
      return
    }

    setLoading(true)

    try {
      const accessToken = await getAccessToken()
      const { data, error } = await supabase.functions.invoke('sync-current-user', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (error) throw error
      const syncResult = data as SyncCurrentUserResult | null
      if (!syncResult?.ok) throw new Error('WorkOS user sync failed')

      const authUser = await buildWorkosAuthUser(authKitUser, syncResult)
      if (syncVersionRef.current !== syncId) return
      setUser(authUser)
      setLoading(false)
    } catch (error) {
      void reportException(error, {
        category: 'auth',
        severity: 'error',
        message: 'WorkOS session bootstrap failed',
      })
      if (syncVersionRef.current !== syncId) return
      setUser(null)
      setLoading(false)
    }
  }, [authKitLoading, authKitUser, getAccessToken])

  useEffect(() => {
    void syncWorkosUser()
  }, [syncWorkosUser])

  const signIn = useCallback(async (email: string) => {
    try {
      await authKitSignIn({
        ...(email.trim() ? { loginHint: email.trim() } : {}),
      })
      return { error: null }
    } catch (error) {
      void reportException(error, {
        category: 'auth',
        severity: 'error',
        message: 'WorkOS sign-in request failed unexpectedly',
      })
      return { error: 'Sign in failed' }
    }
  }, [authKitSignIn])

  const signUp = useCallback(async (email: string, _password: string, _orgName: string, _fullName: string, inviteId?: string | null) => {
    try {
      await authKitSignUp({
        ...(email.trim() ? { loginHint: email.trim() } : {}),
        ...(inviteId ? { invitationToken: inviteId } : {}),
      })
      return { error: null }
    } catch (error) {
      void reportException(error, {
        category: 'auth',
        severity: 'error',
        message: 'WorkOS sign-up request failed unexpectedly',
      })
      return { error: 'Sign up failed' }
    }
  }, [authKitSignUp])

  const completeMfaSignIn = useCallback(async (): Promise<{ error: string | null }> => {
    return { error: null }
  }, [])

  const signOut = useCallback(async () => {
    if (user?.profile?.org_id) {
      fireAuditLog(user.profile.org_id, user.id, user.email ?? '', 'logout', 'User signed out')
    }

    const returnTo = typeof window === 'undefined' ? undefined : window.location.origin
    await authKitSignOut({ returnTo, navigate: false })
    setUser(null)
  }, [authKitSignOut, user])

  const contextValue = useMemo(() => ({
    user,
    loading: loading || authKitLoading,
    db: dbClient,
    signIn,
    completeMfaSignIn,
    signUp,
    signOut,
  }), [user, loading, authKitLoading, dbClient, signIn, completeMfaSignIn, signUp, signOut])

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
