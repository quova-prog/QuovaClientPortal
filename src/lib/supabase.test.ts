import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Supabase WorkOS access token wiring', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    vi.stubEnv('VITE_AUTH_PROVIDER', 'workos')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps the exported Supabase client stable when the WorkOS token provider changes', async () => {
    let clientSeq = 0
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(() => ({ clientSeq: ++clientSeq })),
    }))

    const mod = await import('./supabase')
    const initialClient = mod.supabase

    mod.setSupabaseAccessTokenProvider(async () => 'token-one')
    expect(mod.supabase).toBe(initialClient)

    mod.setSupabaseAccessTokenProvider(async () => 'token-two')
    expect(mod.supabase).toBe(initialClient)

    mod.setSupabaseAccessTokenProvider(null)
    expect(mod.supabase).toBe(initialClient)
  })
})
