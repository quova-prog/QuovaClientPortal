import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'

export interface MfaFactor {
  id: string
  friendly_name: string
  factor_type: string
  status: string
}

export function useMfa() {
  useAuth()

  async function enroll(): Promise<{ factorId: string; totpUri: string; error: string | null }> {
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        friendlyName: 'Quova MFA',
        factorType: 'totp',
      })
      if (error) return { factorId: '', totpUri: '', error: error.message }
      return {
        factorId: data.id ?? '',
        totpUri: data.totp?.uri ?? '',
        error: null,
      }
    } catch (err) {
      return { factorId: '', totpUri: '', error: err instanceof Error ? err.message : 'Enrollment failed' }
    }
  }

  async function challenge(factorId: string): Promise<{ challengeId: string; error: string | null }> {
    try {
      const { data, error } = await supabase.auth.mfa.challenge({ factorId })
      if (error) return { challengeId: '', error: error.message }
      return { challengeId: data.id ?? '', error: null }
    } catch (err) {
      return { challengeId: '', error: err instanceof Error ? err.message : 'Challenge failed' }
    }
  }

  async function verify(factorId: string, challengeId: string, code: string): Promise<{ error: string | null }> {
    try {
      const { error } = await supabase.auth.mfa.verify({ factorId, challengeId, code })
      return { error: error?.message ?? null }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Verification failed' }
    }
  }

  async function unenroll(factorId: string): Promise<{ error: string | null }> {
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId })
      return { error: error?.message ?? null }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Unenroll failed' }
    }
  }

  async function listFactors(): Promise<{ factors: MfaFactor[]; error: string | null }> {
    try {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) return { factors: [], error: error.message }
      const factors: MfaFactor[] = data.all.map(f => ({
        id: f.id,
        friendly_name: f.friendly_name ?? '',
        factor_type: f.factor_type,
        status: f.status,
      }))
      return { factors, error: null }
    } catch (err) {
      return { factors: [], error: err instanceof Error ? err.message : 'Failed to list factors' }
    }
  }

  return { enroll, challenge, verify, unenroll, listFactors }
}
