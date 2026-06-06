import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth as useAuthKit } from '@workos-inc/authkit-react'
import type { User as WorkosUser } from '@workos-inc/authkit-react'
import type { SupabaseClient, Session } from '@supabase/supabase-js'
import { setSupabaseAccessTokenProvider, supabase } from '@/lib/supabase'
import { loadRuntimeWorkosAuthConfig, type AuthProvider as AuthProviderKind, type WorkosAuthConfig } from '@/lib/workosConfig'
import { reportMonitoringEvent, reportException } from '@/lib/monitoring'
import type { AuthUser, Organisation, Profile } from '@/types'

// Keep the shared client broad because many legacy data hooks still carry
// hand-written row types that do not exactly match the generated schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = SupabaseClient<any, any, any>

interface AuthContextType {
  provider: AuthProviderKind
  user: AuthUser | null
  loading: boolean
  authError: AuthDiagnostic | null
  workosProvisionRequired: boolean
  db: DbClient
  signIn: (email: string, password: string, inviteToken?: string | null) => Promise<{
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
  acceptInvite: (inviteToken: string) => Promise<{ error: string | null }>
  provisionOrg: (orgName: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

type SyncCurrentUserResult = {
  ok: true
  action: 'created' | 'updated'
  profile_id: string
  org_id: string
}

type AuthDiagnostic = {
  code: string
  message: string
  detail?: string
}

class AuthBootstrapError extends Error {
  code: string
  detail?: string

  constructor(code: string, message: string, detail?: string) {
    super(message)
    this.name = 'AuthBootstrapError'
    this.code = code
    this.detail = detail
  }
}

const AuthContext = createContext<AuthContextType | null>(null)

function errorDetail(error: unknown): string | undefined {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return undefined
}

function toAuthDiagnostic(error: unknown, fallbackCode: string, fallbackMessage: string): AuthDiagnostic {
  if (error instanceof AuthBootstrapError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.detail ? { detail: error.detail } : {}),
    }
  }

  return {
    code: fallbackCode,
    message: fallbackMessage,
    ...(errorDetail(error) ? { detail: errorDetail(error) } : {}),
  }
}

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

async function buildWorkosAuthUser(authKitUser: WorkosUser, syncResult: SyncCurrentUserResult): Promise<AuthUser> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', syncResult.profile_id)
    .single()

  if (profileError) {
    throw new AuthBootstrapError(
      'workos_profile_read_failed',
      'The synced profile could not be loaded.',
      profileError.message,
    )
  }
  if (!profile) {
    throw new AuthBootstrapError(
      'workos_profile_missing',
      'The WorkOS sync finished, but no local profile was returned.',
    )
  }

  const { data: organisation, error: orgError } = await supabase
    .from('organisations')
    .select('*')
    .eq('id', (profile as Profile).org_id)
    .single()

  if (orgError) {
    throw new AuthBootstrapError(
      'workos_organization_read_failed',
      'The synced organization could not be loaded.',
      orgError.message,
    )
  }
  if (!organisation) {
    throw new AuthBootstrapError(
      'workos_organization_missing',
      'The WorkOS sync finished, but no local organization was returned.',
    )
  }

  const profileEmail = (profile as { email?: string | null }).email
  return {
    id: (profile as Profile).id,
    email: authKitUser.email ?? profileEmail ?? '',
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

  const acceptInvite = useCallback(async (inviteToken: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.rpc('accept_invite', { p_invite_id: inviteToken })
    return { error: error?.message ?? null }
  }, [])

  const provisionOrg = useCallback(async (): Promise<{ error: string | null }> => {
    return { error: 'Organization provisioning requires WorkOS sign-in' }
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
    provider: 'supabase' as AuthProviderKind,
    user,
    loading,
    authError: null,
    workosProvisionRequired: false,
    db: supabase as DbClient,
    signIn,
    completeMfaSignIn,
    signUp,
    acceptInvite,
    provisionOrg,
    signOut,
  }), [user, loading, signIn, completeMfaSignIn, signUp, acceptInvite, provisionOrg, signOut])

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
    organizationId: authKitOrganizationId,
    signIn: authKitSignIn,
    signOut: authKitSignOut,
    signUp: authKitSignUp,
    switchToOrganization: authKitSwitchToOrganization,
    user: authKitUser,
  } = useAuthKit()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<AuthDiagnostic | null>(null)
  const [workosProvisionRequired, setWorkosProvisionRequired] = useState(false)
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
      setWorkosProvisionRequired(false)
      setAuthError(null)
      setUser(null)
      setLoading(false)
      return
    }

    if (!authKitOrganizationId) {
      setWorkosProvisionRequired(true)
      setAuthError(null)
      setUser(null)
      setLoading(false)
      return
    }

    setWorkosProvisionRequired(false)
    setAuthError(null)
    setLoading(true)

    try {
      const accessToken = await getAccessToken()
      if (!accessToken) {
        throw new AuthBootstrapError(
          'workos_access_token_missing',
          'WorkOS did not return an access token for the signed-in session.',
        )
      }

      const { data, error } = await supabase.functions.invoke('sync-current-user', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (error) {
        throw new AuthBootstrapError(
          'workos_sync_invoke_failed',
          'Quova could not call the WorkOS user sync function.',
          error.message,
        )
      }

      const syncResult = data as (SyncCurrentUserResult & { error?: string }) | null
      if (!syncResult?.ok) {
        throw new AuthBootstrapError(
          'workos_sync_rejected',
          syncResult?.error ?? 'The WorkOS user sync function did not accept this session.',
        )
      }

      const authUser = await buildWorkosAuthUser(authKitUser, syncResult)
      if (syncVersionRef.current !== syncId) return
      setUser(authUser)
      setLoading(false)
    } catch (error) {
      const diagnostic = toAuthDiagnostic(
        error,
        'workos_bootstrap_failed',
        'The WorkOS session could not be connected to Quova.',
      )
      void reportException(error, {
        category: 'auth',
        severity: 'error',
        message: 'WorkOS session bootstrap failed',
        metadata: {
          code: diagnostic.code,
          detail: diagnostic.detail,
        },
      })
      if (syncVersionRef.current !== syncId) return
      setAuthError(diagnostic)
      setUser(null)
      setLoading(false)
    }
  }, [authKitLoading, authKitOrganizationId, authKitUser, getAccessToken])

  useEffect(() => {
    void syncWorkosUser()
  }, [syncWorkosUser])

  const signIn = useCallback(async (email: string, _password: string, inviteToken?: string | null) => {
    try {
      await authKitSignIn({
        ...(email.trim() ? { loginHint: email.trim() } : {}),
        ...(inviteToken ? { invitationToken: inviteToken } : {}),
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

  const acceptInvite = useCallback(async (inviteToken: string): Promise<{ error: string | null }> => {
    try {
      if (!inviteToken.trim()) return { error: 'Invalid invitation' }
      const options = { invitationToken: inviteToken.trim() }
      if (authKitUser) await authKitSignIn(options)
      else await authKitSignUp(options)
      return { error: null }
    } catch (error) {
      void reportException(error, {
        category: 'auth',
        severity: 'error',
        message: 'WorkOS invite acceptance redirect failed unexpectedly',
      })
      return { error: 'Invitation could not be opened' }
    }
  }, [authKitSignIn, authKitSignUp, authKitUser])

  const provisionOrg = useCallback(async (orgName: string): Promise<{ error: string | null }> => {
    const trimmed = orgName.trim()
    if (trimmed.length < 2) return { error: 'Organization name is required' }

    try {
      const accessToken = await getAccessToken()
      const { data, error } = await supabase.functions.invoke('provision-org', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { org_name: trimmed },
      })

      if (error) return { error: error.message }
      const result = data as { ok?: boolean; error?: string; workos_org_id?: string } | null
      if (!result?.ok || !result.workos_org_id) {
        return { error: result?.error ?? 'Organization could not be provisioned' }
      }

      await authKitSwitchToOrganization({ organizationId: result.workos_org_id })
      return { error: null }
    } catch (error) {
      void reportException(error, {
        category: 'auth',
        severity: 'error',
        message: 'WorkOS organization provisioning failed unexpectedly',
      })
      return { error: 'Organization could not be provisioned' }
    }
  }, [authKitSwitchToOrganization, getAccessToken])

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
    provider: 'workos' as AuthProviderKind,
    user,
    loading: loading || authKitLoading,
    authError,
    workosProvisionRequired,
    db: dbClient,
    signIn,
    completeMfaSignIn,
    signUp,
    acceptInvite,
    provisionOrg,
    signOut,
  }), [user, loading, authKitLoading, authError, workosProvisionRequired, dbClient, signIn, completeMfaSignIn, signUp, acceptInvite, provisionOrg, signOut])

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
