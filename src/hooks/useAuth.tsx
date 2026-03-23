import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'
import type { AuthUser, Profile, Organisation } from '@/types'

interface AuthContextType {
  user: AuthUser | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, orgName: string, fullName: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadUserData(userId: string, email: string) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    let organisation: Organisation | null = null
    if (profile) {
      const { data: org } = await supabase
        .from('organisations')
        .select('*')
        .eq('id', profile.org_id)
        .single()
      organisation = org
    }

    setUser({ id: userId, email, profile, organisation })
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) {
        loadUserData(session.user.id, session.user.email ?? '').finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session)
      if (session?.user) {
        await loadUserData(session.user.id, session.user.email ?? '')
      } else {
        setUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function signUp(email: string, password: string, orgName: string, fullName: string) {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error || !data.user) return { error: error?.message ?? 'Sign up failed' }

    // Create organisation
    const { data: org, error: orgError } = await supabase
      .from('organisations')
      .insert({ name: orgName })
      .select()
      .single()

    if (orgError || !org) return { error: orgError?.message ?? 'Failed to create organisation' }

    // Create profile
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({ id: data.user.id, org_id: org.id, full_name: fullName, role: 'admin' })

    if (profileError) return { error: profileError.message }

    // Create default hedge policy
    await supabase.from('hedge_policies').insert({
      org_id: org.id,
      name: 'Default Policy',
      min_coverage_pct: 60,
      max_coverage_pct: 90,
      min_notional_threshold: 500000,
      min_tenor_days: 30,
      base_currency: 'USD',
    })

    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
